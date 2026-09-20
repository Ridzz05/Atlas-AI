import { describe, expect, it, vi } from 'vitest';
import { ScheduledJobRepository } from '../src/index.js';

interface QueryCall {
  sql: string;
  params: unknown[];
}

function makeDb(responses: Array<{ rows: any[]; rowCount?: number }>) {
  const calls: QueryCall[] = [];
  const db = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      const next = responses.shift();
      if (!next) {
        return { rows: [], rowCount: 0 };
      }
      return next;
    })
  } as any;
  return { db, calls };
}

describe('ScheduledJobRepository', () => {
  it('persists a new scheduled job with provided id and parsed payload', async () => {
    const { db, calls } = makeDb([
      {
        rows: [
          {
            id: 'sj_morning_briefing',
            name: 'Daily Briefing',
            job_type: 'daily_briefing',
            cron_pattern: '0 7 * * *',
            timezone: 'Asia/Jakarta',
            payload: { locale: 'id-ID' },
            assigned_agent: 'chief',
            enabled: true,
            last_run_at: null,
            next_run_at: null,
            last_error: null,
            created_by: 'owner',
            created_at: new Date('2026-08-31T00:00:00Z'),
            updated_at: new Date('2026-08-31T00:00:00Z')
          }
        ]
      }
    ]);
    const repo = new ScheduledJobRepository(db);

    const job = await repo.create({
      id: 'sj_morning_briefing',
      name: 'Daily Briefing',
      jobType: 'daily_briefing',
      cronPattern: '0 7 * * *',
      timezone: 'Asia/Jakarta',
      payload: { locale: 'id-ID' },
      assignedAgent: 'chief',
      enabled: true,
      createdBy: 'owner'
    });

    expect(job.id).toBe('sj_morning_briefing');
    expect(job.payload).toEqual({ locale: 'id-ID' });
    expect(calls[0].sql).toContain('INSERT INTO scheduled_jobs');
    expect(calls[0].params[5]).toBe('{"locale":"id-ID"}');
  });

  it('rejects unknown job types', async () => {
    const { db } = makeDb([]);
    const repo = new ScheduledJobRepository(db);
    await expect(
      repo.create({
        name: 'bad',
        jobType: 'unsupported_job' as any,
        cronPattern: '0 7 * * *',
        createdBy: 'owner'
      })
    ).rejects.toThrow();
  });

  it('lists enabled jobs of a specific type', async () => {
    const { db, calls } = makeDb([
      {
        rows: [
          {
            id: 'sj_1',
            name: 'Briefing',
            job_type: 'daily_briefing',
            cron_pattern: '0 7 * * *',
            timezone: 'UTC',
            payload: {},
            assigned_agent: 'chief',
            enabled: true,
            last_run_at: null,
            next_run_at: null,
            last_error: null,
            created_by: 'owner',
            created_at: new Date(),
            updated_at: new Date()
          }
        ]
      }
    ]);
    const repo = new ScheduledJobRepository(db);
    const jobs = await repo.list({ enabled: true, jobType: 'daily_briefing' });
    expect(jobs).toHaveLength(1);
    expect(calls[0].sql).toContain('enabled = $1');
    expect(calls[0].sql).toContain('job_type = $2');
  });

  it('updates only the provided fields', async () => {
    const { db, calls } = makeDb([
      {
        rows: [
          {
            id: 'sj_1',
            name: 'Briefing (renamed)',
            job_type: 'daily_briefing',
            cron_pattern: '30 7 * * *',
            timezone: 'Asia/Jakarta',
            payload: { locale: 'id-ID' },
            assigned_agent: 'chief',
            enabled: false,
            last_run_at: null,
            next_run_at: null,
            last_error: null,
            created_by: 'owner',
            created_at: new Date(),
            updated_at: new Date()
          }
        ]
      }
    ]);
    const repo = new ScheduledJobRepository(db);
    const updated = await repo.update('sj_1', {
      name: 'Briefing (renamed)',
      cronPattern: '30 7 * * *',
      enabled: false
    });

    expect(updated.name).toBe('Briefing (renamed)');
    expect(updated.enabled).toBe(false);
    const setClause = calls[0].sql.match(/SET (.*) WHERE/)?.[1] || '';
    expect(setClause).toContain('name = $1');
    expect(setClause).toContain('cron_pattern = $2');
    expect(setClause).toContain('enabled = $3');
    expect(setClause).not.toContain('payload');
  });

  it('records run metadata with nextRunAt and error', async () => {
    const { db, calls } = makeDb([{ rows: [] }]);
    const repo = new ScheduledJobRepository(db);
    const next = new Date('2026-09-01T00:00:00Z');
    await repo.recordRun('sj_1', next, 'queue unavailable');
    expect(calls[0].sql).toContain('last_run_at = NOW()');
    expect(calls[0].params[0]).toBe('sj_1');
    expect(calls[0].params[1]).toBe(next);
    expect(calls[0].params[2]).toBe('queue unavailable');
  });

  // Registering a job is not running it. Initializing the first schedule must not stamp
  // `last_run_at`, or a job that has never fired reports a last run of "just now".
  it('initializes a first schedule without recording a run', async () => {
    const { db, calls } = makeDb([
      {
        rows: [
          {
            id: 'sj_1',
            name: 'Daily briefing',
            job_type: 'daily_briefing',
            cron_pattern: '0 7 * * *',
            timezone: 'UTC',
            payload: {},
            assigned_agent: 'chief',
            enabled: true,
            last_run_at: null,
            next_run_at: '2026-09-01T00:00:00.000Z',
            last_error: null,
            created_by: 'system',
            created_at: '2026-08-31T00:00:00.000Z',
            updated_at: '2026-08-31T00:00:00.000Z'
          }
        ]
      }
    ]);
    const repo = new ScheduledJobRepository(db);
    const next = new Date('2026-09-01T00:00:00Z');

    const initialized = await repo.initializeSchedule('sj_1', next);

    expect(calls[0].sql).toContain('next_run_at = $2');
    expect(calls[0].sql).not.toContain('last_run_at');
    // CAS, so a second replica's concurrent sync is a no-op instead of a second write.
    expect(calls[0].sql).toContain('next_run_at IS NULL');
    expect(calls[0].params).toEqual(['sj_1', next]);
    expect(initialized?.id).toBe('sj_1');
    expect(initialized?.lastRunAt).toBeNull();
  });

  it('reports no initialization when the schedule was already set', async () => {
    const { db } = makeDb([{ rows: [] }]);
    const repo = new ScheduledJobRepository(db);

    const initialized = await repo.initializeSchedule('sj_1', new Date('2026-09-01T00:00:00Z'));

    expect(initialized).toBeNull();
  });
});
