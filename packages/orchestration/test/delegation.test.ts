import { describe, it, expect, vi } from 'vitest';
import { TaskDelegator } from '../src/index.js';
import { defaultAgentRegistry } from '@atlas/agents';
import { MockModelProvider, ModelProvider } from '@atlas/providers';
import { InMemoryEventBus } from '@atlas/events';
import { Task, TaskPlan } from '@atlas/shared';

describe('@atlas/orchestration TaskDelegator tests', () => {
  const parentTask: Task = {
    id: 'parent-task-1234-5678-90ab-cdef12345678',
    parentId: null,
    title: 'Palembang Gym Lead Campaign',
    goal: 'Find 30 gym leads in Palembang, score them, create outreach drafts, and verify with QA.',
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

  it('delegates through multi-agent DAG (Ned -> Layla -> Hermes -> Argus -> Chief)', async () => {
    const provider = new MockModelProvider({
      cannedResponses: [
        // 1. Planner response
        {
          content: JSON.stringify({
            goal: 'Palembang Gym Lead Campaign',
            assumptions: [],
            questions: [],
            steps: [
              { id: 'step_1', agent: 'ned', objective: 'Collect 30 gym leads in Palembang', depends_on: [], parallelizable: true },
              {
                id: 'step_2',
                agent: 'layla',
                objective: 'Score and qualify candidate gyms',
                depends_on: ['step_1'],
                parallelizable: false
              },
              {
                id: 'step_3',
                agent: 'hermes',
                objective: 'Draft WhatsApp outreach copies for top 10',
                depends_on: ['step_2'],
                parallelizable: false
              }
            ],
            approval_points: ['communication.send_approved'],
            estimated_cost_usd: 0.8
          })
        },
        // 2. Ned execution
        { content: 'Ned findings: Gathered 30 gyms in Palembang with addresses and phone numbers.' },
        // 3. Layla execution
        { content: 'Layla evaluation: Scored 30 gyms, top 10 gyms qualified with ICP score > 85.' },
        // 4. Hermes execution
        { content: 'Hermes drafts: Created 10 personalized WhatsApp CRM pitch drafts.' },
        // 5. Argus QA evaluation
        {
          content: JSON.stringify({
            verdict: 'PASS',
            findings: ['All phone numbers and addresses verified', 'Scores matched rubric'],
            recommendations: ['Request user approval before sending messages']
          })
        },
        // 6. Chief Final Synthesis
        {
          content:
            'Chief Executive Summary: Successfully identified 30 gyms in Palembang. 10 qualified leads prepared with customized WhatsApp outreach drafts. Pending human approval.'
        }
      ]
    });

    const eventBus = new InMemoryEventBus();
    const delegator = new TaskDelegator({
      provider,
      registry: defaultAgentRegistry,
      eventBus
    });

    const result = await delegator.executePlan(parentTask);

    expect(result.status).toBe('completed');
    expect(result.subtaskResults.size).toBe(3);
    expect(result.subtaskResults.get('step_1')?.agentId).toBe('ned');
    expect(result.subtaskResults.get('step_2')?.agentId).toBe('layla');
    expect(result.subtaskResults.get('step_3')?.agentId).toBe('hermes');
    expect(result.qaResult?.verdict).toBe('PASS');
    expect(result.finalSynthesis).toContain('Chief Executive Summary');
  });

  it('reports planner, specialist, QA, and synthesis costs in the delegation result', async () => {
    const responses = [
      JSON.stringify({
        goal: 'Cost reporting task',
        steps: [{ id: 'step_1', agent: 'ned', objective: 'Return evidence', depends_on: [] }],
        approval_points: [],
        estimated_cost_usd: 0.1
      }),
      'Evidence with citations.',
      JSON.stringify({ verdict: 'PASS', findings: [], recommendations: [] }),
      'Synthesis.'
    ];
    const costs = [0.01, 0.02, 0.03, 0.04];
    let callIndex = 0;
    const provider: ModelProvider = {
      id: 'cost-test',
      name: 'Cost Test Provider',
      estimateCost: vi.fn(() => 0),
      run: vi.fn(async () => ({
        content: responses[callIndex],
        toolCalls: [],
        inputTokens: 1,
        outputTokens: 1,
        costUsd: costs[callIndex++],
        finishReason: 'stop' as const
      }))
    };

    const delegator = new TaskDelegator({
      provider,
      registry: defaultAgentRegistry,
      eventBus: new InMemoryEventBus()
    });

    const result = await delegator.executePlan(parentTask);

    expect(result.status).toBe('completed');
    expect(result.totalCostUsd).toBeCloseTo(0.1, 8);
  });

  it('rejects child delegation if parent depth is already at max limit', async () => {
    const deepParentTask: Task = {
      ...parentTask,
      depth: 2 // Max depth reached
    };

    const provider = new MockModelProvider({
      cannedResponses: [
        {
          content: JSON.stringify({
            goal: 'Deep task',
            steps: [{ id: 'step_1', agent: 'ned', objective: 'Too deep', depends_on: [] }],
            approval_points: [],
            estimated_cost_usd: 0.1
          })
        }
      ]
    });

    const eventBus = new InMemoryEventBus();
    const delegator = new TaskDelegator({
      provider,
      registry: defaultAgentRegistry,
      eventBus
    });

    await expect(delegator.executePlan(deepParentTask)).rejects.toThrow('exceeds maximum allowed depth');
  });

  it('honors the configured global delegation depth limit', async () => {
    const parentAtConfiguredLimit: Task = {
      ...parentTask,
      depth: 1
    };
    const provider = new MockModelProvider({
      cannedResponses: [
        {
          content: JSON.stringify({
            goal: 'Configured depth task',
            steps: [{ id: 'step_1', agent: 'ned', objective: 'Too deep for configured limit', depends_on: [] }],
            approval_points: [],
            estimated_cost_usd: 0.1
          })
        }
      ]
    });

    const delegator = new TaskDelegator({
      provider,
      registry: defaultAgentRegistry,
      eventBus: new InMemoryEventBus(),
      maxDelegationDepth: 1
    });

    await expect(delegator.executePlan(parentAtConfiguredLimit)).rejects.toThrow('exceeds maximum allowed depth of 1');
  });

  it('does not synthesize or complete a task when Argus blocks the result', async () => {
    const provider = new MockModelProvider({
      cannedResponses: [
        {
          content: JSON.stringify({
            goal: 'QA blocked task',
            steps: [{ id: 'step_1', agent: 'ned', objective: 'Return evidence', depends_on: [] }],
            approval_points: [],
            estimated_cost_usd: 0.1
          })
        },
        { content: 'Evidence without citations.' },
        { content: '{not-json' }
      ]
    });

    const delegator = new TaskDelegator({
      provider,
      registry: defaultAgentRegistry,
      eventBus: new InMemoryEventBus()
    });

    const result = await delegator.executePlan(parentTask);

    expect(result.status).toBe('failed');
    expect(result.qaResult?.verdict).toBe('BLOCKED');
    expect(result.finalSynthesis).toContain('Task blocked by Argus QA gate');
  });

  it('pauses the parent task when a child run is waiting for approval', async () => {
    const provider = new MockModelProvider({
      cannedResponses: [
        {
          content: JSON.stringify({
            goal: 'Approval task',
            steps: [{ id: 'step_1', agent: 'hermes', objective: 'Prepare protected send', depends_on: [] }],
            approval_points: ['communication.send_approved'],
            estimated_cost_usd: 0.1
          })
        },
        {
          content: 'Requesting approval',
          toolCalls: [{ id: 'tc-approval', name: 'communication.send_approved', arguments: {} }]
        }
      ]
    });
    const toolExecutor = {
      execute: vi.fn().mockResolvedValue({
        success: false,
        approvalPending: true,
        approvalId: '123e4567-e89b-12d3-a456-426614174003',
        error: 'Waiting for human approval.'
      })
    };
    const delegator = new TaskDelegator({
      provider,
      registry: defaultAgentRegistry,
      eventBus: new InMemoryEventBus(),
      toolExecutor
    });

    const result = await delegator.executePlan(parentTask);

    expect(result.status).toBe('waiting_approval');
    expect(result.approvalId).toBe('123e4567-e89b-12d3-a456-426614174003');
    expect(result.finalSynthesis).toContain('waiting for human approval');
  });

  it('routes planner, specialist, QA, and synthesis model calls through durable budget accounting', async () => {
    const provider = new MockModelProvider({
      cannedResponses: [
        {
          content: JSON.stringify({
            goal: 'Budgeted task',
            steps: [{ id: 'step_1', agent: 'ned', objective: 'Return evidence', depends_on: [] }],
            approval_points: [],
            estimated_cost_usd: 0.1
          })
        },
        { content: 'Evidence with citations.' },
        { content: JSON.stringify({ verdict: 'PASS', findings: [], recommendations: [] }) },
        { content: 'Budgeted synthesis.' }
      ]
    });
    const runRepo = {
      create: vi.fn(),
      acquireLease: vi.fn(async () => ({ id: 'leased-run' })),
      updateStatus: vi.fn(async (_runId: string, status: string) => ({ status })),
      recordTurn: vi.fn(async () => undefined)
    } as any;
    const budgetRepo = {
      reserve: vi.fn(async ({ runId }: { runId: string }) => ({ id: `reservation-${runId}` })),
      commit: vi.fn(async (id: string, costUsd: number) => ({ id, status: 'committed', committedCostUsd: costUsd }))
    } as any;
    const delegator = new TaskDelegator({
      provider,
      registry: defaultAgentRegistry,
      eventBus: new InMemoryEventBus(),
      runRepo,
      budgetRepo,
      globalDailyBudgetUsd: 5
    });

    const result = await delegator.executePlan(parentTask);

    expect(result.status).toBe('completed');
    expect(budgetRepo.reserve).toHaveBeenCalledTimes(4);
    expect(budgetRepo.commit).toHaveBeenCalledTimes(4);
  });
});
