import { describe, it, expect, vi } from 'vitest';
import { buildServer } from '../src/server.js';
import { runningControlState } from './support/control-state.js';
import { EnvConfigSchema } from '@atlas/shared';
import { MockModelProvider } from '@atlas/providers';
import { InMemoryTaskQueue } from '@atlas/orchestration';
import { InMemoryEventBus } from '@atlas/events';
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
    findById: vi.fn(async id => mockTasks.get(id) || null),
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
          steps: [{ id: 'step_1', agent: 'ned', objective: 'Collect market data', depends_on: [] }],
          approval_points: [],
          estimated_cost_usd: 0.5
        })
      },
      { content: 'Ned data collected.' },
      { content: JSON.stringify({ verdict: 'PASS', findings: [], recommendations: [] }) },
      { content: 'Chief synthesis completed.' }
    ]
  });

  const taskQueue = new InMemoryTaskQueue();
  const eventBus = new InMemoryEventBus();
  const publishedEvents: Array<{ type: string; taskId?: string; payload: Record<string, unknown> }> = [];
  const messageRepo = { create: vi.fn().mockResolvedValue(undefined) } as any;
  eventBus.subscribe('*', event => {
    publishedEvents.push({ type: event.type, taskId: event.taskId, payload: event.payload });
  });
  const approvalRepo: any = {
    list: vi.fn(async () => []),
    decide: vi.fn(async (id, status, decidedBy, decisionNote) => ({
      id,
      taskId: '123e4567-e89b-12d3-a456-426614174001',
      runId: '123e4567-e89b-12d3-a456-426614174002',
      agentId: 'hermes',
      action: 'communication.send_approved',
      target: '+628123456789',
      payload: { content: 'Hello' },
      payloadHash: 'hash',
      reason: 'Test approval',
      riskLevel: 'high',
      status,
      requestedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      decidedAt: new Date().toISOString(),
      decidedBy,
      decisionNote: decisionNote || null
    }))
  };

  const server = buildServer({
    config,
    controlStateRepo: runningControlState() as any,
    taskRepo: fakeTaskRepo,
    provider,
    taskQueue,
    eventBus,
    messageRepo,
    registry: defaultAgentRegistry,
    approvalRepo
  });

  it('GET /api/v1/agents returns list of all registered agents', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/agents'
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.data.length).toBe(9);
    const ids = body.data.map((a: any) => a.id);
    expect(ids).toContain('chief');
    expect(ids).toContain('ned');
    expect(ids).toContain('luna');
    expect(ids).toContain('layla');
    expect(ids).toContain('hermes');
    expect(ids).toContain('argus');
    expect(ids).toContain('ceo');
    expect(ids).toContain('cto');
    expect(ids).toContain('cfo');
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
    expect(messageRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: body.id,
        senderType: 'user',
        senderId: 'api-owner',
        content: 'Analyze CRM market and synthesize results'
      })
    );
    expect(publishedEvents).toContainEqual(
      expect.objectContaining({
        type: 'task.created',
        taskId: body.id,
        payload: expect.objectContaining({ status: 'queued', assignedAgent: 'chief' })
      })
    );

    // Wait briefly for queue execution
    await new Promise(r => setTimeout(r, 60));
    expect(fakeTaskRepo.create).toHaveBeenCalled();
  });

  it('creates the task and API intake message in one transaction when durable DB is configured', async () => {
    const task = {
      id: '123e4567-e89b-12d3-a456-426614174050',
      parentId: null,
      title: 'Atomic intake',
      goal: 'Keep task and conversation history consistent',
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
    const transactionClient = { query: vi.fn() };
    const db = {
      transaction: vi.fn(async (callback: (client: unknown) => Promise<unknown>) => callback(transactionClient))
    };
    const taskRepo = { create: vi.fn().mockResolvedValue(task) } as any;
    const messageRepo = { create: vi.fn().mockResolvedValue(undefined) } as any;
    const taskQueue = { enqueue: vi.fn().mockResolvedValue(task.id), process: vi.fn(), close: vi.fn() } as any;
    const atomicServer = buildServer({
      config,
      controlStateRepo: runningControlState() as any,
      db: db as any,
      taskRepo,
      messageRepo,
      taskQueue,
      eventBus: new InMemoryEventBus(),
      registry: defaultAgentRegistry,
      processQueue: false
    });

    const response = await atomicServer.inject({
      method: 'POST',
      url: '/api/v1/tasks',
      payload: {
        title: task.title,
        goal: task.goal,
        assignedAgent: 'chief'
      }
    });

    expect(response.statusCode).toBe(201);
    expect(db.transaction).toHaveBeenCalledOnce();
    expect(taskRepo.create).toHaveBeenCalledWith(expect.anything(), undefined, transactionClient);
    expect(messageRepo.create).toHaveBeenCalledWith(expect.objectContaining({ taskId: task.id }), undefined, transactionClient);
    expect(taskQueue.enqueue).toHaveBeenCalledOnce();
  });

  it('does not enqueue or return success when atomic API intake history fails', async () => {
    const task = {
      id: '123e4567-e89b-12d3-a456-426614174051',
      parentId: null,
      title: 'Atomic failure',
      goal: 'Do not dispatch without history',
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
    const db = {
      transaction: vi.fn(async (callback: (client: unknown) => Promise<unknown>) => callback({ query: vi.fn() }))
    };
    const taskQueue = { enqueue: vi.fn(), process: vi.fn(), close: vi.fn() } as any;
    const atomicServer = buildServer({
      config,
      controlStateRepo: runningControlState() as any,
      db: db as any,
      taskRepo: { create: vi.fn().mockResolvedValue(task) } as any,
      messageRepo: { create: vi.fn().mockRejectedValue(new Error('history unavailable')) } as any,
      taskQueue,
      eventBus: new InMemoryEventBus(),
      registry: defaultAgentRegistry,
      processQueue: false
    });

    const response = await atomicServer.inject({
      method: 'POST',
      url: '/api/v1/tasks',
      payload: {
        title: task.title,
        goal: task.goal,
        assignedAgent: 'chief'
      }
    });

    expect(response.statusCode).toBe(500);
    expect(taskQueue.enqueue).not.toHaveBeenCalled();
  });

  it('rejects an unknown assigned agent before creating a durable task', async () => {
    const invalidTaskRepo: any = { create: vi.fn() };
    const invalidServer = buildServer({
      config,
      controlStateRepo: runningControlState() as any,
      taskRepo: invalidTaskRepo,
      taskQueue: new InMemoryTaskQueue(),
      eventBus: new InMemoryEventBus(),
      registry: defaultAgentRegistry,
      processQueue: false
    });

    const response = await invalidServer.inject({
      method: 'POST',
      url: '/api/v1/tasks',
      payload: {
        title: 'Invalid agent task',
        goal: 'This must not be persisted',
        assignedAgent: 'not-registered'
      }
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toContain('Unknown assigned agent');
    expect(invalidTaskRepo.create).not.toHaveBeenCalled();
  });

  it('rejects task intake while durable control state is paused', async () => {
    const frozenTaskRepo: any = { create: vi.fn() };
    const controlStateRepo: any = {
      getControlState: vi.fn().mockResolvedValue({
        paused: true,
        emergencyStop: false,
        updatedBy: 'telegram-owner',
        updatedAt: new Date()
      })
    };
    const frozenServer = buildServer({
      config,
      controlStateRepo: runningControlState() as any,
      taskRepo: frozenTaskRepo,
      taskQueue: new InMemoryTaskQueue(),
      registry: defaultAgentRegistry,
      controlStateRepo,
      processQueue: false
    });

    const response = await frozenServer.inject({
      method: 'POST',
      url: '/api/v1/tasks',
      payload: {
        title: 'Must remain queued',
        goal: 'Do not dispatch while paused',
        assignedAgent: 'chief'
      }
    });

    expect(response.statusCode).toBe(423);
    expect(JSON.parse(response.body).state).toBe('paused');
    expect(frozenTaskRepo.create).not.toHaveBeenCalled();
  });

  it('lists pending approvals and records a durable decision', async () => {
    const approvals = await server.inject({
      method: 'GET',
      url: '/api/v1/approvals?status=pending'
    });
    expect(approvals.statusCode).toBe(200);
    expect(JSON.parse(approvals.body).data).toEqual([]);

    const decision = await server.inject({
      method: 'POST',
      url: '/api/v1/approvals/123e4567-e89b-12d3-a456-426614174000/decision',
      payload: { status: 'approved', decisionNote: 'Looks good' }
    });
    expect(decision.statusCode).toBe(200);
    expect(JSON.parse(decision.body).approval.status).toBe('approved');
    expect(approvalRepo.decide).toHaveBeenCalledWith('123e4567-e89b-12d3-a456-426614174000', 'approved', 'api-owner', 'Looks good');
  });

  it('rejects invalid task list filters and pagination before querying the repository', async () => {
    const invalidStatus = await server.inject({
      method: 'GET',
      url: '/api/v1/tasks?status=not-a-task-status'
    });
    const invalidLimit = await server.inject({
      method: 'GET',
      url: '/api/v1/tasks?limit=not-a-number'
    });
    const invalidOffset = await server.inject({
      method: 'GET',
      url: '/api/v1/tasks?offset=-1'
    });

    expect(invalidStatus.statusCode).toBe(400);
    expect(invalidLimit.statusCode).toBe(400);
    expect(invalidOffset.statusCode).toBe(400);
  });

  it('rejects invalid task and approval resource IDs before repository access', async () => {
    const invalidTask = await server.inject({
      method: 'GET',
      url: '/api/v1/tasks/not-a-uuid'
    });
    const invalidApproval = await server.inject({
      method: 'POST',
      url: '/api/v1/approvals/not-a-uuid/decision',
      payload: { status: 'rejected' }
    });

    expect(invalidTask.statusCode).toBe(400);
    expect(invalidApproval.statusCode).toBe(400);
    expect(approvalRepo.decide).not.toHaveBeenCalledWith('not-a-uuid', expect.anything(), expect.anything(), expect.anything());
  });

  it('issues a one-time token and requeues a paused child through its parent task', async () => {
    const parentId = '123e4567-e89b-12d3-a456-426614174010';
    const childId = '123e4567-e89b-12d3-a456-426614174011';
    const runId = '123e4567-e89b-12d3-a456-426614174012';
    const approvalId = '123e4567-e89b-12d3-a456-426614174013';
    const parent = {
      id: parentId,
      parentId: null,
      title: 'Parent task',
      goal: 'Resume the protected action',
      assignedAgent: 'chief',
      depth: 0,
      status: 'approval_pending',
      priority: 'normal',
      context: {},
      plan: null,
      result: null,
      error: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: null
    };
    const child = {
      ...parent,
      id: childId,
      parentId,
      title: 'Protected child',
      assignedAgent: 'hermes',
      depth: 1,
      status: 'approval_pending'
    };
    const resumeTaskRepo: any = {
      findById: vi.fn(async (id: string) => (id === parentId ? parent : id === childId ? child : null))
    };
    const resumeQueue: any = {
      enqueue: vi.fn(async () => 'resume-job'),
      process: vi.fn(),
      close: vi.fn()
    };
    const token = {
      requestId: approvalId,
      action: 'communication.send_approved',
      payloadHash: 'payload-hash',
      signature: 'signed-once',
      expiresAt: Math.floor(Date.now() / 1000) + 300
    };
    const resumeApprovalRepo: any = {
      decide: vi.fn(async () => ({
        id: approvalId,
        taskId: childId,
        runId,
        agentId: 'hermes',
        action: token.action,
        target: '+628123456789',
        payload: { recipient: '+628123456789', channel: 'whatsapp', content: 'Approved' },
        payloadHash: token.payloadHash,
        reason: 'Approved action',
        riskLevel: 'high',
        status: 'approved',
        requestedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        decidedAt: new Date().toISOString(),
        decidedBy: 'api-owner',
        decisionNote: null
      })),
      issueExecutionToken: vi.fn(async () => token)
    };
    const resumeServer = buildServer({
      config,
      controlStateRepo: runningControlState() as any,
      taskRepo: resumeTaskRepo,
      taskQueue: resumeQueue,
      approvalRepo: resumeApprovalRepo,
      registry: defaultAgentRegistry,
      processQueue: false
    });

    const response = await resumeServer.inject({
      method: 'POST',
      url: `/api/v1/approvals/${approvalId}/decision`,
      payload: { status: 'approved' }
    });

    expect(response.statusCode).toBe(200);
    expect(resumeApprovalRepo.issueExecutionToken).toHaveBeenCalledWith(approvalId);
    expect(resumeQueue.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        task: parent,
        runId: undefined,
        approvalResume: { taskId: childId, runId, token }
      })
    );
  });
});
