import { describe, it, expect, vi } from 'vitest';
import { TaskDelegator } from '../src/index.js';
import { defaultAgentRegistry } from '@atlas/agents';
import { MockModelProvider } from '@atlas/providers';
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
              { id: 'step_2', agent: 'layla', objective: 'Score and qualify candidate gyms', depends_on: ['step_1'], parallelizable: false },
              { id: 'step_3', agent: 'hermes', objective: 'Draft WhatsApp outreach copies for top 10', depends_on: ['step_2'], parallelizable: false }
            ],
            approval_points: ['communication.send_approved'],
            estimated_cost_usd: 0.80
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
        { content: 'Chief Executive Summary: Successfully identified 30 gyms in Palembang. 10 qualified leads prepared with customized WhatsApp outreach drafts. Pending human approval.' }
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
});
