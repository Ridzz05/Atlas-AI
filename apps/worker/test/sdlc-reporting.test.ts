import { describe, it, expect, vi } from 'vitest';
import { AgentWorkerRunner } from '../src/worker.js';
import { EnvConfigSchema, Task, AgentDefinition } from '@atlas/shared';
import { MockModelProvider, ModelProvider, ModelRunRequest, ModelRunResult } from '@atlas/providers';

/**
 * The worker is what turns a finished SDLC phase task into an initiative transition. This
 * pins the reporting contract: the task row is read back after the run, its terminal status
 * becomes the phase outcome, and the agent's output is forwarded to the coordinator.
 *
 * The status -> outcome mapping itself is unit-tested in @atlas/orchestration
 * (`phaseOutcomeFromTaskStatus`); these tests prove the wiring.
 */
describe('worker SDLC phase reporting', () => {
  const config = EnvConfigSchema.parse({ NODE_ENV: 'test' });

  const sdlcTask: Task = {
    id: '123e4567-e89b-12d3-a456-426614174010',
    parentId: null,
    title: '[SDLC inception] Market Intelligence',
    goal: 'Produce a strategic brief',
    assignedAgent: 'ned',
    depth: 0,
    status: 'queued',
    priority: 'high',
    context: { sdlcInitiativeId: '123e4567-e89b-12d3-a456-426614174099', sdlcPhase: 'inception' },
    plan: null,
    result: null,
    error: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null
  };

  const nedAgent: AgentDefinition = {
    id: 'ned',
    name: 'Ned',
    role: 'researcher',
    version: 1,
    description: 'Research specialist',
    systemPrompt: 'You are Ned',
    limits: { maxTurns: 3, maxDelegationDepth: 1, timeoutSeconds: 5, maxCostUsd: 0.75 },
    permissions: { tools: [], dataScopes: [], externalWrites: false },
    modelPolicy: { preferredTier: 'balanced', fallbackTier: 'fast', temperature: 0.1 },
    review: { humanApprovalFor: [] }
  };

  class FailingProvider implements ModelProvider {
    public readonly id = 'failing';
    public readonly name = 'Failing Provider';

    public estimateCost(): number {
      return 0;
    }

    public async run(_request: ModelRunRequest): Promise<ModelRunResult> {
      throw new Error('provider exploded');
    }
  }

  /**
   * A mutable task row, like the real one: it starts `queued` so the worker's at-most-once
   * precondition lets the job through, and the runner's own terminal write moves it to the
   * end state that reportPhaseResult then reads back.
   */
  function buildMutableTaskRepo() {
    const stored: any = { ...sdlcTask, status: 'queued', result: null };
    return {
      stored,
      repo: {
        findById: vi.fn(async () => ({ ...stored })),
        updateStatus: vi.fn(async (_id: string, status: string, options?: { result?: Record<string, unknown> }) => {
          stored.status = status;
          if (options?.result) stored.result = options.result;
          return { ...stored };
        }),
        list: vi.fn().mockResolvedValue([])
      } as any
    };
  }

  async function runJob(provider: ModelProvider) {
    const { repo, stored } = buildMutableTaskRepo();
    const sdlcEngine = { recordPhaseResult: vi.fn().mockResolvedValue(null) } as any;

    const runner = new AgentWorkerRunner({ config, provider, taskRepo: repo, sdlcEngine });
    await runner.start();
    await runner.getQueue().enqueue({ task: sdlcTask, agent: nedAgent, prompt: sdlcTask.goal });
    await new Promise(resolve => setTimeout(resolve, 150));
    await runner.stop();

    return { sdlcEngine, repo, stored };
  }

  it('reports a completed phase with the agent output', async () => {
    const provider = new MockModelProvider({ cannedResponses: [{ content: '{"title":"Brief"}' }] });
    const { sdlcEngine, stored } = await runJob(provider);

    expect(stored.status).toBe('completed');
    expect(sdlcEngine.recordPhaseResult).toHaveBeenCalledTimes(1);

    const [taskId, payload] = sdlcEngine.recordPhaseResult.mock.calls[0];
    expect(taskId).toBe(sdlcTask.id);
    expect(payload).toMatchObject({ outcome: 'completed' });
    expect(payload.output).toContain('{"title":"Brief"}');
  });

  it('reports the failed outcome when the run itself failed', async () => {
    const { sdlcEngine, stored } = await runJob(new FailingProvider());

    expect(stored.status).toBe('failed');
    expect(sdlcEngine.recordPhaseResult).toHaveBeenCalledTimes(1);
    expect(sdlcEngine.recordPhaseResult.mock.calls[0][1]).toMatchObject({ outcome: 'failed' });
  });

  it('does not report when the task never reached a terminal state', async () => {
    const provider = new MockModelProvider({ cannedResponses: [{ content: 'x' }] });
    const { repo } = buildMutableTaskRepo();
    // The repository never reflects an end state, so there is nothing to report.
    repo.updateStatus = vi.fn(async () => ({ ...sdlcTask, status: 'running' }));
    const sdlcEngine = { recordPhaseResult: vi.fn().mockResolvedValue(null) } as any;

    const runner = new AgentWorkerRunner({ config, provider, taskRepo: repo, sdlcEngine });
    await runner.start();
    await runner.getQueue().enqueue({ task: sdlcTask, agent: nedAgent, prompt: sdlcTask.goal });
    await new Promise(resolve => setTimeout(resolve, 150));
    await runner.stop();

    expect(sdlcEngine.recordPhaseResult).not.toHaveBeenCalled();
  });
});
