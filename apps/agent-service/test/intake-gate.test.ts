import { describe, expect, it, vi } from 'vitest';
import { EnvConfigSchema } from '@atlas/shared';
import { defaultAgentRegistry } from '@atlas/agents';
import { InMemoryTaskQueue } from '@atlas/orchestration';
import { buildServer } from '../src/server.js';

/**
 * Every route that creates a task and enqueues it must honour the operator's intake gate.
 *
 * `POST /api/v1/tasks` read the control state and answered 423 while paused, but the automation
 * trigger, the manual scheduled-job run, and both SDLC initiative routes did not. The invariant an
 * operator buys with emergency stop — "nothing new enters the system" — held on one of five paths.
 *
 * This is an inventory test on purpose: it walks the intake routes as a list, so a new route that
 * forgets the gate fails here rather than silently adding a sixth hole.
 */
describe('intake gate coverage', () => {
  const config = EnvConfigSchema.parse({ NODE_ENV: 'test' });

  function buildPausedServer() {
    const controlStateRepo = {
      getControlState: vi.fn().mockResolvedValue({ paused: true, emergencyStop: false }),
      setPaused: vi.fn(),
      setEmergencyStop: vi.fn(),
      resume: vi.fn()
    };
    const taskRepo = { create: vi.fn(), list: vi.fn().mockResolvedValue([]), findById: vi.fn() };
    const taskQueue = new InMemoryTaskQueue();
    const enqueue = vi.spyOn(taskQueue, 'enqueue');

    const server = buildServer({
      config,
      taskRepo: taskRepo as any,
      taskQueue,
      registry: defaultAgentRegistry,
      controlStateRepo: controlStateRepo as any,
      scheduledJobRepo: {
        list: vi.fn().mockResolvedValue([]),
        findById: vi.fn().mockResolvedValue({
          id: 'sj_1',
          name: 'Daily',
          jobType: 'daily_briefing',
          cronPattern: '0 7 * * *',
          timezone: 'UTC',
          payload: {},
          assignedAgent: 'chief',
          enabled: true
        })
      } as any,
      sdlcRepo: {
        createInitiative: vi.fn(),
        findById: vi.fn().mockResolvedValue({ id: 'i1', currentPhase: 'inception' }),
        list: vi.fn().mockResolvedValue([])
      } as any,
      processQueue: false
    });

    return { server, taskRepo, enqueue };
  }

  const intakeRoutes: Array<{ method: 'POST'; url: string; payload?: unknown }> = [
    { method: 'POST', url: '/api/v1/tasks', payload: { title: 'T', goal: 'G', assignedAgent: 'chief' } },
    { method: 'POST', url: '/api/v1/automations/trigger', payload: { type: 'manual', jobType: 'daily_briefing' } },
    // Creating a scheduled job is intake too: the worker's scheduler fires it on the next tick without
    // consulting the control state, so during a stop it would accumulate work nobody asked for.
    {
      method: 'POST',
      url: '/api/v1/automations/scheduled-jobs',
      payload: { name: 'Nightly', jobType: 'daily_briefing', cronPattern: '0 7 * * *', assignedAgent: 'chief' }
    },
    { method: 'POST', url: '/api/v1/automations/scheduled-jobs/sj_1/run' },
    { method: 'POST', url: '/api/v1/sdlc/initiatives', payload: { title: 'T', intent: 'I' } },
    { method: 'POST', url: '/api/v1/sdlc/initiatives/i1/advance' }
  ];

  for (const route of intakeRoutes) {
    it(`blocks ${route.method} ${route.url} while the system is paused`, async () => {
      const { server, taskRepo, enqueue } = buildPausedServer();

      const response = await server.inject({ method: route.method, url: route.url, payload: route.payload as any });

      expect(response.statusCode, `${route.url} must answer 423 while paused`).toBe(423);
      expect(JSON.parse(response.body).state).toBe('paused');
      // Nothing may be persisted or queued behind the operator's stop.
      expect(taskRepo.create).not.toHaveBeenCalled();
      expect(enqueue).not.toHaveBeenCalled();
    });
  }

  it('lets the same routes through when the system is running', async () => {
    const controlStateRepo = {
      getControlState: vi.fn().mockResolvedValue({ paused: false, emergencyStop: false }),
      setPaused: vi.fn(),
      setEmergencyStop: vi.fn(),
      resume: vi.fn()
    };
    const server = buildServer({
      config,
      taskRepo: { create: vi.fn(), list: vi.fn().mockResolvedValue([]), findById: vi.fn() } as any,
      taskQueue: new InMemoryTaskQueue(),
      registry: defaultAgentRegistry,
      controlStateRepo: controlStateRepo as any,
      processQueue: false
    });

    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/tasks',
      payload: { title: 'T', goal: 'G', assignedAgent: 'chief' }
    });

    expect(response.statusCode).not.toBe(423);
  });

  // The gate used to `return` when no control-state source was configured, so the emergency stop was
  // a no-op for any caller that did not wire one. A safety control that cannot be read must not be
  // treated as "not pressed".
  it('refuses intake when no control state source is configured', async () => {
    const enqueue = vi.fn();
    const server = buildServer({
      config,
      taskRepo: { create: vi.fn(), list: vi.fn().mockResolvedValue([]), findById: vi.fn() } as any,
      taskQueue: { enqueue, hasPending: vi.fn(async () => false) } as any,
      registry: defaultAgentRegistry,
      processQueue: false
      // no controlStateRepo
    });

    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/tasks',
      payload: { title: 'T', goal: 'G', assignedAgent: 'chief' }
    });

    expect(response.statusCode).toBe(503);
    expect(enqueue).not.toHaveBeenCalled();
  });
});
