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
  BudgetRepository,
  WorkflowCheckpointRepository
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
  WebFetchTool,
  createArtifactTools,
  createMemoryTools
} from '@atlas/tools';
import type { ResearchProvider } from '@atlas/tools';
import {
  AgentRunner,
  TaskDelegator,
  TaskQueue,
  InMemoryTaskQueue,
  ToolGatewayExecutor,
  ScheduledJobScheduler,
  WorkflowAutomationService,
  AutomationEngine,
  SDLCEngine,
  phaseOutcomeFromTaskStatus
} from '@atlas/orchestration';
import { ScheduledJobRepository } from '@atlas/database';

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
  scheduledJobRepo?: ScheduledJobRepository;
  workflowCheckpointRepo?: WorkflowCheckpointRepository;
  sdlcEngine?: SDLCEngine;
  researchProvider?: ResearchProvider;
  workerId?: string;
  leaseSeconds?: number;
}

export class AgentWorkerRunner {
  private isRunning = false;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private memoryMaintenanceTimer: NodeJS.Timeout | null = null;
  private queueRecoveryTimer: NodeJS.Timeout | null = null;
  private queueRecoveryInFlight = false;
  private memoryMaintenance?: MemoryMaintenanceService;
  private scheduledJobScheduler?: ScheduledJobScheduler;
  private workflowAutomation?: WorkflowAutomationService;
  private automationEngine?: AutomationEngine;
  private runner: AgentRunner;
  private delegator: TaskDelegator;
  private taskQueue: TaskQueue;
  private readonly registry: AgentRegistry;
  private readonly workerId: string;

  constructor(private options: WorkerRunnerOptions) {
    this.workerId = options.workerId || `${process.env.HOSTNAME || 'atlas-worker'}:${process.pid}`;
    const eventBus = options.eventBus || new InMemoryEventBus();
    this.registry = options.registry || defaultAgentRegistry;
    const registry = this.registry;
    const provider =
      options.provider ||
      createModelProvider({
        providerType: options.config.MODEL_PROVIDER,
        apiKey: options.config.MODEL_API_KEY,
        baseUrl: options.config.MODEL_BASE_URL,
        model: options.config.MODEL_NAME
      });
    const toolRegistry = new ToolRegistry();
    toolRegistry.registerLegacy(WebSearchTool);
    toolRegistry.registerLegacy(WebFetchTool);
    toolRegistry.registerLegacy(CompanyLookupTool);
    toolRegistry.registerLegacy(LeadEnrichmentTool);
    toolRegistry.registerLegacy(LeadScoringTool);
    toolRegistry.registerLegacy(PolicyVerifyTool);
    toolRegistry.registerLegacy(CreateDraftTool);
    toolRegistry.registerLegacy(SendApprovedCommunicationTool);
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
        toolRegistry.registerLegacy(tool);
      }
    }
    const artifactService = new ArtifactService(
      options.config.ARTIFACT_STORAGE_PATH,
      options.artifactRepo ? { record: input => options.artifactRepo!.create(input) } : undefined
    );
    for (const tool of createArtifactTools(artifactService)) {
      toolRegistry.registerLegacy(tool);
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

    // AutomationEngine facade — follows same TaskRepository -> TaskQueue pattern as manual task creation
    if (options.taskRepo) {
      this.automationEngine = new AutomationEngine({
        taskRepo: options.taskRepo,
        taskQueue: this.taskQueue,
        registry: this.registry,
        checkpointRepo: options.workflowCheckpointRepo,
        eventBus
      });
    }
  }

  public async start(): Promise<void> {
    if (this.options.runRepo && typeof (this.options.runRepo as any).recoverStaleRuns === 'function') {
      const recovered = await this.options.runRepo.recoverStaleRuns();
      if (recovered > 0) {
        rootLogger.warn('Recovered stale runs from expired worker leases', { recovered });
      }
    }

    await this.recoverQueuedTasks();

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

    // --- Full AI Automation: Scheduled Jobs (cron-driven) ---
    if (this.options.scheduledJobRepo && this.options.taskRepo) {
      const automationEnabled = (this.options.config as any).AUTOMATION_ENABLED ?? true;
      this.scheduledJobScheduler = new ScheduledJobScheduler({
        scheduledJobRepo: this.options.scheduledJobRepo,
        taskRepo: this.options.taskRepo,
        registry: this.registry,
        taskQueue: this.taskQueue,
        triggerHandler: async ({ job }) => {
          rootLogger.info('Scheduled job tick processed', {
            scheduledJobId: job.id,
            jobType: job.jobType
          });
        },
        syncIntervalSeconds: this.options.config.SCHEDULED_JOB_SYNC_INTERVAL_SECONDS || 30,
        tickIntervalSeconds: (this.options.config as any).SCHEDULED_JOB_TICK_INTERVAL_SECONDS || 60,
        automationEnabled
      });
      await this.scheduledJobScheduler.start();
      rootLogger.info('Automation scheduler active', {
        automationEnabled,
        syncInterval: this.options.config.SCHEDULED_JOB_SYNC_INTERVAL_SECONDS || 30,
        tickInterval: (this.options.config as any).SCHEDULED_JOB_TICK_INTERVAL_SECONDS || 60
      });
    }

    // --- Full AI Automation: Durable Workflow Resume (scheduled / waiting_external_event / paused) ---
    const workflowEnabled = (this.options.config as any).WORKFLOW_AUTOMATION_ENABLED ?? true;
    const workflowCheckpointRepo =
      this.options.workflowCheckpointRepo || (this.options.db ? new WorkflowCheckpointRepository(this.options.db) : undefined);
    if (workflowCheckpointRepo && this.options.taskRepo && workflowEnabled) {
      this.workflowAutomation = new WorkflowAutomationService({
        checkpointRepo: workflowCheckpointRepo,
        taskRepo: this.options.taskRepo,
        registry: this.registry,
        taskQueue: this.taskQueue,
        resumeIntervalSeconds: (this.options.config as any).WORKFLOW_RESUME_INTERVAL_SECONDS || 30,
        batchSize: 25,
        enabled: workflowEnabled
      });
      await this.workflowAutomation.start();
      rootLogger.info('Workflow automation active', {
        workflowEnabled,
        resumeInterval: (this.options.config as any).WORKFLOW_RESUME_INTERVAL_SECONDS || 30
      });
    } else if (!workflowEnabled) {
      rootLogger.info('Workflow automation disabled via config');
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

      // At-most-once precondition. BullMQ retries a job up to three times, and every attempt
      // mints a fresh runId when the job carries none, so the lease cannot deduplicate two
      // attempts of the same task. Without this check a retry re-ran the whole task: duplicate
      // provider spend, duplicate artifact writes, duplicate tool side effects.
      const precheck = await this.checkTaskRunnable(job.task.id);
      if (!precheck.runnable) {
        rootLogger.warn(`Skipping job for task ${job.task.id}: ${precheck.reason}`, {
          taskId: job.task.id
        });
        return { status: 'skipped', reason: precheck.reason };
      }

      let result: unknown;
      if (job.agent.role === 'orchestrator') {
        result = await this.delegator.executePlan(job.task, undefined, job.approvalResume);
      } else {
        result = await this.runner.run({
          task: job.task,
          agent: job.agent,
          initialPrompt: job.prompt,
          runId: job.approvalResume?.runId || job.runId,
          approvalToken: job.approvalResume?.token
        });
      }

      await this.reportPhaseResult(job.task.id);
      return result;
    });

    rootLogger.info('ATLAS Agent Worker started', {
      concurrency,
      nodeEnv: this.options.config.NODE_ENV
    });

    const queueRecoveryIntervalSeconds = this.options.config.QUEUE_RECOVERY_INTERVAL_SECONDS || 30;
    this.queueRecoveryTimer = setInterval(() => {
      void this.recoverQueuedTasksInBackground();
    }, queueRecoveryIntervalSeconds * 1000);
    this.queueRecoveryTimer.unref?.();

    this.heartbeatTimer = setInterval(() => {
      if (this.isRunning) {
        rootLogger.debug('Agent Worker heartbeat', {
          status: 'healthy',
          memoryUsageMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024)
        });
      }
    }, 30000);
  }

  /**
   * May this job run right now?
   *
   * At handler entry a task may be `queued` (a fresh intake or a recovered task) or
   * `approval_pending` (an approved run resuming). Anything else means the work is already in
   * flight or already finished, and re-running it would duplicate provider spend, artifacts
   * and tool side effects.
   *
   * Returns runnable when the repository cannot answer (no `findById`, or no task row): this
   * is a precondition, not a substitute for the repository being present.
   */
  private async checkTaskRunnable(taskId: string): Promise<{ runnable: boolean; reason?: string }> {
    const taskRepo = this.options.taskRepo;
    if (!taskRepo || typeof (taskRepo as any).findById !== 'function') return { runnable: true };

    const task = await taskRepo.findById(taskId);
    if (!task) return { runnable: false, reason: 'task_not_found' };

    switch (task.status) {
      case 'queued':
        return { runnable: true };
      case 'approval_pending':
        return { runnable: true };
      default:
        return { runnable: false, reason: `task_already_${task.status}` };
    }
  }

  /**
   * Tells the SDLC coordinator that a phase task finished, so the initiative advances (or
   * pauses for human review) as a side effect of real task execution rather than from an
   * unawaited promise in the API process.
   *
   * The task row is the source of truth: the runner or delegator has just written its
   * terminal status and result there, so the outcome and the agent's output are read back
   * instead of being inferred from a return value.
   */
  private async reportPhaseResult(taskId: string): Promise<void> {
    const sdlcEngine = this.options.sdlcEngine;
    const taskRepo = this.options.taskRepo;
    if (!sdlcEngine || !taskRepo) return;

    try {
      const task = await taskRepo.findById(taskId);
      if (!task) return;

      const outcome = phaseOutcomeFromTaskStatus(task.status);
      if (!outcome) return;

      const result = (task.result || {}) as Record<string, unknown>;
      const output = String(result.summary ?? result.synthesis ?? '');

      await sdlcEngine.recordPhaseResult(taskId, { outcome, output });
    } catch (err) {
      // Never let SDLC bookkeeping fail the task that just ran successfully.
      rootLogger.error(`Failed to report SDLC phase result for task ${taskId}`, { error: String(err) });
    }
  }

  public async stop(): Promise<void> {
    this.isRunning = false;
    if (this.memoryMaintenanceTimer) {
      clearInterval(this.memoryMaintenanceTimer);
      this.memoryMaintenanceTimer = null;
    }
    if (this.queueRecoveryTimer) {
      clearInterval(this.queueRecoveryTimer);
      this.queueRecoveryTimer = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.scheduledJobScheduler) {
      this.scheduledJobScheduler.stop();
      this.scheduledJobScheduler = undefined;
    }
    if (this.workflowAutomation) {
      this.workflowAutomation.stop();
      this.workflowAutomation = undefined;
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

  public getScheduledJobScheduler(): ScheduledJobScheduler | undefined {
    return this.scheduledJobScheduler;
  }

  public getWorkflowAutomation(): WorkflowAutomationService | undefined {
    return this.workflowAutomation;
  }

  public getAutomationEngine(): AutomationEngine | undefined {
    return this.automationEngine;
  }

  /**
   * Manual trigger for full AI Automation — executes an automation trigger
   * following the same workflow as scheduled jobs (TaskRepository -> Queue -> Chief/Delegator).
   * Useful for webhook/event-driven automation or dashboard manual fire.
   */
  public async triggerAutomation(input: {
    type: 'cron' | 'event' | 'webhook' | 'manual';
    jobType: string;
    payload?: Record<string, unknown>;
    id?: string;
  }): Promise<{ taskId: string; status: string }> {
    if (!this.automationEngine) throw new Error('AutomationEngine not initialized (missing taskRepo/taskQueue)');
    const result = await this.automationEngine.execute({
      id: input.id || `auto_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: input.type,
      jobType: input.jobType as any,
      payload: input.payload
    });
    return { taskId: result.taskId, status: result.status };
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

  private async recoverQueuedTasks(): Promise<void> {
    if (!this.options.taskRepo) return;

    const pageSize = 1000;
    let offset = 0;
    let requeuedCount = 0;

    while (true) {
      const filter = offset === 0 ? { status: 'queued' as const, limit: pageSize } : { status: 'queued' as const, limit: pageSize, offset };
      const queuedTasks = await this.options.taskRepo.list(filter);
      for (const task of queuedTasks) {
        const agent = this.registry.get(task.assignedAgent);
        if (!agent) {
          rootLogger.error('Cannot requeue persisted task with an unknown agent', {
            taskId: task.id,
            agentId: task.assignedAgent
          });
          continue;
        }

        if (this.taskQueue.hasPending && (await this.taskQueue.hasPending({ taskId: task.id }))) {
          continue;
        }

        // Durable counterpart to the queue probe. A job may have been keyed on a runId the sweep
        // cannot see, and the queue probe alone cannot answer for another replica. A task that is
        // `queued` while one of its runs is still active already has something working on it, so
        // re-enqueueing it here produced a second job for the same work; both attempts then passed
        // the at-most-once precondition, which is a read-then-act with no compare-and-set.
        if (this.options.runRepo && typeof (this.options.runRepo as any).findByTaskId === 'function') {
          const runs = await this.options.runRepo.findByTaskId(task.id);
          const hasActiveRun = runs.some(run =>
            ['created', 'active', 'waiting_tool', 'waiting_child', 'waiting_approval'].includes(run.status)
          );
          if (hasActiveRun) continue;
        }

        await this.taskQueue.enqueue({
          task,
          agent,
          prompt: task.goal
        });
        requeuedCount += 1;
      }

      if (queuedTasks.length < pageSize) break;
      offset += queuedTasks.length;
    }

    if (requeuedCount > 0) {
      rootLogger.info('Requeued persisted tasks awaiting worker delivery', { count: requeuedCount });
    }
  }

  private async recoverQueuedTasksInBackground(): Promise<void> {
    if (!this.isRunning || this.queueRecoveryInFlight) return;

    this.queueRecoveryInFlight = true;
    try {
      await this.recoverQueuedTasks();
      await this.recoverStaleWork();
      await this.recoverStaleBudgetReservations();
    } catch (error) {
      rootLogger.error('Queued task recovery failed; will retry on the next interval', { error: String(error) });
    } finally {
      this.queueRecoveryInFlight = false;
    }
  }

  /**
   * Re-run the stale-run and orphaned-task sweeps on the recovery interval.
   *
   * Both used to run only at worker boot, so work abandoned by a worker that died mid-run
   * stayed `running` until the next restart — which is how tasks ended up stuck permanently.
   */
  private async recoverStaleWork(): Promise<void> {
    const runRepo = this.options.runRepo;
    if (!runRepo || typeof (runRepo as any).recoverStaleRuns !== 'function') return;

    const recovered = await runRepo.recoverStaleRuns();
    if (recovered > 0) {
      rootLogger.warn('Recovered stale runs and orphaned tasks', { recovered });
    }
  }

  /**
   * Release budget reservations abandoned by a run that died between reserve and settle.
   *
   * `recoverStaleReservations` used to run only at runtime bootstrap. A worker killed after
   * reserving left `global_daily.reserved_usd` inflated, and because nothing swept it the
   * global daily cap could refuse new runs until the process restarted more than 15 minutes
   * later. It now rides the same recovery interval as the queued-task sweep.
   */
  private async recoverStaleBudgetReservations(): Promise<void> {
    const budgetRepo = this.options.budgetRepo;
    if (!budgetRepo || typeof budgetRepo.recoverStaleReservations !== 'function') return;

    const released = await budgetRepo.recoverStaleReservations();
    if (released > 0) {
      rootLogger.warn('Released stale budget reservations', { count: released });
    }
  }
}
