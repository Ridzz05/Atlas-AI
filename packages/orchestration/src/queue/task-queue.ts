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

export interface TaskQueue {
  enqueue(data: TaskJobData): Promise<string>;
  process(concurrency: number, handler: TaskJobHandler): void;
  close(): Promise<void>;
}

export class InMemoryTaskQueue implements TaskQueue {
  private queue: TaskJobData[] = [];
  private isProcessing = false;
  private handler: TaskJobHandler | null = null;
  private activeCount = 0;
  private concurrency = 1;

  public async enqueue(data: TaskJobData): Promise<string> {
    const jobId = data.runId || crypto.randomUUID();
    this.queue.push(data);
    rootLogger.debug(`Task enqueued: ${data.task.id}, queue length: ${this.queue.length}`);
    this.dispatch();
    return jobId;
  }

  public process(concurrency: number, handler: TaskJobHandler): void {
    this.concurrency = Math.max(1, concurrency);
    this.handler = handler;
    this.isProcessing = true;
    this.dispatch();
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
          this.activeCount--;
          this.dispatch();
        }
      })();
    }
  }

  public async close(): Promise<void> {
    this.isProcessing = false;
    this.queue = [];
  }
}
