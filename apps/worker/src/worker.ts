import { rootLogger } from '@atlas/observability';
import { EnvConfig } from '@atlas/shared';
import {
  ApprovalRepository,
  ArtifactRepository,
  AuditRepository,
  DatabaseClient,
  TaskRepository,
  RunRepository
} from '@atlas/database';
import { EventBus, InMemoryEventBus } from '@atlas/events';
import { createModelProvider, ModelProvider } from '@atlas/providers';
import { defaultAgentRegistry, AgentRegistry } from '@atlas/agents';
import {
  ArtifactService,
  CompanyLookupTool,
  CreateDraftTool,
  SendApprovedCommunicationTool,
  ToolRegistry,
  WebSearchTool,
  createArtifactTools
} from '@atlas/tools';
import {
  AgentRunner,
  TaskDelegator,
  TaskQueue,
  InMemoryTaskQueue,
  ToolGatewayExecutor
} from '@atlas/orchestration';

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
}

export class AgentWorkerRunner {
  private isRunning = false;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private runner: AgentRunner;
  private delegator: TaskDelegator;
  private taskQueue: TaskQueue;

  constructor(private options: WorkerRunnerOptions) {
    const eventBus = options.eventBus || new InMemoryEventBus();
    const registry = options.registry || defaultAgentRegistry;
    const provider = options.provider || createModelProvider({
      providerType: options.config.MODEL_PROVIDER,
      apiKey: options.config.MODEL_API_KEY
    });
    const toolRegistry = new ToolRegistry();
    toolRegistry.register(WebSearchTool);
    toolRegistry.register(CompanyLookupTool);
    toolRegistry.register(CreateDraftTool);
    toolRegistry.register(SendApprovedCommunicationTool);
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
      toolExecutor,
      approvalExecutionStore: options.approvalRepo
    });

    this.delegator = new TaskDelegator({
      provider,
      registry,
      eventBus,
      taskRepo: options.taskRepo,
      runRepo: options.runRepo,
      toolExecutor,
      approvalExecutionStore: options.approvalRepo,
      maxConcurrency: options.config.MAX_CONCURRENT_AGENT_RUNS
    });

    this.taskQueue = options.taskQueue || new InMemoryTaskQueue();
  }

  public async start(): Promise<void> {
    this.isRunning = true;
    const concurrency = this.options.config.MAX_CONCURRENT_AGENT_RUNS || 3;

    // Start queue processor
    this.taskQueue.process(concurrency, async (job) => {
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
}
