import { ApprovalToken, Task, AgentDefinition } from '@atlas/shared';
import { AgentRunner, AgentRunSummary } from '../engine/agent-runner.js';
import { rootLogger } from '@atlas/observability';

export interface TaskJobData {
  task: Task;
  agent: AgentDefinition;
  prompt: string;
  runId?: string;
  approvalResume?: ApprovalResumeContext;
}

export interface ApprovalResumeContext {
  taskId: string;
  runId: string;
  token: ApprovalToken;
}

export type TaskJobHandler = (data: TaskJobData) => Promise<unknown>;

/**
 * How a task is identified to the queue.
 *
 * `hasPending` must probe the SAME id `enqueue` would create, so both take this shape rather than
 * a bare taskId: a job that carries a runId is keyed on the runId, and probing only the taskId made
 * such a job invisible to the worker's recovery sweep.
 */
export interface TaskQueueIdentity {
  taskId: string;
  runId?: string;
}

export interface TaskQueue {
  enqueue(data: TaskJobData): Promise<string>;
  defer?(data: TaskJobData, delayMs?: number): Promise<string>;
  hasPending?(identity: TaskQueueIdentity): Promise<boolean>;
  process(concurrency: number, handler: TaskJobHandler): void;
  healthCheck(): Promise<boolean>;
  close(): Promise<void>;
}

export class InMemoryTaskQueue implements TaskQueue {
  private queue: TaskJobData[] = [];
  private isProcessing = false;
  private handler: TaskJobHandler | null = null;
  private activeCount = 0;
  private concurrency = 1;
  private closed = false;
  private deferredTimers = new Map<string, NodeJS.Timeout>();
  private pendingTaskIds = new Set<string>();
  private deferredTaskIds = new Set<string>();

  public async enqueue(data: TaskJobData): Promise<string> {
    const jobId = data.runId || data.task.id;
    if (this.pendingTaskIds.has(data.task.id)) return jobId;

    this.pendingTaskIds.add(data.task.id);
    this.queue.push(data);
    rootLogger.debug(`Task enqueued: ${data.task.id}, queue length: ${this.queue.length}`);
    this.dispatch();
    return jobId;
  }

  public async defer(data: TaskJobData, delayMs = 5000): Promise<string> {
    const jobId = `deferred:${data.task.id}`;
    if (!this.deferredTaskIds.has(data.task.id)) {
      this.deferredTaskIds.add(data.task.id);
      const timer = setTimeout(() => {
        this.deferredTimers.delete(data.task.id);
        this.deferredTaskIds.delete(data.task.id);
        void this.enqueue(data);
      }, delayMs);
      this.deferredTimers.set(data.task.id, timer);
    }
    return jobId;
  }

  public async hasPending(identity: { taskId: string; runId?: string }): Promise<boolean> {
    // Both identities, mirroring the BullMQ implementation: a runId-keyed job must be visible or
    // the recovery sweep re-enqueues a task that is still in flight.
    const ids = [identity.taskId, ...(identity.runId ? [identity.runId] : [])];
    return ids.some(id => this.pendingTaskIds.has(id) || this.deferredTaskIds.has(id));
  }

  public process(concurrency: number, handler: TaskJobHandler): void {
    this.concurrency = Math.max(1, concurrency);
    this.handler = handler;
    this.isProcessing = true;
    this.dispatch();
  }

  public async healthCheck(): Promise<boolean> {
    return !this.closed;
  }

  private async dispatch(): Promise<void> {
    if (!this.isProcessing || !this.handler) return;

    while (this.activeCount < this.concurrency && this.queue.length > 0) {
      const item = this.queue.shift();
      if (!item) break;

      this.activeCount++;
      (async () => {
        try {
          await this.handler!(item);
        } catch (err) {
          rootLogger.error(`Error processing job for task ${item.task.id}`, { error: String(err) });
        } finally {
          this.pendingTaskIds.delete(item.task.id);
          this.activeCount--;
          this.dispatch();
        }
      })();
    }
  }

  public async close(): Promise<void> {
    this.closed = true;
    this.isProcessing = false;
    this.queue = [];
    this.pendingTaskIds.clear();
    this.deferredTaskIds.clear();
    for (const timer of this.deferredTimers.values()) clearTimeout(timer);
    this.deferredTimers.clear();
  }
}
