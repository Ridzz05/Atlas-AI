import { describe, expect, it, vi } from 'vitest';
import { AgentRunner } from '../src/engine/agent-runner.js';
import { InMemoryEventBus } from '@atlas/events';
import { Task, AgentDefinition } from '@atlas/shared';
import { ModelProvider, ModelRunRequest, ModelRunResult } from '@atlas/providers';

/**
 * A run that did not finish must not be reported as finished.
 *
 * The turn loop exits when `turnsCount` reaches `maxTurns`, and the only handling was
 * `if (turnsCount >= maxTurns && !finalContent) finalContent = 'Task completed: Maximum turns
 * reached.'`. A model that emits any text alongside its tool calls leaves `finalContent`
 * non-empty, so the condition never fired and the run was written `completed` with the child task
 * `completed` — a truncated, unfinished subtask presented to the user as a deliverable, then fed
 * to Argus and the synthesiser. The provider's `length` finish reason was mapped correctly by the
 * adapter and then never acted on either.
 */
const task: Task = {
  id: '123e4567-e89b-12d3-a456-426614174100',
  parentId: null,
  title: 'Truncation probe',
  goal: 'Keep calling tools until the budget runs out.',
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

/** Never stops asking for a tool, and always returns some text alongside it. */
class EndlessToolProvider implements ModelProvider {
  public readonly id = 'endless';
  public readonly name = 'Endless Tool Provider';

  public estimateCost(): number {
    return 0;
  }

  public async run(_request: ModelRunRequest): Promise<ModelRunResult> {
    return {
      content: 'Let me look that up.',
      toolCalls: [{ id: 'call-1', name: 'memory.search', arguments: { query: 'x' } }],
      inputTokens: 5,
      outputTokens: 5,
      costUsd: 0,
      costUsdKnown: true,
      finishReason: 'tool_calls'
    };
  }
}

/** Answers once, then reports the provider truncated the response. */
class TruncatedProvider implements ModelProvider {
  public readonly id = 'truncated';
  public readonly name = 'Truncated Provider';

  public estimateCost(): number {
    return 0;
  }

  public async run(_request: ModelRunRequest): Promise<ModelRunResult> {
    return {
      content: 'A partial answer that stops mid-',
      toolCalls: [],
      inputTokens: 5,
      outputTokens: 5,
      costUsd: 0,
      costUsdKnown: true,
      finishReason: 'length'
    };
  }
}

function buildRunner(provider: ModelProvider) {
  const updateStatus = vi.fn(async () => null);
  const runRepo = {
    create: vi.fn(async (input: any) => ({ id: input.id || 'run-1', ...input, status: 'active' })),
    updateStatus,
    acquireLease: vi.fn(async () => ({ id: 'run-1' })),
    heartbeat: vi.fn(async () => true),
    recordTurn: vi.fn(async () => undefined)
  };
  const taskRepo = { updateStatus: vi.fn(async () => undefined) };
  const toolExecutor = {
    execute: vi.fn(async () => ({ success: true, output: { ok: true } })),
    getToolDefinitions: vi.fn(() => [{ name: 'memory.search', description: 'search', parameters: { type: 'object', properties: {} } }])
  };

  const runner = new AgentRunner({
    provider,
    eventBus: new InMemoryEventBus(),
    runRepo: runRepo as any,
    taskRepo: taskRepo as any,
    toolExecutor: toolExecutor as any,
    workerId: 'worker-a'
  });

  return { runner, runRepo, taskRepo, toolExecutor };
}

describe('AgentRunner truncation reporting', () => {
  it('fails a run that exhausted its turn budget while still calling tools', async () => {
    const { runner, runRepo, taskRepo } = buildRunner(new EndlessToolProvider());

    const summary = await runner.run({ task, agent, initialPrompt: 'go' });

    expect(summary.status).toBe('failed');
    expect(summary.error).toMatch(/turn/i);
    expect(runRepo.updateStatus).toHaveBeenCalledWith(expect.any(String), 'failed', expect.any(String), 'worker-a');
    expect(taskRepo.updateStatus).toHaveBeenCalledWith(task.id, 'failed', expect.anything());
  });

  it('fails a run the provider truncated instead of presenting a partial answer', async () => {
    const { runner, runRepo, taskRepo } = buildRunner(new TruncatedProvider());

    const summary = await runner.run({ task, agent, initialPrompt: 'go' });

    expect(summary.status).toBe('failed');
    expect(runRepo.updateStatus).toHaveBeenCalledWith(expect.any(String), 'failed', expect.any(String), 'worker-a');
    expect(taskRepo.updateStatus).toHaveBeenCalledWith(task.id, 'failed', expect.anything());
  });

  // With no toolExecutor the output defaulted to { success: true }, so the tool_calls row was
  // completed as 'success', a {"success":true} message was persisted and fed back into the
  // conversation, and the run reported completed — a fabricated tool result and a durable audit
  // record claiming an action succeeded when nothing executed.
  it('fails closed when the model requests a tool and no executor is configured', async () => {
    const provider = new EndlessToolProvider();
    const toolCallRepo = {
      create: vi.fn(async () => ({ id: 'tool-call-1' })),
      complete: vi.fn(async () => undefined)
    };
    const runRepo = {
      create: vi.fn(async (input: any) => ({ id: input.id || 'run-1', ...input, status: 'active' })),
      updateStatus: vi.fn(async () => null),
      acquireLease: vi.fn(async () => ({ id: 'run-1' })),
      heartbeat: vi.fn(async () => true),
      recordTurn: vi.fn(async () => undefined)
    };

    const runner = new AgentRunner({
      provider,
      eventBus: new InMemoryEventBus(),
      runRepo: runRepo as any,
      toolCallRepo: toolCallRepo as any,
      workerId: 'worker-a'
      // no toolExecutor
    });

    const summary = await runner.run({ task, agent, initialPrompt: 'go' });

    expect(summary.status).toBe('failed');
    expect(summary.error).toMatch(/no tool executor/i);
    expect(toolCallRepo.complete).toHaveBeenCalledWith('tool-call-1', expect.objectContaining({ status: 'failed' }));
  });
});
