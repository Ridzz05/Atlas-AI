import { describe, expect, it, vi } from 'vitest';
import { BullMqTaskQueue } from '../src/queue/bullmq-task-queue.js';

const add = vi.fn().mockResolvedValue({ id: 'job-1' });
const queueClose = vi.fn().mockResolvedValue(undefined);
const workerClose = vi.fn().mockResolvedValue(undefined);
const workerOn = vi.fn();

vi.mock('bullmq', () => ({
  Queue: class FakeQueue {
    add = add;
    close = queueClose;
  },
  Worker: class FakeWorker {
    on = workerOn;
    close = workerClose;
  }
}));

describe('BullMqTaskQueue', () => {
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

    await queue.defer({
      task: { id: 'task-deferred' } as never,
      agent: {} as never,
      prompt: 'wait for resume'
    }, 5000);

    expect(add).toHaveBeenLastCalledWith(
      'agent-task',
      expect.objectContaining({ prompt: 'wait for resume' }),
      expect.objectContaining({
        delay: 5000,
        attempts: 3,
        jobId: expect.stringMatching(/^deferred:task-deferred:/)
      })
    );
    await queue.close();
  });
});
