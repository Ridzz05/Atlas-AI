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
    claimRun: ReturnType<typeof vi.fn>;
    recordError: ReturnType<typeof vi.fn>;
    initializeSchedule: ReturnType<typeof vi.fn>;
  };
  taskRepo: {
    create: ReturnType<typeof vi.fn>;
  };
  registry: {
    get: ReturnType<typeof vi.fn>;
  };
  taskQueue?: { enqueue: ReturnType<typeof vi.fn> };
}

function makeRepos(jobs: ReturnType<typeof makeJob>[]): FakeRepos {
  // The claim is a compare-and-set against the value the caller read, so the fake models the
  // stored row: a claim that does not match the current next_run_at loses, exactly as the SQL
  // `AND next_run_at IS NOT DISTINCT FROM $2` would.
  const storedNextRun = new Map<string, string | null>(jobs.map(j => [j.id, j.nextRunAt]));

  return {
    scheduledJobRepo: {
      list: vi.fn(async () => jobs),
      findById: vi.fn(async (id: string) => jobs.find(j => j.id === id) || null),
      recordRun: vi.fn(async () => undefined),
      claimRun: vi.fn(async (id: string, expectedNextRunAt: Date | null, nextRunAt: Date) => {
        const current = storedNextRun.get(id) ?? null;
        const expected = expectedNextRunAt ? expectedNextRunAt.toISOString() : null;
        const matches =
          current === expected || (current !== null && expected !== null && new Date(current).getTime() === new Date(expected).getTime());
        if (!matches) return null;
        storedNextRun.set(id, nextRunAt.toISOString());
        return { ...(jobs.find(j => j.id === id) as object), nextRunAt: nextRunAt.toISOString() };
      }),
      recordError: vi.fn(async () => undefined),
      initializeSchedule: vi.fn(async (id: string, nextRunAt: Date) => {
        if (storedNextRun.get(id) != null) return null;
        storedNextRun.set(id, nextRunAt.toISOString());
        return { ...(jobs.find(j => j.id === id) as object), nextRunAt: nextRunAt.toISOString() };
      })
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

  // Registering a job is not running it. syncOnce() initialized next_run_at by calling recordRun,
  // which also stamps `last_run_at = NOW()` — so a job that had never fired reported a last run of
  // "just now", and the dashboard field an operator reads to answer "is this automation actually
  // firing?" said yes for a job that had never executed.
  it('initializes a never-scheduled job without recording a run', async () => {
    const job = makeJob({ nextRunAt: null, lastRunAt: null });
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

    expect(repos.scheduledJobRepo.recordRun).not.toHaveBeenCalled();
    expect(repos.scheduledJobRepo.initializeSchedule).toHaveBeenCalledWith('sj_morning', new Date('2026-09-01T00:00:00Z'));
    // The job was registered, not executed.
    expect(repos.taskRepo.create).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it('leaves a job that has already run alone when syncing', async () => {
    const job = makeJob({
      nextRunAt: new Date('2026-09-02T00:00:00Z').toISOString(),
      lastRunAt: new Date('2026-09-01T00:00:00Z').toISOString()
    });
    repos = makeRepos([job]);
    scheduler = new ScheduledJobScheduler({
      scheduledJobRepo: repos.scheduledJobRepo as any,
      taskRepo: repos.taskRepo as any,
      registry: repos.registry as any,
      triggerHandler: vi.fn(async () => undefined),
      nextRunCalculator
    });

    await scheduler.syncOnce();

    expect(repos.scheduledJobRepo.initializeSchedule).not.toHaveBeenCalled();
    expect(repos.scheduledJobRepo.recordRun).not.toHaveBeenCalled();
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
    // The job has never run, so the claim's expected value is null (a NULL-safe compare).
    expect(repos.scheduledJobRepo.claimRun).toHaveBeenCalledWith('sj_morning', null, new Date('2026-09-01T00:00:00Z'));
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
    // The claim carries the schedule forward; the failure only annotates the row.
    const [, , nextRunAt] = repos.scheduledJobRepo.claimRun.mock.calls.at(-1) as [string, Date | null, Date];
    expect(nextRunAt).toBeInstanceOf(Date);
    expect(repos.scheduledJobRepo.recordError).toHaveBeenCalledWith('sj_morning', 'Assigned agent not found: unknown-agent');
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

  // A null nextRunAt meant "due now". Every dispatch-failure path persisted nextRunAt = null
  // (agent missing, enqueue failure, unexpected error), and so did the success path whenever
  // cron-parser could not read the stored pattern. Because the row was then permanently due, one
  // bad pattern or one transient failure created a fresh duplicate task on every 60s tick,
  // forever. A job that has never run is still due; a job that has already run and whose next run
  // is unknown is not.
  it('treats an unknown next run as due only for a job that has never run', () => {
    repos = makeRepos([]);
    scheduler = new ScheduledJobScheduler({
      scheduledJobRepo: repos.scheduledJobRepo as any,
      taskRepo: repos.taskRepo as any,
      registry: repos.registry as any,
      triggerHandler: vi.fn(async () => undefined),
      nextRunCalculator
    });

    expect(scheduler.isDue(makeJob({ nextRunAt: null, lastRunAt: null }) as any)).toBe(true);
    expect(scheduler.isDue(makeJob({ nextRunAt: null, lastRunAt: '2026-08-31T00:00:00Z' }) as any)).toBe(false);
    // A future schedule is not due; a past one is.
    expect(scheduler.isDue(makeJob({ nextRunAt: '2026-09-02T00:00:00Z' }) as any, new Date('2026-09-01T00:00:00Z'))).toBe(false);
    expect(scheduler.isDue(makeJob({ nextRunAt: '2026-08-30T00:00:00Z' }) as any, new Date('2026-09-01T00:00:00Z'))).toBe(true);
  });

  it('keeps a retry horizon instead of nulling the schedule when a dispatch cannot be queued', async () => {
    const job = makeJob({ nextRunAt: '2026-09-01T00:00:00Z' });
    repos = makeRepos([job]);
    repos.taskQueue = {
      enqueue: vi.fn(async () => {
        throw new Error('redis down');
      })
    };
    handler = vi.fn(async () => undefined);
    scheduler = new ScheduledJobScheduler({
      scheduledJobRepo: repos.scheduledJobRepo as any,
      taskRepo: repos.taskRepo as any,
      registry: repos.registry as any,
      triggerHandler: handler,
      taskQueue: repos.taskQueue as any,
      nextRunCalculator
    });

    await scheduler.runJobNow('sj_morning');

    expect(handler).not.toHaveBeenCalled();
    // The claim carries a real Date forward, never null.
    const [, , nextRunAt] = repos.scheduledJobRepo.claimRun.mock.calls.at(-1) as [string, Date | null, Date];
    expect(nextRunAt).toBeInstanceOf(Date);
    // The failure annotates the row without re-pointing the schedule.
    const [errorId, errorText] = repos.scheduledJobRepo.recordError.mock.calls.at(-1) as [string, string];
    expect(errorId).toBe('sj_morning');
    expect(errorText).toContain('enqueue failed');
  });

  it('dispatches a due job exactly once when two schedulers tick the same job', async () => {
    // Two worker replicas read the same next_run_at and both decided the job was due. Without a
    // claim each created its own task, so one cron tick ran twice with two distinct task ids.
    const job = makeJob({ nextRunAt: '2026-08-31T00:00:00Z' });
    repos = makeRepos([job]);
    const handlerA = vi.fn(async () => undefined);
    const handlerB = vi.fn(async () => undefined);

    const makeScheduler = (triggerHandler: typeof handlerA) =>
      new ScheduledJobScheduler({
        scheduledJobRepo: repos.scheduledJobRepo as any,
        taskRepo: repos.taskRepo as any,
        registry: repos.registry as any,
        triggerHandler,
        nextRunCalculator
      });

    const a = makeScheduler(handlerA);
    const b = makeScheduler(handlerB);

    await Promise.all([a.runJobNow('sj_morning'), b.runJobNow('sj_morning')]);

    expect(handlerA.mock.calls.length + handlerB.mock.calls.length).toBe(1);
    expect(repos.taskRepo.create).toHaveBeenCalledTimes(1);
  });
});
