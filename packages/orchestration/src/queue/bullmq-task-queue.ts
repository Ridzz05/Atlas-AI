import { Queue, Worker } from 'bullmq';
import { TaskJobData, TaskJobHandler, TaskQueue } from './task-queue.js';
import { rootLogger } from '@atlas/observability';

export interface BullMqTaskQueueOptions {
  redisUrl: string;
  queueName?: string;
}

export class BullMqTaskQueue implements TaskQueue {
  private readonly queueName: string;
  private readonly redisUrl: string;
  private readonly queue: Queue<TaskJobData>;
  private worker: Worker<TaskJobData> | null = null;
  private closed = false;

  constructor(options: BullMqTaskQueueOptions) {
    this.queueName = options.queueName || 'atlas-agent-tasks';
    this.redisUrl = options.redisUrl;
    const connection = { url: this.redisUrl, maxRetriesPerRequest: null };
    this.queue = new Queue<TaskJobData>(this.queueName, { connection });
  }

  public async enqueue(data: TaskJobData): Promise<string> {
    if (this.closed) throw new Error(`Queue '${this.queueName}' is closed`);
    const job = await this.queue.add('agent-task', data, {
      jobId: data.runId || data.task.id,
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: { age: 86400, count: 1000 },
      removeOnFail: { age: 604800, count: 5000 }
    });

    return String(job.id);
  }

  public async defer(data: TaskJobData, delayMs = 5000): Promise<string> {
    if (this.closed) throw new Error(`Queue '${this.queueName}' is closed`);
    const job = await this.queue.add('agent-task', data, {
      jobId: `deferred:${data.runId || data.task.id}:${crypto.randomUUID()}`,
      delay: delayMs,
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: { age: 86400, count: 1000 },
      removeOnFail: { age: 604800, count: 5000 }
    });

    return String(job.id);
  }

  public process(concurrency: number, handler: TaskJobHandler): void {
    if (this.closed) throw new Error(`Queue '${this.queueName}' is closed`);
    if (this.worker) {
      throw new Error(`Queue '${this.queueName}' is already being processed`);
    }

    const connection = { url: this.redisUrl, maxRetriesPerRequest: null };
    this.worker = new Worker<TaskJobData>(this.queueName, async job => handler(job.data), {
      connection,
      concurrency: Math.max(1, concurrency)
    });

    this.worker.on('failed', (job, error) => {
      rootLogger.error('BullMQ task failed', {
        taskId: job?.data.task.id,
        runId: job?.data.runId,
        error: error.message
      });
    });
  }

  public async healthCheck(): Promise<boolean> {
    if (this.closed) return false;
    try {
      await this.queue.getJobCounts();
      return true;
    } catch (error) {
      rootLogger.warn('BullMQ readiness check failed', { error: String(error) });
      return false;
    }
  }

  public async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.worker?.close();
    await this.queue.close();
    this.worker = null;
  }
}
