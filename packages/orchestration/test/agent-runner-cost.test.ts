import { describe, expect, it, vi } from 'vitest';
import { rootLogger } from '@atlas/observability';
import { AgentRunner } from '../src/engine/agent-runner.js';
import { InMemoryEventBus } from '@atlas/events';
import { AgentDefinition, Task } from '@atlas/shared';
import { ModelProvider, ModelRunRequest, ModelRunResult } from '@atlas/providers';

/**
 * When a provider cannot say what a run cost, the operator must be told the cap is not in force.
 *
 * `ModelRunResult.costUsd` was a bare number, and every provider that did not declare a price
 * returned 0 — so a run on a paid model with no declared price accumulated zero spend and the
 * per-run ceiling and the durable daily reservation both stayed silent. The cap existed, was
 * checked, and could not fire.
 *
 * `costUsdKnown` makes that state representable; this is where it is surfaced.
 */
const task: Task = {
  id: '123e4567-e89b-12d3-a456-426614174200',
  parentId: null,
  title: 'Cost probe',
  goal: 'Answer once.',
  assignedAgent: 'ned',
  depth: 0,
  status: 'queued',
  priority: 'normal',
  context: {},
  plan: null,
  result: null,
  error: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  completedAt: null
};

const agent: AgentDefinition = {
  id: 'ned',
  name: 'Ned',
  role: 'researcher',
  version: 1,
  description: 'Research specialist',
  systemPrompt: 'You are Ned',
  limits: { maxTurns: 2, maxDelegationDepth: 1, timeoutSeconds: 30, maxCostUsd: 1 },
  permissions: { tools: ['memory.search'], dataScopes: [], externalWrites: false },
  modelPolicy: { preferredTier: 'balanced', fallbackTier: 'fast', temperature: 0.1 },
  review: { humanApprovalFor: [] }
};

class CostReportingProvider implements ModelProvider {
  public readonly id = 'probe';
  public readonly name = 'Cost Probe Provider';

  constructor(private readonly costUsdKnown: boolean) {}

  public estimateCost(): number {
    return 0;
  }

  public async run(_request: ModelRunRequest): Promise<ModelRunResult> {
    return {
      content: 'Done.',
      toolCalls: [],
      inputTokens: 10,
      outputTokens: 10,
      costUsd: 0,
      costUsdKnown: this.costUsdKnown,
      finishReason: 'stop'
    };
  }
}

function buildRunner(provider: ModelProvider) {
  const runRepo = {
    create: vi.fn(async (input: any) => ({ id: input.id || 'run-1', ...input, status: 'active' })),
    updateStatus: vi.fn(async () => null),
    acquireLease: vi.fn(async () => ({ id: 'run-1' })),
    heartbeat: vi.fn(async () => true),
    recordTurn: vi.fn(async () => undefined)
  };
  const taskRepo = { updateStatus: vi.fn(async () => undefined) };

  return new AgentRunner({
    provider,
    eventBus: new InMemoryEventBus(),
    runRepo: runRepo as any,
    taskRepo: taskRepo as any,
    workerId: 'worker-a'
  });
}

describe('AgentRunner unknown-cost reporting', () => {
  it('warns once when a turn reports an unknown cost', async () => {
    const warnSpy = vi.spyOn(rootLogger, 'warn').mockImplementation(() => undefined);

    try {
      const runner = buildRunner(new CostReportingProvider(false));
      const summary = await runner.run({ task, agent, initialPrompt: 'go' });

      expect(summary.status).toBe('completed');
      const costWarnings = warnSpy.mock.calls.filter(call => (call[1] as Record<string, unknown>)?.providerId === 'probe');
      expect(costWarnings).toHaveLength(1);
      expect(String(costWarnings[0]?.[0])).toMatch(/cost/i);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('stays quiet when the provider reports a known cost', async () => {
    const warnSpy = vi.spyOn(rootLogger, 'warn').mockImplementation(() => undefined);

    try {
      const runner = buildRunner(new CostReportingProvider(true));
      await runner.run({ task, agent, initialPrompt: 'go' });

      expect(warnSpy.mock.calls.filter(call => (call[1] as Record<string, unknown>)?.providerId === 'probe')).toHaveLength(0);
    } finally {
      warnSpy.mockRestore();
    }
  });
});
