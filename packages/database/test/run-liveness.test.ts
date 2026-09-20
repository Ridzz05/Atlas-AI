import { describe, expect, it, vi } from 'vitest';
import { BudgetRepository, RunRepository, runIsAliveSql } from '../src/index.js';

/**
 * One question — "is this run still alive?" — answered three times, three different ways.
 *
 *   recoverStaleRuns          status IN (created, active, waiting_tool, waiting_child)   -> waiting_approval is ALIVE
 *   recoverStaleRuns' task    NOT EXISTS (... status IN (..., waiting_approval))          -> waiting_approval is ALIVE
 *   recoverStaleReservations  ... AND (lease_expires_at IS NULL OR > NOW())               -> waiting_approval is DEAD once its lease lapses
 *
 * So a worker that died while a run was waiting for approval left the run and its task permanently
 * stuck — the run sweep never failed it and the task sweep saw a live run — while the budget sweep
 * released its reservation underneath it, so the resumed run spent outside the cap it was admitted
 * under. The same "immortal row" class the sweep's own comment claims to have closed.
 *
 * A run parked on a human is alive while that human can still decide. `approvals.expires_at` is when
 * that stops being true, so it is what the predicate has to read.
 */
describe('run liveness is one rule', () => {
  function transactionalDb(rows: unknown[] = []) {
    const client = { query: vi.fn().mockResolvedValue({ rows, rowCount: rows.length }), release: vi.fn() };
    const db = {
      query: vi.fn().mockResolvedValue({ rows, rowCount: rows.length }),
      transaction: vi.fn(async (fn: (c: unknown) => unknown) => fn(client))
    };
    return { db: db as any, client, raw: db };
  }

  const aliveSql = runIsAliveSql('runs');

  it('reads the approval, not just the lease, for a run parked on a human', () => {
    expect(aliveSql).toMatch(/waiting_approval/);
    expect(aliveSql).toMatch(/approvals/);
    expect(aliveSql).toMatch(/expires_at\s*>\s*NOW\(\)/);
  });

  it('treats a run with an expired approval as dead, so the sweep can fail it', async () => {
    const { db, raw } = transactionalDb();

    await new RunRepository(db).recoverStaleRuns();

    const runSweep = raw.query.mock.calls.map(call => String(call[0])).find(sql => /UPDATE runs/.test(sql));
    expect(runSweep).toBeDefined();
    // It used to exclude waiting_approval from the status list entirely, which made the row immortal.
    expect(runSweep).toContain('waiting_approval');
    expect(runSweep).toContain('approvals');
  });

  it('uses the same predicate to decide whether an orphaned task is really orphaned', async () => {
    const { db, raw } = transactionalDb();

    await new RunRepository(db).recoverStaleRuns();

    const taskSweep = raw.query.mock.calls.map(call => String(call[0])).find(sql => /UPDATE tasks/.test(sql));
    expect(taskSweep).toBeDefined();
    expect(taskSweep).toContain('approvals');
    expect(taskSweep).toContain('waiting_approval');
  });

  it('keeps the reservation of a run whose approval can still be decided', async () => {
    const { db, client } = transactionalDb();

    await new BudgetRepository(db).recoverStaleReservations();

    const sweepSql = client.query.mock.calls.map(call => String(call[0])).find(sql => sql.includes('FROM budget_reservations'));
    expect(sweepSql).toBeDefined();
    expect(sweepSql).toContain('approvals');
    expect(sweepSql).toContain('expires_at');
  });

  it('builds the predicate for whatever alias the caller uses', () => {
    // The three call sites alias the table differently, and a predicate that only works for one alias
    // would silently be a different rule again.
    const aliased = runIsAliveSql('r');
    expect(aliased).toMatch(/\br\.status\b/);
    expect(aliased).toMatch(/\ba\.run_id = r\.id\b/);
  });
});
