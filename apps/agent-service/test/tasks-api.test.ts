import { describe, it, expect, vi } from 'vitest';
import { buildServer } from '../src/server.js';
import { EnvConfigSchema } from '@atlas/shared';
import { MockModelProvider } from '@atlas/providers';
import { InMemoryTaskQueue } from '@atlas/orchestration';
import { defaultAgentRegistry } from '@atlas/agents';

describe('agent-service Task and Multi-Agent APIs', () => {
  const config = EnvConfigSchema.parse({ NODE_ENV: 'test' });
  const mockTasks = new Map<string, any>();

  const fakeTaskRepo: any = {
    create: vi.fn(async (input, id) => {
      const task = {
        id: id || '123e4567-e89b-12d3-a456-426614174000',
        parentId: input.parentId || null,
        title: input.title,
        goal: input.goal,
        assignedAgent: input.assignedAgent || 'chief',
        depth: 0,
        status: 'queued',
        priority: input.priority || 'normal',
        context: input.context || {},
        plan: null,
        result: null,
        error: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        completedAt: null
      };
      mockTasks.set(task.id, task);
      return task;
    }),
    findById: vi.fn(async (id) => mockTasks.get(id) || null),
    list: vi.fn(async () => Array.from(mockTasks.values())),
    updateStatus: vi.fn(async (id, status, opts) => {
      const task = mockTasks.get(id);
      if (task) {
        task.status = status;
        if (opts?.result) task.result = opts.result;
        if (opts?.error) task.error = opts.error;
      }
      return task;
    }),
    updatePlan: vi.fn(async (id, plan) => {
      const task = mockTasks.get(id);
      if (task) {
        task.plan = plan;
        task.status = 'running';
      }
      return task;
    })
  };

  const provider = new MockModelProvider({
    cannedResponses: [
      {
        content: JSON.stringify({
          goal: 'Analyze CRM market',
          assumptions: [],
          questions: [],
          steps: [
            { id: 'step_1', agent: 'ned', objective: 'Collect market data', depends_on: [] }
          ],
          approval_points: [],
          estimated_cost_usd: 0.50
        })
      },
      { content: 'Ned data collected.' },
      { content: JSON.stringify({ verdict: 'PASS', findings: [], recommendations: [] }) },
      { content: 'Chief synthesis completed.' }
    ]
  });

  const taskQueue = new InMemoryTaskQueue();

  const server = buildServer({
    config,
    taskRepo: fakeTaskRepo,
    provider,
    taskQueue,
    registry: defaultAgentRegistry
  });

  it('GET /api/v1/agents returns list of all registered agents', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/agents'
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.data.length).toBe(5);
    const ids = body.data.map((a: any) => a.id);
    expect(ids).toContain('chief');
    expect(ids).toContain('ned');
    expect(ids).toContain('layla');
    expect(ids).toContain('hermes');
    expect(ids).toContain('argus');
  });

  it('POST /api/v1/tasks triggers multi-agent delegation', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/tasks',
      payload: {
        title: 'Analyze CRM Market',
        goal: 'Analyze CRM market and synthesize results',
        assignedAgent: 'chief'
      }
    });

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body);
    expect(body.assignedAgent).toBe('chief');

    // Wait briefly for queue execution
    await new Promise(r => setTimeout(r, 60));
    expect(fakeTaskRepo.create).toHaveBeenCalled();
  });
});
