import { describe, expect, it, vi } from 'vitest';
import { BudgetRepository } from '../src/index.js';

const runId = '123e4567-e89b-12d3-a456-426614174002';

function reservationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '123e4567-e89b-12d3-a456-426614174003',
    run_id: runId,
    task_id: '123e4567-e89b-12d3-a456-426614174000',
    agent_id: 'chief',
    amount_usd: 1,
    status: 'reserved',
    committed_cost_usd: null,
    global_reset_at: '2026-09-22T00:00:00.000Z',
    created_at: '2026-09-21T00:00:00.000Z',
    updated_at: '2026-09-21T00:00:00.000Z',
    ...overrides
  };
}

function budgetRow() {
  return {
    scope: 'global_daily',
    target_id: null,
    period: 'daily',
    limit_usd: 5,
    used_usd: 0,
    reserved_usd: 0,
    reset_at: '2026-09-22T00:00:00.000Z'
  };
}

/**
 * A run may hold at most one live reservation.
 *
 * `reserve()` unconditionally inserted a new `budget_reservations` row and added its amount to the
 * scope's `reserved_usd`, with no check for a live reservation on that run. The approval-resume path in
 * `agent-runner.ts` reaches `reserve()` a second time for the same `runId`, so an approval decided
 * within 900s of the original reservation — the normal case — left two live rows for one run. Only the
 * newest id is ever settled, so the stale one kept its amount reserved for up to 15 minutes, and
 * `reserved_usd` was inflated by a full per-run cap: `reserve()` then returned null for unrelated new
 * runs, which the runner reports as `BUDGET_EXCEEDED` while nothing had been spent.
 */
describe('BudgetRepository.reserve is idempotent per run', () => {
  function dbWithExisting(existing: unknown[] | null) {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (/FROM budget_reservations/.test(sql)) {
          return { rows: existing ?? [], rowCount: existing?.length ?? 0 };
        }
        if (/FROM budgets/.test(sql)) return { rows: [budgetRow()], rowCount: 1 };
        if (/INSERT INTO budget_reservations/.test(sql)) return { rows: [reservationRow()], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn()
    };
    const db = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      transaction: vi.fn(async (fn: (c: unknown) => unknown) => fn(client))
    };
    return { db: db as any, client };
  }

  const input = {
    runId,
    taskId: '123e4567-e89b-12d3-a456-426614174000',
    agentId: 'chief',
    amountUsd: 1,
    globalDailyLimitUsd: 5,
    perRunLimitUsd: 1
  };

  it('looks for a live reservation on the run before inserting another', async () => {
    const { db, client } = dbWithExisting(null);

    await new BudgetRepository(db).reserve(input);

    const lookup = client.query.mock.calls.map(call => String(call[0])).find(sql => /FROM budget_reservations/.test(sql));
    expect(lookup, 'reserve must check for an existing live reservation on this run').toBeDefined();
    expect(lookup).toMatch(/run_id\s*=/);
    expect(lookup).toMatch(/status\s*=\s*'reserved'/);
  });

  it('returns the live reservation instead of inserting a second one', async () => {
    const { db, client } = dbWithExisting([reservationRow()]);

    const reservation = await new BudgetRepository(db).reserve(input);

    expect(reservation?.id).toBe('123e4567-e89b-12d3-a456-426614174003');
    const inserts = client.query.mock.calls.map(call => String(call[0])).filter(sql => /INSERT INTO budget_reservations/.test(sql));
    expect(inserts, 'no second reservation row for the same run').toEqual([]);
  });

  it('does not add the amount to reserved_usd twice', async () => {
    const { db, client } = dbWithExisting([reservationRow()]);

    await new BudgetRepository(db).reserve(input);

    // adjustReservation increments the counter with `GREATEST(0, reserved_usd + $1)`.
    const adjustments = client.query.mock.calls
      .map(call => String(call[0]))
      .filter(sql => /reserved_usd\s*=\s*GREATEST\(0,\s*reserved_usd\s*\+/.test(sql));
    expect(adjustments, 'the scope counter must not be incremented for an existing reservation').toEqual([]);
  });

  it('still inserts when no live reservation exists', async () => {
    const { db, client } = dbWithExisting(null);

    const reservation = await new BudgetRepository(db).reserve(input);

    expect(reservation).not.toBeNull();
    const inserts = client.query.mock.calls.map(call => String(call[0])).filter(sql => /INSERT INTO budget_reservations/.test(sql));
    expect(inserts).toHaveLength(1);
  });
});
