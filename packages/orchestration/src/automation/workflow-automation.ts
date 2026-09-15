import { TaskRepository, WorkflowCheckpointRepository } from '@atlas/database';
import { AgentRegistry } from '@atlas/agents';
import { rootLogger } from '@atlas/observability';
import { TaskQueue } from '../queue/task-queue.js';
import { WorkflowRuntime } from '../workflow/workflow-runtime.js';
import { ResumeDriver } from '../workflow/resume-driver.js';

export interface WorkflowAutomationOptions {
  checkpointRepo: WorkflowCheckpointRepository;
  taskRepo: TaskRepository;
  registry: AgentRegistry;
  taskQueue?: TaskQueue;
  workflowRuntime?: WorkflowRuntime;
  resumeIntervalSeconds?: number;
  batchSize?: number;
  enabled?: boolean;
}

export class WorkflowAutomationService {
  private readonly checkpointRepo: WorkflowCheckpointRepository;
  private readonly taskRepo: TaskRepository;
  private readonly registry: AgentRegistry;
  private readonly taskQueue?: TaskQueue;
  private readonly runtime: WorkflowRuntime;
  private readonly driver: ResumeDriver;
  private readonly enabled: boolean;
  private running = false;

  constructor(private options: WorkflowAutomationOptions) {
    this.checkpointRepo = options.checkpointRepo;
    this.taskRepo = options.taskRepo;
    this.registry = options.registry;
    this.taskQueue = options.taskQueue;
    this.enabled = options.enabled ?? true;
    this.runtime = options.workflowRuntime ?? new WorkflowRuntime({ checkpointRepo: this.checkpointRepo });
    this.driver = new ResumeDriver({
      runtime: this.runtime,
      checkpointRepo: this.checkpointRepo,
      batchSize: options.batchSize ?? 25,
      intervalMs: (options.resumeIntervalSeconds ?? 30) * 1000,
      onResume: async checkpoint => {
        await this.handleResume(checkpoint);
      }
    });
  }

  public async start(): Promise<void> {
    if (!this.enabled) {
      rootLogger.info('Workflow automation disabled via config');
      return;
    }
    this.running = true;
    // Immediate tick to catch overdue checkpoints after restart (durable recovery)
    await this.driver.tick().catch(error => {
      rootLogger.error('Initial workflow resume tick failed', { error: String(error) });
    });
    this.driver.start();
    rootLogger.info('Workflow automation started', {
      intervalSeconds: this.options.resumeIntervalSeconds ?? 30,
      batchSize: this.options.batchSize ?? 25
    });
  }

  public stop(): void {
    this.running = false;
    this.driver.stop();
    rootLogger.info('Workflow automation stopped');
  }

  public async tick(now = new Date()): Promise<number> {
    if (!this.enabled || !this.running) return 0;
    return this.driver.tick(now);
  }

  public getRuntime(): WorkflowRuntime {
    return this.runtime;
  }

  public getDriver(): ResumeDriver {
    return this.driver;
  }

  private async handleResume(checkpoint: { runId: string; taskId: string; agentId: string; stepId: string }): Promise<void> {
    if (!this.taskQueue) {
      rootLogger.warn('Workflow resume skipped: no task queue wired', { runId: checkpoint.runId, stepId: checkpoint.stepId });
      return;
    }
    try {
      const task = await this.taskRepo.findById(checkpoint.taskId);
      if (!task) {
        rootLogger.error('Workflow resume failed: task not found', { taskId: checkpoint.taskId, runId: checkpoint.runId });
        // Mark checkpoint as failed so it does not spin forever
        await this.runtime.fail(checkpoint.runId, checkpoint.stepId, `Task not found: ${checkpoint.taskId}`).catch(() => undefined);
        return;
      }
      const agent = this.registry.get(task.assignedAgent);
      if (!agent) {
        rootLogger.error('Workflow resume failed: agent not found', { agentId: task.assignedAgent, taskId: task.id });
        await this.runtime.fail(checkpoint.runId, checkpoint.stepId, `Agent not found: ${task.assignedAgent}`).catch(() => undefined);
        return;
      }
      // Re-enqueue task following existing workflow: prompt = task.goal + checkpoint payload hint
      const resumeGoal = (checkpoint as any).payload?.resumePrompt || task.goal;
      await this.taskQueue.enqueue({
        task,
        agent,
        prompt: typeof resumeGoal === 'string' ? resumeGoal : task.goal,
        runId: checkpoint.runId
      });
      rootLogger.info('Workflow checkpoint resumed via automation', {
        runId: checkpoint.runId,
        stepId: checkpoint.stepId,
        taskId: task.id,
        agentId: agent.id
      });
    } catch (error) {
      rootLogger.error('Workflow handleResume failed', {
        runId: checkpoint.runId,
        stepId: checkpoint.stepId,
        error: String(error)
      });
      throw error;
    }
  }
}
