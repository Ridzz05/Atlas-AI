import { describe, it, expect, vi } from 'vitest';
import { buildServer } from '../src/server.js';
import { runningControlState } from './support/control-state.js';
import { EnvConfigSchema } from '@atlas/shared';
import { InMemoryTaskQueue } from '@atlas/orchestration';
import { SDLCInitiative, SDLCPhase } from '@atlas/shared';

/**
 * The SDLC routes must enqueue a task, not execute a phase inline. These tests pin that:
 * one task per phase, assigned to the phase's owning agent, and no duplicate when the same
 * phase is started twice.
 */
function buildSdlcDoubles() {
  const initiatives = new Map<string, SDLCInitiative>();
  const created: Array<{ id: string; assignedAgent: string }> = [];

  const sdlcRepo: any = {
    create: vi.fn(async (params: any) => {
      const initiative: SDLCInitiative = {
        id: crypto.randomUUID(),
        title: params.title,
        intent: params.intent,
        status: 'active',
        currentPhase: 'inception',
        phaseAttempt: 0,
        artifacts: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      initiatives.set(initiative.id, initiative);
      return initiative;
    }),
    findById: vi.fn(async (id: string) => initiatives.get(id) || null),
    findByPhaseTaskId: vi.fn(async (taskId: string) => {
      for (const initiative of initiatives.values()) {
        if (initiative.phaseTaskId === taskId) return initiative;
      }
      return null;
    }),
    attachPhaseTask: vi.fn(async (id: string, phase: SDLCPhase, taskId: string) => {
      const current = initiatives.get(id);
      if (!current || current.currentPhase !== phase) return null;
      if (current.phaseTaskId && current.phaseTaskId !== taskId) return null;
      const updated = { ...current, phaseTaskId: taskId, phaseAttempt: current.phaseAttempt + 1 };
      initiatives.set(id, updated);
      return updated;
    }),
    advancePhase: vi.fn(async (id: string, nextPhase: SDLCPhase, updates: any = {}) => {
      const current = initiatives.get(id)!;
      const updated = { ...current, currentPhase: nextPhase, status: updates.status || current.status, phaseTaskId: undefined };
      initiatives.set(id, updated);
      return updated;
    }),
    list: vi.fn(async () => Array.from(initiatives.values()))
  };

  const taskRepo: any = {
    create: vi.fn(async (input: any, id?: string) => {
      const taskId = id || crypto.randomUUID();
      const task = {
        id: taskId,
        parentId: input.parentId ?? null,
        title: input.title,
        goal: input.goal,
        assignedAgent: input.assignedAgent,
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
      created.push({ id: taskId, assignedAgent: task.assignedAgent });
      return task;
    }),
    findById: vi.fn(async () => null),
    list: vi.fn(async () => [])
  };

  return { sdlcRepo, taskRepo, created };
}

describe('agent-service SDLC initiative API', () => {
  const config = EnvConfigSchema.parse({ NODE_ENV: 'test' });

  it('creates an initiative and enqueues its first phase as a CEO task', async () => {
    const { sdlcRepo, taskRepo, created } = buildSdlcDoubles();
    const taskQueue = new InMemoryTaskQueue();
    const server = buildServer({
      config,
      sdlcRepo,
      taskRepo,
      taskQueue,
      controlStateRepo: runningControlState() as any,
      processQueue: false
    });

    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/sdlc/initiatives',
      payload: { title: 'Market Intelligence', intent: 'Qualify 30 B2B leads' }
    });

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body);
    expect(body.data.currentPhase).toBe('inception');
    expect(body.data.phaseTaskId).toBeTruthy();

    expect(created).toHaveLength(1);
    expect(created[0].assignedAgent).toBe('ceo');
    expect(created[0].id).toBe(body.data.phaseTaskId);
    expect(await taskQueue.hasPending({ taskId: body.data.phaseTaskId })).toBe(true);
  });

  it('does not enqueue a second task when the same phase is advanced twice', async () => {
    const { sdlcRepo, taskRepo, created } = buildSdlcDoubles();
    const taskQueue = new InMemoryTaskQueue();
    const server = buildServer({
      config,
      sdlcRepo,
      taskRepo,
      taskQueue,
      controlStateRepo: runningControlState() as any,
      processQueue: false
    });

    const createResponse = await server.inject({
      method: 'POST',
      url: '/api/v1/sdlc/initiatives',
      payload: { title: 'T', intent: 'I' }
    });
    const initiativeId = JSON.parse(createResponse.body).data.id;

    const advanceResponse = await server.inject({
      method: 'POST',
      url: `/api/v1/sdlc/initiatives/${initiativeId}/advance`
    });

    expect(advanceResponse.statusCode).toBe(200);
    expect(created).toHaveLength(1);
  });

  it('creates an initiative without enqueueing anything when autoAdvance is false', async () => {
    const { sdlcRepo, taskRepo, created } = buildSdlcDoubles();
    const taskQueue = new InMemoryTaskQueue();
    const server = buildServer({
      config,
      sdlcRepo,
      taskRepo,
      taskQueue,
      controlStateRepo: runningControlState() as any,
      processQueue: false
    });

    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/sdlc/initiatives?autoAdvance=false',
      payload: { title: 'T', intent: 'I' }
    });

    expect(response.statusCode).toBe(201);
    expect(created).toHaveLength(0);
    expect(JSON.parse(response.body).data.phaseTaskId).toBeUndefined();
  });

  it('rejects an advance on a terminal initiative', async () => {
    const { sdlcRepo, taskRepo } = buildSdlcDoubles();
    const taskQueue = new InMemoryTaskQueue();
    const server = buildServer({
      config,
      sdlcRepo,
      taskRepo,
      taskQueue,
      controlStateRepo: runningControlState() as any,
      processQueue: false
    });

    const createResponse = await server.inject({
      method: 'POST',
      url: '/api/v1/sdlc/initiatives?autoAdvance=false',
      payload: { title: 'T', intent: 'I' }
    });
    const initiativeId = JSON.parse(createResponse.body).data.id;
    await sdlcRepo.advancePhase(initiativeId, 'completed', { status: 'completed' });

    const response = await server.inject({
      method: 'POST',
      url: `/api/v1/sdlc/initiatives/${initiativeId}/advance`
    });

    expect(response.statusCode).toBe(400);
  });
});
