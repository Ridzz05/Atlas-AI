import { describe, expect, it, vi } from 'vitest';
import { BudgetRepository } from '../src/index.js';

const runId = '123e4567-e89b-12d3-a456-426614174000';
const taskId = '123e4567-e89b-12d3-a456-426614174001';

function createTransactionalDb(query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>) {
  const client = { query: vi.fn(query) };
  return {
    db: { transaction: vi.fn(async (callback: (value: typeof client) => Promise<unknown>) => callback(client)) } as any,
    client
  };
}

describe('BudgetRepository', () => {
  it('reserves global and per-run budget atomically', async () => {
    let budgetSelects = 0;
    const { db, client } = createTransactionalDb(async (sql) => {
      if (sql.includes('FROM budgets') && sql.includes('FOR UPDATE')) {
        budgetSelects++;
        return {
          rows: [budgetSelects === 1 ? {
            scope: 'global_daily',
            target_id: null,
            period: 'daily',
            limit_usd: '5.0000',
            used_usd: '1.0000',
            reserved_usd: '0.0000'
          } : {
            scope: 'task',
            target_id: runId,
            period: 'per_run',
            limit_usd: '1.0000',
            used_usd: '0.1000',
            reserved_usd: '0.0000'
          }]
        };
      }
      if (sql.includes('INSERT INTO budget_reservations')) {
        return { rows: [{
          id: '123e4567-e89b-12d3-a456-426614174003',
          run_id: runId,
          task_id: taskId,
          agent_id: 'chief',
          amount_usd: '0.2500',
          global_reset_at: '2026-08-27T00:00:00.000Z',
          status: 'reserved',
          committed_cost_usd: null,
          created_at: '2026-08-26T10:00:00.000Z',
          updated_at: '2026-08-26T10:00:00.000Z'
        }] };
      }
      return { rows: [] };
    });
    const repository = new BudgetRepository(db);

    const reservation = await repository.reserve({
      runId,
      taskId,
      agentId: 'chief',
      amountUsd: 0.25,
      globalDailyLimitUsd: 5,
      perRunLimitUsd: 1,
      now: new Date('2026-08-26T10:00:00.000Z')
    });

    expect(reservation).toMatchObject({
      runId,
      taskId,
      agentId: 'chief',
      amountUsd: 0.25,
      status: 'reserved'
    });
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO budget_reservations'),
      expect.arrayContaining([runId, taskId, 'chief', 0.25])
    );
  });

  it('rejects a reservation when either durable budget scope is exhausted', async () => {
    let budgetSelects = 0;
    const { db, client } = createTransactionalDb(async (sql) => {
      if (sql.includes('FROM budgets') && sql.includes('FOR UPDATE')) {
        budgetSelects++;
        return {
          rows: [budgetSelects === 1 ? {
            limit_usd: '5.0000',
            used_usd: '4.9000',
            reserved_usd: '0.0000'
          } : {
            limit_usd: '1.0000',
            used_usd: '0.9000',
            reserved_usd: '0.0000'
          }]
        };
      }
      return { rows: [] };
    });
    const repository = new BudgetRepository(db);

    const reservation = await repository.reserve({
      runId,
      taskId,
      agentId: 'chief',
      amountUsd: 0.2,
      globalDailyLimitUsd: 5,
      perRunLimitUsd: 1
    });

    expect(reservation).toBeNull();
    expect(client.query).not.toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO budget_reservations'),
      expect.anything()
    );
  });

  it('commits actual cost and releases the reserved amount idempotently', async () => {
    const reservationId = '123e4567-e89b-12d3-a456-426614174002';
    const { db, client } = createTransactionalDb(async (sql) => {
      if (sql.includes('FROM budget_reservations')) {
        return {
          rows: [{
            id: reservationId,
            run_id: runId,
            task_id: taskId,
            agent_id: 'chief',
            amount_usd: '0.2500',
            global_reset_at: '2026-08-27T00:00:00.000Z',
            status: 'reserved',
            committed_cost_usd: null,
            created_at: '2026-08-26T10:00:00.000Z',
            updated_at: '2026-08-26T10:00:00.000Z'
          }]
        };
      }
      if (sql.includes('UPDATE budget_reservations')) {
        return { rows: [{
          id: reservationId,
          run_id: runId,
          task_id: taskId,
          agent_id: 'chief',
          amount_usd: '0.2500',
          global_reset_at: '2026-08-27T00:00:00.000Z',
          status: 'committed',
          committed_cost_usd: '0.1200',
          created_at: '2026-08-26T10:00:00.000Z',
          updated_at: '2026-08-26T10:00:01.000Z'
        }] };
      }
      return { rows: [] };
    });
    const repository = new BudgetRepository(db);

    const committed = await repository.commit(reservationId, 0.12);

    expect(committed).toMatchObject({ id: reservationId, status: 'committed', committedCostUsd: 0.12 });
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('used_usd = used_usd + $2'),
      expect.arrayContaining([-0.25, 0.12])
    );
  });
});
