import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BullMqTaskQueue } from '../src/queue/bullmq-task-queue.js';

const add = vi.fn().mockResolvedValue({ id: 'job-1' });
const getJob = vi.fn().mockResolvedValue(null);
const getJobCounts = vi.fn().mockResolvedValue({ waiting: 0, active: 0 });
const queueClose = vi.fn().mockResolvedValue(undefined);
const workerClose = vi.fn().mockResolvedValue(undefined);
const workerOn = vi.fn();

vi.mock('bullmq', () => ({
  Queue: class FakeQueue {
    add = add;
    getJob = getJob;
    getJobCounts = getJobCounts;
    close = queueClose;
  },
  Worker: class FakeWorker {
    on = workerOn;
    close = workerClose;
  }
}));

describe('BullMqTaskQueue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reports queue health while open and fails after close', async () => {
    const queue = new BullMqTaskQueue({ redisUrl: 'redis://localhost:6379', queueName: 'test-atlas-health' });

    await expect(queue.healthCheck()).resolves.toBe(true);
    expect(getJobCounts).toHaveBeenCalled();

    await queue.close();

    await expect(queue.healthCheck()).resolves.toBe(false);
  });

  it('enqueues a durable job with retry policy and starts a worker processor', async () => {
    const queue = new BullMqTaskQueue({ redisUrl: 'redis://localhost:6379', queueName: 'test-atlas' });
    const handler = vi.fn().mockResolvedValue(undefined);

    const jobId = await queue.enqueue({
      task: {} as never,
      agent: {} as never,
      prompt: 'run task',
      runId: 'run-123'
    });
    queue.process(3, handler);

    expect(jobId).toBe('job-1');
    expect(add).toHaveBeenCalledWith(
      'agent-task',
      expect.objectContaining({ prompt: 'run task', runId: 'run-123' }),
      expect.objectContaining({
        jobId: 'run-123',
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 }
      })
    );
    expect(workerOn).toHaveBeenCalledWith('failed', expect.any(Function));

    await queue.close();
    await queue.close();
    expect(workerClose).toHaveBeenCalledOnce();
    expect(queueClose).toHaveBeenCalledOnce();
  });

  it('uses the task id as an idempotency key when no run id exists', async () => {
    const queue = new BullMqTaskQueue({ redisUrl: 'redis://localhost:6379', queueName: 'test-atlas-idempotent' });

    await queue.enqueue({
      task: { id: 'task-123' } as never,
      agent: {} as never,
      prompt: 'retry-safe task'
    });

    expect(add).toHaveBeenLastCalledWith(
      'agent-task',
      expect.objectContaining({ prompt: 'retry-safe task' }),
      expect.objectContaining({ jobId: 'task-123' })
    );
    await queue.close();
  });

  it('defers a locked task with a delayed durable job', async () => {
    const queue = new BullMqTaskQueue({ redisUrl: 'redis://localhost:6379', queueName: 'test-atlas-defer' });

    await queue.defer(
      {
        task: { id: 'task-deferred' } as never,
        agent: {} as never,
        prompt: 'wait for resume'
      },
      5000
    );

    expect(add).toHaveBeenLastCalledWith(
      'agent-task',
      expect.objectContaining({ prompt: 'wait for resume' }),
      expect.objectContaining({
        delay: 5000,
        attempts: 3,
        jobId: 'deferred:task-deferred',
        removeOnComplete: true,
        removeOnFail: true
      })
    );
    await queue.close();
  });

  it('reports an existing waiting or delayed task job as pending', async () => {
    const pendingJob = { getState: vi.fn().mockResolvedValue('delayed') };
    getJob.mockResolvedValueOnce(null).mockResolvedValueOnce(pendingJob);
    const queue = new BullMqTaskQueue({ redisUrl: 'redis://localhost:6379', queueName: 'test-atlas-pending' });

    await expect(queue.hasPending({ taskId: 'task-pending' })).resolves.toBe(true);
    expect(getJob).toHaveBeenNthCalledWith(1, 'task-pending');
    expect(getJob).toHaveBeenNthCalledWith(2, 'deferred:task-pending');
    await queue.close();
  });

  // A job carrying a runId is keyed on the runId, so probing only the taskId missed it and the
  // recovery sweep re-enqueued a task that was still in flight.
  it('reports a runId-keyed job as pending for its task', async () => {
    const pendingJob = { getState: vi.fn().mockResolvedValue('waiting') };
    getJob.mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValueOnce(pendingJob);
    const queue = new BullMqTaskQueue({ redisUrl: 'redis://localhost:6379', queueName: 'test-atlas-runid' });

    await expect(queue.hasPending({ taskId: 'task-x', runId: 'run-x' })).resolves.toBe(true);
    expect(getJob).toHaveBeenCalledWith('run-x');
    await queue.close();
  });

  it('does not create a second deferred job while the first one is delayed', async () => {
    const pendingJob = { id: 'deferred:task-locked', getState: vi.fn().mockResolvedValue('delayed') };
    getJob.mockResolvedValue(pendingJob);
    const queue = new BullMqTaskQueue({ redisUrl: 'redis://localhost:6379', queueName: 'test-atlas-defer-dedup' });

    const jobId = await queue.defer(
      {
        task: { id: 'task-locked' } as never,
        agent: {} as never,
        prompt: 'stay deferred'
      },
      5000
    );

    expect(jobId).toBe('deferred:task-locked');
    expect(add).not.toHaveBeenCalled();
    await queue.close();
  });

  it('removes terminal jobs before re-enqueueing a still-queued task', async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const terminalJob = { getState: vi.fn().mockResolvedValue('failed'), remove };
    getJob.mockResolvedValue(terminalJob);
    const queue = new BullMqTaskQueue({ redisUrl: 'redis://localhost:6379', queueName: 'test-atlas-requeue' });

    await queue.enqueue({
      task: { id: 'task-requeue' } as never,
      agent: {} as never,
      prompt: 'requeue task'
    });

    expect(remove).toHaveBeenCalledOnce();
    expect(add).toHaveBeenCalledWith(
      'agent-task',
      expect.objectContaining({ prompt: 'requeue task' }),
      expect.objectContaining({ jobId: 'task-requeue' })
    );
    await queue.close();
  });
});
