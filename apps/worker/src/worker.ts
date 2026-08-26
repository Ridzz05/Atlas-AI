import { rootLogger } from '@atlas/observability';
import { EnvConfig } from '@atlas/shared';
import {
  ApprovalRepository,
  ArtifactRepository,
  AuditRepository,
  DatabaseClient,
  TaskRepository,
  RunRepository,
  TelegramStateRepository,
  MessageRepository,
  ToolCallRepository,
  BudgetRepository
} from '@atlas/database';
import { MemoryAuditSink, MemoryMaintenanceService, MemoryProposalService, MemoryRetriever, MemoryStore, MemoryTools } from '@atlas/memory';
import { EventBus, InMemoryEventBus } from '@atlas/events';
import { createModelProvider, ModelProvider } from '@atlas/providers';
import { defaultAgentRegistry, AgentRegistry } from '@atlas/agents';
import {
  ArtifactService,
  CompanyLookupTool,
  CreateDraftTool,
  LeadEnrichmentTool,
  LeadScoringTool,
  PolicyVerifyTool,
  SendApprovedCommunicationTool,
  ToolRegistry,
  WebSearchTool,
  createArtifactTools,
  createMemoryTools
} from '@atlas/tools';
import type { ResearchProvider } from '@atlas/tools';
import { AgentRunner, TaskDelegator, TaskQueue, InMemoryTaskQueue, ToolGatewayExecutor } from '@atlas/orchestration';

export interface WorkerRunnerOptions {
  config: EnvConfig;
  db?: DatabaseClient;
  taskRepo?: TaskRepository;
  runRepo?: RunRepository;
  provider?: ModelProvider;
  eventBus?: EventBus;
  registry?: AgentRegistry;
  taskQueue?: TaskQueue;
  approvalRepo?: ApprovalRepository;
  artifactRepo?: ArtifactRepository;
  auditRepo?: AuditRepository;
  controlStateRepo?: TelegramStateRepository;
  memoryStore?: MemoryStore;
  messageRepo?: MessageRepository;
  toolCallRepo?: ToolCallRepository;
  budgetRepo?: BudgetRepository;
  researchProvider?: ResearchProvider;
  workerId?: string;
  leaseSeconds?: number;
}

export class AgentWorkerRunner {
  private isRunning = false;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private memoryMaintenanceTimer: NodeJS.Timeout | null = null;
  private memoryMaintenance?: MemoryMaintenanceService;
  private runner: AgentRunner;
  private delegator: TaskDelegator;
  private taskQueue: TaskQueue;
  private readonly workerId: string;

  constructor(private options: WorkerRunnerOptions) {
    this.workerId = options.workerId || `${process.env.HOSTNAME || 'atlas-worker'}:${process.pid}`;
    const eventBus = options.eventBus || new InMemoryEventBus();
    const registry = options.registry || defaultAgentRegistry;
    const provider =
      options.provider ||
      createModelProvider({
        providerType: options.config.MODEL_PROVIDER,
        apiKey: options.config.MODEL_API_KEY,
        baseUrl: options.config.MODEL_BASE_URL,
        model: options.config.MODEL_NAME
      });
    const toolRegistry = new ToolRegistry();
    toolRegistry.register(WebSearchTool);
    toolRegistry.register(CompanyLookupTool);
    toolRegistry.register(LeadEnrichmentTool);
    toolRegistry.register(LeadScoringTool);
    toolRegistry.register(PolicyVerifyTool);
    toolRegistry.register(CreateDraftTool);
    toolRegistry.register(SendApprovedCommunicationTool);
    const memoryAuditSink: MemoryAuditSink | undefined = options.auditRepo
      ? { record: event => options.auditRepo!.create(event) }
      : undefined;
    if (options.memoryStore) {
      this.memoryMaintenance = new MemoryMaintenanceService(options.memoryStore, memoryAuditSink);
      const memoryTools = new MemoryTools(
        new MemoryRetriever(options.memoryStore),
        new MemoryProposalService(options.memoryStore, memoryAuditSink),
        options.memoryStore
      );
      for (const tool of createMemoryTools(memoryTools)) {
        toolRegistry.register(tool);
      }
    }
    const artifactService = new ArtifactService(
      options.config.ARTIFACT_STORAGE_PATH,
      options.artifactRepo ? { record: input => options.artifactRepo!.create(input) } : undefined
    );
    for (const tool of createArtifactTools(artifactService)) {
      toolRegistry.register(tool);
    }
    const toolExecutor = new ToolGatewayExecutor({
      registry: toolRegistry,
      baseContext: {
        externalWritesEnabled: options.config.EXTERNAL_WRITES_ENABLED,
        researchProvider: options.researchProvider,
        approvalSecretKey: options.config.ENCRYPTION_KEY,
        approvalExecutionStore: options.approvalRepo,
        approvalRequestStore: options.approvalRepo,
        auditSink: options.auditRepo ? { record: event => options.auditRepo!.create(event) } : undefined
      }
    });

    this.runner = new AgentRunner({
      provider,
      eventBus,
      taskRepo: options.taskRepo,
      runRepo: options.runRepo,
      messageRepo: options.messageRepo,
      toolCallRepo: options.toolCallRepo,
      budgetRepo: options.budgetRepo,
      globalDailyBudgetUsd: options.config.GLOBAL_DAILY_BUDGET_USD,
      workerId: this.workerId,
      leaseSeconds: options.leaseSeconds,
      toolExecutor,
      approvalExecutionStore: options.approvalRepo,
      cancellationStore: options.runRepo
    });

    this.delegator = new TaskDelegator({
      provider,
      registry,
      eventBus,
      taskRepo: options.taskRepo,
      runRepo: options.runRepo,
      messageRepo: options.messageRepo,
      toolCallRepo: options.toolCallRepo,
      budgetRepo: options.budgetRepo,
      globalDailyBudgetUsd: options.config.GLOBAL_DAILY_BUDGET_USD,
      workerId: this.workerId,
      leaseSeconds: options.leaseSeconds,
      toolExecutor,
      approvalExecutionStore: options.approvalRepo,
      maxConcurrency: options.config.MAX_CONCURRENT_AGENT_RUNS,
      maxDelegationDepth: options.config.MAX_DELEGATION_DEPTH,
      cancellationStore: options.runRepo
    });

    this.taskQueue = options.taskQueue || new InMemoryTaskQueue();
  }

  public async start(): Promise<void> {
    if (this.options.runRepo && typeof (this.options.runRepo as any).recoverStaleRuns === 'function') {
      const recovered = await this.options.runRepo.recoverStaleRuns();
      if (recovered > 0) {
        rootLogger.warn('Recovered stale runs from expired worker leases', { recovered });
      }
    }

    if (this.memoryMaintenance) {
      await this.runMemoryMaintenance();
      const intervalSeconds = this.options.config.MEMORY_MAINTENANCE_INTERVAL_SECONDS || 3600;
      this.memoryMaintenanceTimer = setInterval(() => {
        void this.runMemoryMaintenance().catch(error => {
          rootLogger.error('Memory maintenance job failed', { error: String(error) });
        });
      }, intervalSeconds * 1000);
      this.memoryMaintenanceTimer.unref?.();
    }

    this.isRunning = true;
    const concurrency = this.options.config.MAX_CONCURRENT_AGENT_RUNS || 3;

    // Start queue processor
    this.taskQueue.process(concurrency, async job => {
      if (this.options.controlStateRepo) {
        try {
          const controlState = await this.options.controlStateRepo.getControlState();
          if (controlState.paused || controlState.emergencyStop) {
            if (this.taskQueue.defer) {
              await this.taskQueue.defer(job, 5000);
            }
            rootLogger.warn('Deferring task while execution control state is locked', {
              taskId: job.task.id,
              state: controlState.emergencyStop ? 'emergency_stop' : 'paused'
            });
            return { status: 'deferred' };
          }
        } catch (err) {
          if (this.taskQueue.defer) {
            await this.taskQueue.defer(job, 5000);
          }
          rootLogger.error('Execution control state unavailable; task deferred', {
            taskId: job.task.id,
            error: String(err)
          });
          return { status: 'deferred' };
        }
      }

      rootLogger.info(`Worker processing job for task ${job.task.id} (Agent: ${job.agent.id}, Role: ${job.agent.role})`);

      if (job.agent.role === 'orchestrator') {
        return this.delegator.executePlan(job.task, undefined, job.approvalResume);
      } else {
        return this.runner.run({
          task: job.task,
          agent: job.agent,
          initialPrompt: job.prompt,
          runId: job.approvalResume?.runId || job.runId,
          approvalToken: job.approvalResume?.token
        });
      }
    });

    rootLogger.info('ATLAS Agent Worker started', {
      concurrency,
      nodeEnv: this.options.config.NODE_ENV
    });

    this.heartbeatTimer = setInterval(() => {
      if (this.isRunning) {
        rootLogger.debug('Agent Worker heartbeat', {
          status: 'healthy',
          memoryUsageMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024)
        });
      }
    }, 30000);
  }

  public async stop(): Promise<void> {
    this.isRunning = false;
    if (this.memoryMaintenanceTimer) {
      clearInterval(this.memoryMaintenanceTimer);
      this.memoryMaintenanceTimer = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    await this.taskQueue.close();
    rootLogger.info('ATLAS Agent Worker gracefully stopped');
  }

  public getStatus(): { isRunning: boolean } {
    return { isRunning: this.isRunning };
  }

  public getRunner(): AgentRunner {
    return this.runner;
  }

  public getDelegator(): TaskDelegator {
    return this.delegator;
  }

  public getQueue(): TaskQueue {
    return this.taskQueue;
  }

  private async runMemoryMaintenance(): Promise<void> {
    if (!this.memoryMaintenance) return;
    const result = await this.memoryMaintenance.run({
      deletionGraceDays: this.options.config.MEMORY_DELETION_GRACE_DAYS ?? 7,
      batchSize: 100
    });
    if (result.deprecated > 0 || result.deleted > 0) {
      rootLogger.info('Memory maintenance completed', { ...result });
    }
  }
}
