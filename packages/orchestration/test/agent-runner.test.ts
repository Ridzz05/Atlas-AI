import { describe, it, expect, vi } from 'vitest';
import { AgentRunner } from '../src/index.js';
import { MockModelProvider } from '@atlas/providers';
import { InMemoryEventBus } from '@atlas/events';
import { Task, AgentDefinition } from '@atlas/shared';

describe('@atlas/orchestration AgentRunner tests', () => {
  const mockTask: Task = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    parentId: null,
    title: 'Test Single Agent Task',
    goal: 'Test single agent run',
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

  const mockAgent: AgentDefinition = {
    id: 'chief',
    name: 'Chief',
    role: 'orchestrator',
    version: 1,
    description: 'Root Orchestrator',
    systemPrompt: 'You are Chief.',
    limits: {
      maxTurns: 5,
      maxDelegationDepth: 2,
      timeoutSeconds: 5,
      maxCostUsd: 0.5
    },
    permissions: { tools: [], dataScopes: [], externalWrites: false },
    modelPolicy: { preferredTier: 'balanced', fallbackTier: 'fast', temperature: 0.2 },
    review: { humanApprovalFor: [] }
  };

  it('successfully executes a single-agent task run', async () => {
    const provider = new MockModelProvider({
      cannedResponses: [
        { content: 'Here is the completed solution for the task.' }
      ]
    });
    const eventBus = new InMemoryEventBus();
    const eventsReceived: string[] = [];
    eventBus.subscribe('*', (ev) => {
      eventsReceived.push(ev.type);
    });

    const runner = new AgentRunner({ provider, eventBus });

    const summary = await runner.run({
      task: mockTask,
      agent: mockAgent,
      initialPrompt: 'Do the task'
    });

    expect(summary.status).toBe('completed');
    expect(summary.turnsCount).toBe(1);
    expect(summary.finalContent).toBe('Here is the completed solution for the task.');
    expect(summary.totalCostUsd).toBeGreaterThan(0);
    expect(eventsReceived).toContain('run.started');
    expect(eventsReceived).toContain('run.turn_completed');
    expect(eventsReceived).toContain('run.completed');
  });

  it('handles multi-turn tool execution loop', async () => {
    const provider = new MockModelProvider({
      cannedResponses: [
        {
          content: 'I will search memory first',
          toolCalls: [{ id: 'tc-1', name: 'memory.search', arguments: { query: 'gyms' } }]
        },
        {
          content: 'Final synthesis with memory results.'
        }
      ]
    });

    const eventBus = new InMemoryEventBus();
    const toolExecutor = {
      execute: vi.fn().mockResolvedValue({ items: ['gym1', 'gym2'] })
    };

    const runner = new AgentRunner({ provider, eventBus, toolExecutor });

    const summary = await runner.run({
      task: mockTask,
      agent: mockAgent,
      initialPrompt: 'Find info'
    });

    expect(summary.status).toBe('completed');
    expect(summary.turnsCount).toBe(2);
    expect(toolExecutor.execute).toHaveBeenCalledTimes(1);
    expect(summary.finalContent).toBe('Final synthesis with memory results.');
  });

  it('cancels active run on demand', async () => {
    const provider = new MockModelProvider({
      cannedResponses: [
        { content: 'Delayed turn', delayMs: 200 }
      ]
    });
    const eventBus = new InMemoryEventBus();
    const runner = new AgentRunner({ provider, eventBus });

    const runPromise = runner.run({
      runId: 'run-cancel-test',
      task: mockTask,
      agent: mockAgent,
      initialPrompt: 'Long task'
    });

    setTimeout(() => {
      runner.cancelRun('run-cancel-test', 'User stopped');
    }, 20);

    const summary = await runPromise;
    expect(summary.status).toBe('cancelled');
    expect(summary.error).toContain('User stopped');
  });

  it('honors a cancellation request written by another process before calling the provider', async () => {
    const provider = {
      run: vi.fn().mockResolvedValue({
        content: 'must not run',
        inputTokens: 1,
        outputTokens: 1,
        costUsd: 0.001,
        finishReason: 'stop'
      })
    } as any;
    const cancellationStore = {
      isCancellationRequested: vi.fn().mockResolvedValue({ requested: true, reason: 'remote stop' })
    };
    const runner = new AgentRunner({
      provider,
      eventBus: new InMemoryEventBus(),
      cancellationStore
    });

    const summary = await runner.run({
      runId: '123e4567-e89b-12d3-a456-426614174006',
      task: mockTask,
      agent: mockAgent,
      initialPrompt: 'Remote cancellation test'
    });

    expect(summary.status).toBe('cancelled');
    expect(summary.error).toContain('remote stop');
    expect(provider.run).not.toHaveBeenCalled();
  });

  it('does not complete when another process requests cancellation during the provider call', async () => {
    const provider = {
      run: vi.fn().mockResolvedValue({
        content: 'provider returned after remote stop',
        inputTokens: 1,
        outputTokens: 1,
        costUsd: 0.001,
        finishReason: 'stop'
      })
    } as any;
    const cancellationStore = {
      isCancellationRequested: vi.fn()
        .mockResolvedValueOnce({ requested: false })
        .mockResolvedValueOnce({ requested: true, reason: 'remote stop during call' })
    };
    const runner = new AgentRunner({
      provider,
      eventBus: new InMemoryEventBus(),
      cancellationStore
    });

    const summary = await runner.run({
      runId: '123e4567-e89b-12d3-a456-426614174007',
      task: mockTask,
      agent: mockAgent,
      initialPrompt: 'Remote cancellation during provider call'
    });

    expect(summary.status).toBe('cancelled');
    expect(summary.error).toContain('remote stop during call');
    expect(provider.run).toHaveBeenCalledTimes(1);
  });

  it('stops when cost ceiling is exceeded', async () => {
    const lowBudgetAgent: AgentDefinition = {
      ...mockAgent,
      limits: {
        ...mockAgent.limits,
        maxCostUsd: 0.000001 // extremely low budget
      }
    };

    const provider = new MockModelProvider({
      cannedResponses: [
        {
          content: 'Step 1',
          toolCalls: [{ id: 'tc-1', name: 'dummy.tool', arguments: {} }]
        },
        { content: 'Step 2' }
      ]
    });

    const eventBus = new InMemoryEventBus();
    const runner = new AgentRunner({ provider, eventBus });

    const summary = await runner.run({
      task: mockTask,
      agent: lowBudgetAgent,
      initialPrompt: 'Over budget test'
    });

    expect(summary.status).toBe('failed');
    expect(summary.error).toContain('Cost ceiling reached');
  });

  it('fails closed when a tool executor rejects a model tool call', async () => {
    const provider = new MockModelProvider({
      cannedResponses: [
        {
          content: 'Attempting a protected action.',
          toolCalls: [{ id: 'tc-protected', name: 'communication.send_approved', arguments: {} }]
        },
        { content: 'This must not be treated as completed.' }
      ]
    });
    const toolExecutor = {
      execute: vi.fn().mockResolvedValue({ success: false, error: 'Approval pending' })
    };

    const runner = new AgentRunner({
      provider,
      eventBus: new InMemoryEventBus(),
      toolExecutor
    });

    const summary = await runner.run({
      task: mockTask,
      agent: mockAgent,
      initialPrompt: 'Attempt protected action'
    });

    expect(summary.status).toBe('failed');
    expect(summary.error).toContain('Approval pending');
    expect(toolExecutor.execute).toHaveBeenCalledTimes(1);
  });

  it('pauses a run when a tool creates a pending human approval', async () => {
    const provider = new MockModelProvider({
      cannedResponses: [{
        content: 'Requesting approval.',
        toolCalls: [{ id: 'tc-approval', name: 'communication.send_approved', arguments: {} }]
      }]
    });
    const toolExecutor = {
      execute: vi.fn().mockResolvedValue({
        success: false,
        approvalPending: true,
        approvalId: '123e4567-e89b-12d3-a456-426614174003',
        error: 'Action requires human approval.'
      })
    };

    const runner = new AgentRunner({
      provider,
      eventBus: new InMemoryEventBus(),
      toolExecutor
    });

    const summary = await runner.run({
      task: mockTask,
      agent: mockAgent,
      initialPrompt: 'Request protected action'
    });

    expect(summary.status).toBe('waiting_approval');
    expect(summary.error).toContain('human approval');
    expect(summary.approvalId).toBe('123e4567-e89b-12d3-a456-426614174003');
  });

  it('resumes an existing run and refuses completion until approval is finalized', async () => {
    const provider = new MockModelProvider({ cannedResponses: [{ content: 'Protected action completed.' }] });
    const runRepo = {
      create: vi.fn(),
      updateStatus: vi.fn(async (_runId: string, status: string) => ({ status })),
      recordTurn: vi.fn(async () => undefined)
    } as any;
    const approvalExecutionStore = {
      claimExecution: vi.fn(),
      getExecutionStatus: vi.fn(async () => 'executed'),
      finalizeExecution: vi.fn()
    };
    const approvalToken = {
      requestId: '123e4567-e89b-12d3-a456-426614174004',
      action: 'communication.send_approved',
      payloadHash: 'payload-hash',
      signature: 'signed-token',
      expiresAt: Math.floor(Date.now() / 1000) + 300
    };
    const runner = new AgentRunner({
      provider,
      eventBus: new InMemoryEventBus(),
      runRepo,
      approvalExecutionStore
    });

    const summary = await runner.run({
      runId: '123e4567-e89b-12d3-a456-426614174005',
      approvalToken,
      task: mockTask,
      agent: mockAgent,
      initialPrompt: 'Resume protected action'
    });

    expect(summary.status).toBe('completed');
    expect(runRepo.create).not.toHaveBeenCalled();
    expect(runRepo.updateStatus).toHaveBeenCalledWith('123e4567-e89b-12d3-a456-426614174005', 'active');
    expect(approvalExecutionStore.getExecutionStatus).toHaveBeenCalledWith(approvalToken.requestId);
  });
});
