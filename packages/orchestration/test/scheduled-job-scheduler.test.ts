import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScheduledJobScheduler, ScheduledJobTriggerContext } from '../src/scheduler/scheduled-job-scheduler.js';
import { AgentDefinition } from '@atlas/shared';

function makeJob(
  overrides: Partial<{
    id: string;
    name: string;
    jobType: 'daily_briefing';
    cronPattern: string;
    timezone: string;
    payload: Record<string, unknown>;
    assignedAgent: string;
    enabled: boolean;
    lastRunAt: string | null;
    nextRunAt: string | null;
    lastError: string | null;
    createdBy: string;
    createdAt: string;
    updatedAt: string;
  }> = {}
) {
  const now = new Date('2026-08-31T00:00:00Z').toISOString();
  return {
    id: 'sj_morning',
    name: 'Daily Briefing',
    jobType: 'daily_briefing' as const,
    cronPattern: '0 7 * * *',
    timezone: 'Asia/Jakarta',
    payload: { locale: 'id-ID' },
    assignedAgent: 'chief',
    enabled: true,
    lastRunAt: null,
    nextRunAt: null,
    lastError: null,
    createdBy: 'owner',
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

const agent: AgentDefinition = {
  id: 'chief',
  name: 'Chief',
  role: 'orchestrator',
  version: 1,
  description: 'orchestrator',
  systemPrompt: 'You are Chief',
  limits: { maxTurns: 4, maxDelegationDepth: 2, timeoutSeconds: 60, maxCostUsd: 1 },
  permissions: { tools: [], dataScopes: [], externalWrites: false },
  modelPolicy: { preferredTier: 'balanced', fallbackTier: 'fast', temperature: 0.2 },
  review: { humanApprovalFor: [] }
};

interface FakeRepos {
  scheduledJobRepo: {
    list: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
    recordRun: ReturnType<typeof vi.fn>;
  };
  taskRepo: {
    create: ReturnType<typeof vi.fn>;
  };
  registry: {
    get: ReturnType<typeof vi.fn>;
  };
}

function makeRepos(jobs: ReturnType<typeof makeJob>[]): FakeRepos {
  return {
    scheduledJobRepo: {
      list: vi.fn(async () => jobs),
      findById: vi.fn(async (id: string) => jobs.find(j => j.id === id) || null),
      recordRun: vi.fn(async () => undefined)
    },
    taskRepo: {
      create: vi.fn(async (input: any) => ({
        id: `task-${Math.random().toString(36).slice(2, 8)}`,
        parentId: null,
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
      }))
    },
    registry: {
      get: vi.fn((id: string) => (id === 'chief' ? agent : null))
    }
  };
}

describe('ScheduledJobScheduler', () => {
  let scheduler: ScheduledJobScheduler;
  let repos: FakeRepos;
  let handler: ReturnType<typeof vi.fn>;
  let nextRunCalculator: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    nextRunCalculator = vi.fn(() => new Date('2026-09-01T00:00:00Z'));
  });

  afterEach(() => {
    scheduler?.stop();
  });

  it('registers enabled jobs on first sync and unregisters removed ones', async () => {
    const job = makeJob();
    repos = makeRepos([job]);
    handler = vi.fn(async () => undefined);
    scheduler = new ScheduledJobScheduler({
      scheduledJobRepo: repos.scheduledJobRepo as any,
      taskRepo: repos.taskRepo as any,
      registry: repos.registry as any,
      triggerHandler: handler,
      nextRunCalculator
    });

    await scheduler.syncOnce();
    expect(scheduler.getTrackedJobIds()).toEqual(['sj_morning']);

    // second sync drops the job (disabled externally)
    repos.scheduledJobRepo.list.mockResolvedValueOnce([]);
    await scheduler.syncOnce();
    expect(scheduler.getTrackedJobIds()).toEqual([]);
  });

  it('runJobNow creates a task, invokes handler, and records next run', async () => {
    const job = makeJob();
    repos = makeRepos([job]);
    handler = vi.fn(async () => undefined);
    scheduler = new ScheduledJobScheduler({
      scheduledJobRepo: repos.scheduledJobRepo as any,
      taskRepo: repos.taskRepo as any,
      registry: repos.registry as any,
      triggerHandler: handler,
      nextRunCalculator
    });

    const result = await scheduler.runJobNow('sj_morning');

    expect(result).toEqual({ executed: true });
    expect(repos.taskRepo.create).toHaveBeenCalledTimes(1);
    const createArg = repos.taskRepo.create.mock.calls[0][0];
    expect(createArg.assignedAgent).toBe('chief');
    expect(createArg.context).toMatchObject({
      source: 'scheduled_job',
      scheduledJobId: 'sj_morning',
      scheduledJobType: 'daily_briefing'
    });
    expect(createArg.goal).toContain('daily briefing');
    expect(handler).toHaveBeenCalledTimes(1);
    const handlerArg = handler.mock.calls[0][0] as ScheduledJobTriggerContext;
    expect(handlerArg.job.id).toBe('sj_morning');
    expect(repos.scheduledJobRepo.recordRun).toHaveBeenCalledWith('sj_morning', new Date('2026-09-01T00:00:00Z'), undefined);
  });

  it('records error and skips handler when assigned agent is missing', async () => {
    const job = makeJob({ assignedAgent: 'unknown-agent' });
    repos = makeRepos([job]);
    handler = vi.fn(async () => undefined);
    scheduler = new ScheduledJobScheduler({
      scheduledJobRepo: repos.scheduledJobRepo as any,
      taskRepo: repos.taskRepo as any,
      registry: repos.registry as any,
      triggerHandler: handler,
      nextRunCalculator
    });

    const result = await scheduler.runJobNow('sj_morning');

    expect(result).toEqual({ executed: true });
    expect(repos.taskRepo.create).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
    expect(repos.scheduledJobRepo.recordRun).toHaveBeenCalledWith('sj_morning', null, 'Assigned agent not found: unknown-agent');
  });

  it('refuses to execute disabled jobs through runJobNow', async () => {
    const job = makeJob({ enabled: false });
    repos = makeRepos([job]);
    handler = vi.fn(async () => undefined);
    scheduler = new ScheduledJobScheduler({
      scheduledJobRepo: repos.scheduledJobRepo as any,
      taskRepo: repos.taskRepo as any,
      registry: repos.registry as any,
      triggerHandler: handler,
      nextRunCalculator
    });

    const result = await scheduler.runJobNow('sj_morning');
    expect(result).toEqual({ executed: false, reason: 'disabled' });
    expect(repos.taskRepo.create).not.toHaveBeenCalled();
  });

  it('uses start and stop lifecycle to schedule sync', async () => {
    const job = makeJob();
    repos = makeRepos([job]);
    handler = vi.fn(async () => undefined);
    scheduler = new ScheduledJobScheduler({
      scheduledJobRepo: repos.scheduledJobRepo as any,
      taskRepo: repos.taskRepo as any,
      registry: repos.registry as any,
      triggerHandler: handler,
      nextRunCalculator,
      syncIntervalSeconds: 0.05
    });

    await scheduler.start();
    expect(scheduler.getTrackedJobIds()).toEqual(['sj_morning']);

    // after stop, no further syncs fire
    scheduler.stop();
    const seenBefore = repos.scheduledJobRepo.list.mock.calls.length;
    await new Promise(resolve => setTimeout(resolve, 80));
    // list should not have been called after stop
    expect(repos.scheduledJobRepo.list.mock.calls.length).toBe(seenBefore);
  });
});
