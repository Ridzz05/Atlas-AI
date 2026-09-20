import { describe, it, expect, vi } from 'vitest';
import { TaskDelegator } from '../src/index.js';
import { defaultAgentRegistry } from '@atlas/agents';
import { MockModelProvider, ModelProvider } from '@atlas/providers';
import { InMemoryEventBus } from '@atlas/events';
import { Task } from '@atlas/shared';

/**
 * Characterisation tests for cancellation and tool access inside the delegation graph.
 *
 * Two gaps:
 *
 * 1. A cancel requested in another process never reached the delegation graph. The worker
 *    calls `executePlan(task, undefined, ...)`, so the signal was always undefined, and the
 *    delegator never consulted the durable cancellation store for the parent orchestrator
 *    task. An emergency stop therefore left the planner, every specialist, the QA gate and
 *    the synthesiser running to completion.
 * 2. The planner/QA/synthesis stage runner was built without a `toolExecutor`, so Argus
 *    could not call `policy.verify` even though its allowlist grants it.
 */

const parentTask: Task = {
  id: 'parent-task-1234-5678-90ab-cdef12345678',
  parentId: null,
  title: 'Cancellable campaign',
  goal: 'Run a delegation graph that must honour a durable cancel.',
  assignedAgent: 'chief',
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

function buildProvider() {
  return new MockModelProvider({
    cannedResponses: [
      {
        content: JSON.stringify({
          goal: 'Cancellable campaign',
          assumptions: [],
          questions: [],
          steps: [{ id: 'step_1', agent: 'ned', objective: 'Collect evidence', depends_on: [] }],
          approval_points: [],
          estimated_cost_usd: 0.1
        })
      },
      { content: 'Ned findings.' },
      { content: JSON.stringify({ verdict: 'PASS', findings: [], recommendations: [] }) },
      { content: 'Chief synthesis.' }
    ]
  });
}

describe('TaskDelegator cancellation and stage tool access', () => {
  it('stops before running any subtask when the parent task has a durable cancel request', async () => {
    const provider = buildProvider();
    const runSpy = vi.spyOn(provider, 'run');
    const cancellationStore = {
      isCancellationRequested: vi.fn().mockResolvedValue({ requested: false }),
      isCancellationRequestedForTask: vi.fn().mockResolvedValue({ requested: true, reason: 'emergency stop' })
    };

    const delegator = new TaskDelegator({
      provider,
      registry: defaultAgentRegistry,
      eventBus: new InMemoryEventBus(),
      cancellationStore: cancellationStore as any
    });

    await expect(delegator.executePlan(parentTask)).rejects.toThrow(/cancel|abort/i);

    // The planner may have run (the cancel is checked before delegating), but no specialist
    // subtask and no QA/synthesis stage may have spent tokens.
    const prompts = runSpy.mock.calls.map(call => JSON.stringify((call[0] as any).messages));
    expect(prompts.some(prompt => prompt.includes('Collect evidence'))).toBe(false);
  });

  it('runs normally when no cancellation is requested', async () => {
    const provider = buildProvider();
    const cancellationStore = {
      isCancellationRequested: vi.fn().mockResolvedValue({ requested: false }),
      isCancellationRequestedForTask: vi.fn().mockResolvedValue({ requested: false })
    };

    const delegator = new TaskDelegator({
      provider,
      registry: defaultAgentRegistry,
      eventBus: new InMemoryEventBus(),
      cancellationStore: cancellationStore as any
    });

    const result = await delegator.executePlan(parentTask);

    expect(result.status).toBe('completed');
    expect(cancellationStore.isCancellationRequestedForTask).toHaveBeenCalledWith(parentTask.id);
  });

  it('honours a signal that is already aborted', async () => {
    const provider = buildProvider();
    const runSpy = vi.spyOn(provider, 'run');
    const controller = new AbortController();
    controller.abort('stopped by operator');

    const delegator = new TaskDelegator({
      provider,
      registry: defaultAgentRegistry,
      eventBus: new InMemoryEventBus()
    });

    await expect(delegator.executePlan(parentTask, controller.signal)).rejects.toThrow(/cancel|abort/i);

    const prompts = runSpy.mock.calls.map(call => JSON.stringify((call[0] as any).messages));
    expect(prompts.some(prompt => prompt.includes('Collect evidence'))).toBe(false);
  });

  it('gives the planner, QA and synthesis stages the same tool access as the specialists', async () => {
    // Argus holds `policy.verify` in its allowlist; the stage runner must be able to reach
    // the tool gateway or the QA gate can only ever judge from text. The stage runner is only
    // built when run and budget repositories are present, which is what production passes.
    const provider: ModelProvider = {
      id: 'stage-tools',
      name: 'Stage Tools Provider',
      estimateCost: vi.fn(() => 0),
      run: vi.fn(async (request: any) => {
        if (request.agentId === 'argus') {
          return {
            content: 'Assessing.',
            toolCalls: [{ id: 'call-1', name: 'policy.verify', arguments: { action: 'communication.send_approved' } }],
            inputTokens: 1,
            outputTokens: 1,
            costUsd: 0,
            finishReason: 'tool_calls' as const
          };
        }
        return {
          content: JSON.stringify({
            goal: 'Stage tools',
            assumptions: [],
            questions: [],
            steps: [{ id: 'step_1', agent: 'ned', objective: 'Collect evidence', depends_on: [] }],
            approval_points: [],
            estimated_cost_usd: 0.1
          }),
          toolCalls: [],
          inputTokens: 1,
          outputTokens: 1,
          costUsd: 0,
          finishReason: 'stop' as const
        };
      })
    };

    const runRepo = {
      create: vi.fn(async (input: any, id?: string) => ({ id: id || crypto.randomUUID(), ...input, status: 'active' })),
      updateStatus: vi.fn(async () => null),
      acquireLease: vi.fn(async () => ({ id: 'run' })),
      heartbeat: vi.fn(async () => true),
      recordTurn: vi.fn(async () => undefined)
    };
    const budgetRepo = {
      reserve: vi.fn(async () => 'reservation-1'),
      commit: vi.fn(async () => true),
      release: vi.fn(async () => true)
    };

    const toolExecutor = {
      execute: vi.fn(async () => ({ success: true, output: { requiresApproval: true } })),
      getToolDefinitions: vi.fn(() => [{ name: 'policy.verify', description: 'verify', parameters: { type: 'object', properties: {} } }])
    };

    const delegator = new TaskDelegator({
      provider,
      registry: defaultAgentRegistry,
      eventBus: new InMemoryEventBus(),
      runRepo: runRepo as any,
      budgetRepo: budgetRepo as any,
      globalDailyBudgetUsd: 5,
      toolExecutor: toolExecutor as any
    });

    await delegator.executePlan(parentTask);

    expect(toolExecutor.execute).toHaveBeenCalled();
    expect(toolExecutor.execute.mock.calls[0][0]).toMatchObject({ name: 'policy.verify' });
  });

  // A failing subtask threw straight out of executePlan. The parent row had already been set to
  // 'running' by updatePlan, so nothing ever wrote its failure: the next BullMQ attempt hit the
  // at-most-once precondition ('task_already_running'), was skipped, and the parent sat in
  // 'running' until the 15-minute orphan sweep, which reports a generic lease-expired reason and
  // throws away the real error. All three retries were wasted and SDLC phase reporting never ran.
  it('marks the parent task failed when a subtask fails, instead of leaving it running', async () => {
    const provider = buildProvider();
    let calls = 0;
    const original = provider.run.bind(provider);
    vi.spyOn(provider, 'run').mockImplementation(async (request: any) => {
      calls++;
      // Call 1 is the planner; call 2 is the specialist, which fails.
      if (calls === 2) throw new Error('provider exploded');
      return original(request);
    });

    const updateStatus = vi.fn(async () => undefined);
    const taskRepo = {
      updatePlan: vi.fn(async () => undefined),
      updateStatus,
      findChildren: vi.fn(async () => []),
      create: vi.fn(async (input: any) => ({
        id: crypto.randomUUID(),
        parentId: parentTask.id,
        title: input.title,
        goal: input.goal,
        assignedAgent: input.assignedAgent,
        depth: 1,
        status: 'queued',
        priority: 'normal',
        context: {},
        plan: null,
        result: null,
        error: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        completedAt: null
      }))
    };

    const delegator = new TaskDelegator({
      provider,
      registry: defaultAgentRegistry,
      eventBus: new InMemoryEventBus(),
      taskRepo: taskRepo as any
    });

    await expect(delegator.executePlan(parentTask)).rejects.toThrow();

    const parentFailure = updateStatus.mock.calls.find(call => call[0] === parentTask.id && call[1] === 'failed');
    expect(parentFailure).toBeDefined();
    // The real cause must survive into the durable row.
    expect(JSON.stringify(parentFailure?.[2])).toContain('provider exploded');
  });
});
