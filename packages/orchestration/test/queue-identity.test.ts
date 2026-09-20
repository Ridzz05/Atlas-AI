import { describe, expect, it } from 'vitest';
import { primaryJobId, probedJobIds } from '../src/queue/bullmq-task-queue.js';
import { TaskJobData } from '../src/queue/task-queue.js';

/**
 * The queue's identity contract.
 *
 * `enqueue` keys a job on `data.runId || data.task.id`, and `defer` on `deferred:` + the same.
 * `hasPending(taskId)` probed only `taskId` and `deferred:taskId`, so a job that carried a runId
 * was invisible to it. Jobs with a runId are produced by the approval resume and the workflow
 * resume, and the worker's recovery sweep lists tasks in status `queued` — it saw `hasPending`
 * return false for such a task and enqueued it again under `taskId`, producing a second BullMQ job
 * while the first was still waiting. Both then passed the at-most-once precondition, because that
 * check is a read-then-act with no compare-and-set.
 *
 * The invariant that keeps this honest: whatever key `enqueue` would create must be in the set
 * `hasPending` probes. Both sides now derive from the same helper.
 */
describe('queue job identity', () => {
  const task = { id: 'task-1' } as TaskJobData['task'];
  const agent = { id: 'chief' } as TaskJobData['agent'];

  it('probes the exact job id that enqueue would create, for every job shape', () => {
    const shapes: TaskJobData[] = [
      { task, agent, prompt: 'go' },
      { task, agent, prompt: 'go', runId: 'run-1' }
    ];

    for (const data of shapes) {
      const enqueueKey = primaryJobId(data);
      const probed = probedJobIds({ taskId: data.task.id, runId: data.runId });

      expect(probed, `enqueue key ${enqueueKey} must be probed`).toContain(enqueueKey);
      // The defer path must be visible too, or a paused task looks absent and is re-enqueued.
      expect(probed).toContain(`deferred:${enqueueKey}`);
    }
  });

  it('keys a runId job on the runId, not the taskId', () => {
    expect(primaryJobId({ task, agent, prompt: 'go', runId: 'run-1' })).toBe('run-1');
    expect(primaryJobId({ task, agent, prompt: 'go' })).toBe('task-1');
  });

  it('probes both identities so a recovery sweep cannot double-enqueue', () => {
    const probed = probedJobIds({ taskId: 'task-1', runId: 'run-1' });

    expect(new Set(probed)).toEqual(new Set(['task-1', 'deferred:task-1', 'run-1', 'deferred:run-1']));
  });

  it('probes only the task identity when there is no run', () => {
    expect(probedJobIds({ taskId: 'task-1' })).toEqual(['task-1', 'deferred:task-1']);
  });
});
