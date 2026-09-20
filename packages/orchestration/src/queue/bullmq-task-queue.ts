import { Queue, Worker } from 'bullmq';
import { rootLogger } from '@atlas/observability';
import { TaskJobData, TaskQueue, TaskJobHandler } from './task-queue.js';

/**
 * The job id `enqueue`/`defer` will create for a job.
 *
 * A job that carries a runId is keyed on it, so the same task can have an ordinary job and a
 * resume job without colliding.
 */
export function primaryJobId(data: Pick<TaskJobData, 'task' | 'runId'>): string {
  return data.runId || data.task.id;
}

/**
 * Every job id `hasPending` must probe to answer "is this task already in flight?".
 *
 * Both identities, because `enqueue` may have keyed the job on either one, and both the plain and
 * the deferred form, because a paused task is parked under `deferred:`. Probing only `taskId` meant
 * a runId-keyed job was invisible, and the worker's recovery sweep re-enqueued the task under
 * `taskId` while the first job was still waiting.
 */
export function probedJobIds(identity: { taskId: string; runId?: string }): string[] {
  const ids = [identity.taskId, `deferred:${identity.taskId}`];
  if (identity.runId) {
    ids.push(identity.runId, `deferred:${identity.runId}`);
  }
  return ids;
}

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
    const job = await this.addOrReplaceTerminalJob(data, primaryJobId(data), {
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: { age: 86400, count: 1000 },
      removeOnFail: { age: 604800, count: 5000 }
    });

    return String(job.id);
  }

  public async defer(data: TaskJobData, delayMs = 5000): Promise<string> {
    if (this.closed) throw new Error(`Queue '${this.queueName}' is closed`);
    const job = await this.addOrReplaceTerminalJob(data, `deferred:${primaryJobId(data)}`, {
      delay: delayMs,
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: true,
      removeOnFail: true
    });

    return String(job.id);
  }

  public async hasPending(identity: { taskId: string; runId?: string }): Promise<boolean> {
    if (this.closed) return false;

    for (const jobId of probedJobIds(identity)) {
      const job = await this.queue.getJob(jobId);
      if (!job) continue;
      const state = await job.getState();
      if (state === 'waiting' || state === 'active' || state === 'delayed' || state === 'prioritized' || state === 'waiting-children') {
        return true;
      }
    }

    return false;
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

  private async addOrReplaceTerminalJob(
    data: TaskJobData,
    jobId: string,
    options: {
      delay?: number;
      attempts: number;
      backoff: { type: 'exponential'; delay: number };
      removeOnComplete: boolean | { age: number; count: number };
      removeOnFail: boolean | { age: number; count: number };
    }
  ) {
    const existing = await this.queue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (state === 'waiting' || state === 'active' || state === 'delayed' || state === 'prioritized' || state === 'waiting-children') {
        return existing;
      }
      await existing.remove();
    }

    return this.queue.add('agent-task', data, { jobId, ...options });
  }
}
