import { describe, it, expect, vi } from 'vitest';
import { AgentWorkerRunner } from '../src/worker.js';
import { EnvConfigSchema, Task, AgentDefinition } from '@atlas/shared';
import { ModelProvider, ModelRunRequest, ModelRunResult } from '@atlas/providers';

/**
 * Characterisation tests for the worker's job precondition.
 *
 * The failure these pin down: BullMQ retries a job (`attempts: 3`), and the worker handler
 * had no precondition on the task's current status. Each attempt also minted a fresh runId
 * when the job carried none, so the lease could not deduplicate two attempts of the same
 * task. A retry therefore re-ran the whole task — duplicate provider spend, duplicate
 * artifact writes, duplicate tool side effects — instead of resuming or being rejected.
 *
 * The precondition: at handler entry a task may be `queued` (fresh) or `approval_pending`
 * (resume). Anything else means the work is already in flight or already finished.
 */

class CountingProvider implements ModelProvider {
  public readonly id = 'counting';
  public readonly name = 'Counting Provider';
  public calls = 0;

  public estimateCost(): number {
    return 0;
  }

  public async run(request: ModelRunRequest): Promise<ModelRunResult> {
    this.calls += 1;
    return { content: 'done', toolCalls: [], inputTokens: 5, outputTokens: 5, costUsd: 0, costUsdKnown: true, finishReason: 'stop' };
  }
}

const config = EnvConfigSchema.parse({ NODE_ENV: 'test' });

const agent: AgentDefinition = {
  id: 'ned',
  name: 'Ned',
  role: 'researcher',
  version: 1,
  description: 'Research specialist',
  systemPrompt: 'You are Ned',
  limits: { maxTurns: 2, maxDelegationDepth: 1, timeoutSeconds: 30, maxCostUsd: 0.75 },
  permissions: { tools: [], dataScopes: [], externalWrites: false },
  modelPolicy: { preferredTier: 'balanced', fallbackTier: 'fast', temperature: 0.1 },
  review: { humanApprovalFor: [] }
};

function buildTask(status: string): Task {
  return {
    id: '123e4567-e89b-12d3-a456-426614174300',
    parentId: null,
    title: 'Idempotency task',
    goal: 'Must run at most once',
    assignedAgent: 'ned',
    depth: 0,
    status: status as any,
    priority: 'normal',
    context: {},
    plan: null,
    result: null,
    error: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null
  };
}

async function runJobWithTaskStatus(status: string) {
  const provider = new CountingProvider();
  const task = buildTask(status);
  const taskRepo = {
    findById: vi.fn(async () => task),
    updateStatus: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue([])
  } as any;

  const runner = new AgentWorkerRunner({ config, provider, taskRepo });
  await runner.start();
  await runner.getQueue().enqueue({ task, agent, prompt: task.goal });
  await new Promise(resolve => setTimeout(resolve, 120));
  await runner.stop();

  return { provider, taskRepo };
}

describe('worker job precondition (at-most-once execution)', () => {
  it('runs a queued task', async () => {
    const { provider } = await runJobWithTaskStatus('queued');
    expect(provider.calls).toBeGreaterThan(0);
  });

  it('does not re-run a task that is already completed', async () => {
    const { provider } = await runJobWithTaskStatus('completed');
    expect(provider.calls).toBe(0);
  });

  it('does not re-run a task that is already failed', async () => {
    const { provider } = await runJobWithTaskStatus('failed');
    expect(provider.calls).toBe(0);
  });

  it('does not re-run a task that is already cancelled', async () => {
    const { provider } = await runJobWithTaskStatus('cancelled');
    expect(provider.calls).toBe(0);
  });

  it('does not start a second concurrent attempt on a running task', async () => {
    const { provider } = await runJobWithTaskStatus('running');
    expect(provider.calls).toBe(0);
  });

  it('still resumes a task that is waiting for approval', async () => {
    const { provider } = await runJobWithTaskStatus('approval_pending');
    expect(provider.calls).toBeGreaterThan(0);
  });
});
