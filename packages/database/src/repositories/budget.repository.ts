import { DatabaseClient } from '../client.js';
import { runIsAliveSql } from './run-liveness.js';

export type BudgetReservationStatus = 'reserved' | 'committed' | 'released';

export interface BudgetReservation {
  id: string;
  runId: string;
  taskId: string;
  agentId: string;
  amountUsd: number;
  status: BudgetReservationStatus;
  committedCostUsd: number | null;
  globalResetAt: string | Date;
  createdAt: string | Date;
  updatedAt: string | Date;
}

export interface BudgetReservationInput {
  runId: string;
  taskId: string;
  agentId: string;
  amountUsd: number;
  globalDailyLimitUsd: number;
  perRunLimitUsd: number;
  now?: Date;
}

export interface GlobalDailyBudgetSummary {
  limitUsd: number;
  usedUsd: number;
  reservedUsd: number;
  availableUsd: number;
  resetAt: string | null;
}

interface BudgetScope {
  scope: 'global_daily' | 'task';
  targetId: string | null;
  period: 'daily' | 'per_run';
  resetAt: Date | null;
  limitUsd: number;
}

interface BudgetState extends BudgetScope {
  usedUsd: number;
  reservedUsd: number;
}

export class BudgetRepository {
  constructor(private db: DatabaseClient) {}

  public async reserve(input: BudgetReservationInput): Promise<BudgetReservation | null> {
    this.assertPositiveFinite(input.amountUsd, 'amountUsd');
    this.assertPositiveFinite(input.globalDailyLimitUsd, 'globalDailyLimitUsd');
    this.assertPositiveFinite(input.perRunLimitUsd, 'perRunLimitUsd');

    const now = input.now || new Date();
    const globalResetAt = this.nextUtcDay(now);
    const scopes: BudgetScope[] = [
      {
        scope: 'global_daily',
        targetId: null,
        period: 'daily',
        resetAt: globalResetAt,
        limitUsd: input.globalDailyLimitUsd
      },
      {
        scope: 'task',
        targetId: input.runId,
        period: 'per_run',
        resetAt: null,
        limitUsd: input.perRunLimitUsd
      }
    ];

    return this.db.transaction(async client => {
      const states: BudgetState[] = [];
      for (const scope of scopes) {
        await this.lockScope(client, scope);
        states.push(await this.getOrCreateBudget(client, scope));
      }

      // A run may hold at most one live reservation. This used to insert unconditionally, so the
      // approval-resume path — which reaches reserve() a second time for the same runId — left two live
      // rows for one run. Only the newest id is ever settled, so the stale one held its amount in
      // reserved_usd for up to 15 minutes and reserve() returned null for unrelated runs, which the
      // runner reports as BUDGET_EXCEEDED while nothing had been spent.
      const existing = await client.query(
        `
        SELECT * FROM budget_reservations
        WHERE run_id = $1 AND status = 'reserved'
        ORDER BY created_at DESC
        LIMIT 1
        FOR UPDATE`,
        [input.runId]
      );
      const existingRow = existing.rows[0];

      // Only the part of the cap that is not already reserved is new demand on the scopes.
      const alreadyReservedUsd = existingRow ? Number(existingRow.amount_usd || 0) : 0;
      const additionalUsd = Math.max(0, input.amountUsd - alreadyReservedUsd);

      const exceedsLimit = states.some(state => state.usedUsd + state.reservedUsd + additionalUsd > state.limitUsd + Number.EPSILON);
      if (exceedsLimit) return null;

      if (existingRow) {
        if (additionalUsd > 0) {
          for (const state of states) {
            await this.adjustReservation(client, state, additionalUsd, 0);
          }
          const toppedUp = await client.query(
            `UPDATE budget_reservations SET amount_usd = amount_usd + $2, updated_at = NOW() WHERE id = $1 RETURNING *`,
            [existingRow.id, additionalUsd]
          );
          return this.mapReservation(toppedUp.rows[0]);
        }

        return this.mapReservation(existingRow);
      }

      const reservationId = crypto.randomUUID();
      for (const state of states) {
        await this.adjustReservation(client, state, input.amountUsd, 0);
      }

      const result = await client.query(
        `
        INSERT INTO budget_reservations (
          id, run_id, task_id, agent_id, amount_usd, global_reset_at, status
        ) VALUES ($1, $2, $3, $4, $5, $6, 'reserved')
        RETURNING *`,
        [reservationId, input.runId, input.taskId, input.agentId, input.amountUsd, globalResetAt.toISOString()]
      );

      return this.mapReservation(result.rows[0]);
    });
  }

  public async commit(reservationId: string, actualCostUsd: number): Promise<BudgetReservation | null> {
    this.assertNonnegativeFinite(actualCostUsd, 'actualCostUsd');
    return this.settle(reservationId, 'committed', actualCostUsd);
  }

  public async release(reservationId: string): Promise<BudgetReservation | null> {
    return this.settle(reservationId, 'released', 0);
  }

  public async getGlobalDailySummary(now = new Date()): Promise<GlobalDailyBudgetSummary | null> {
    const resetAt = this.nextUtcDay(now).toISOString();
    const result = await this.db.query(
      `
      SELECT limit_usd, used_usd, reserved_usd, reset_at
      FROM budgets
      WHERE scope = 'global_daily'
        AND target_id IS NULL
        AND period = 'daily'
        AND reset_at = $1`,
      [resetAt]
    );
    const row = result.rows[0];
    if (!row) return null;

    const limitUsd = Number(row.limit_usd || 0);
    const usedUsd = Number(row.used_usd || 0);
    const reservedUsd = Number(row.reserved_usd || 0);
    return {
      limitUsd,
      usedUsd,
      reservedUsd,
      availableUsd: Math.max(0, limitUsd - usedUsd - reservedUsd),
      resetAt: row.reset_at ? new Date(row.reset_at).toISOString() : null
    };
  }

  public async recoverStaleReservations(olderThanSeconds = 900, now = new Date()): Promise<number> {
    this.assertPositiveFinite(olderThanSeconds, 'olderThanSeconds');
    const cutoff = new Date(now.getTime() - olderThanSeconds * 1000);

    return this.db.transaction(async client => {
      const result = await client.query(
        `
        SELECT *
        FROM budget_reservations
        WHERE status = 'reserved'
          AND created_at < $1
          AND NOT EXISTS (
            SELECT 1 FROM runs r
            WHERE r.id = budget_reservations.run_id
              AND ${runIsAliveSql('r')}
          )
        FOR UPDATE SKIP LOCKED`,
        [cutoff.toISOString()]
      );

      for (const row of result.rows) {
        const scopeStates = this.reservationScopes(row);
        for (const scope of scopeStates) {
          await this.lockScope(client, scope);
          await this.adjustReservation(client, scope, -Number(row.amount_usd || 0), 0);
        }
        await client.query(
          `
          UPDATE budget_reservations
          SET status = 'released', committed_cost_usd = 0, updated_at = NOW()
          WHERE id = $1`,
          [row.id]
        );
      }

      return result.rows.length;
    });
  }

  private async settle(
    reservationId: string,
    status: Exclude<BudgetReservationStatus, 'reserved'>,
    actualCostUsd: number
  ): Promise<BudgetReservation | null> {
    return this.db.transaction(async client => {
      const result = await client.query('SELECT * FROM budget_reservations WHERE id = $1 FOR UPDATE', [reservationId]);
      const row = result.rows[0];
      if (!row) return null;

      // A reservation already settled with a cost is returned untouched: settle is idempotent.
      if (row.status === 'committed' || row.status === 'failed') return this.mapReservation(row);

      // A reservation the stale sweep already released has had its reserved amount returned to the
      // pool, so only the actual cost is applied here — but it MUST be applied. Returning early
      // made every run that outlived the 900s sweep free: its spend never reached used_usd, so
      // neither the per-run ceiling nor the global daily cap could ever see it.
      const reservedToReturn = row.status === 'reserved' ? -Number(row.amount_usd || 0) : 0;

      const scopes = this.reservationScopes(row);
      for (const scope of scopes) {
        await this.lockScope(client, scope);
        await this.adjustReservation(client, scope, reservedToReturn, actualCostUsd);
      }

      const updated = await client.query(
        `
        UPDATE budget_reservations
        SET status = $1, committed_cost_usd = $2, updated_at = NOW()
        WHERE id = $3
        RETURNING *`,
        [status, actualCostUsd, reservationId]
      );
      return this.mapReservation(updated.rows[0]);
    });
  }

  private async getOrCreateBudget(client: any, scope: BudgetScope): Promise<BudgetState> {
    const resetAt = scope.resetAt?.toISOString() || null;
    const result = await client.query(
      `
      SELECT scope, target_id, period, reset_at, limit_usd, used_usd, reserved_usd
      FROM budgets
      WHERE scope = $1
        AND target_id IS NOT DISTINCT FROM $2
        AND period = $3
        AND reset_at IS NOT DISTINCT FROM $4
      FOR UPDATE`,
      [scope.scope, scope.targetId, scope.period, resetAt]
    );
    const row = result.rows[0];
    if (!row) {
      await client.query(
        `
        INSERT INTO budgets (scope, target_id, period, limit_usd, used_usd, reserved_usd, reset_at)
        VALUES ($1, $2, $3, $4, 0, 0, $5)`,
        [scope.scope, scope.targetId, scope.period, scope.limitUsd, resetAt]
      );
      return { ...scope, usedUsd: 0, reservedUsd: 0 };
    }

    if (Number(row.limit_usd) !== scope.limitUsd) {
      await client.query(
        'UPDATE budgets SET limit_usd = $1, updated_at = NOW() WHERE scope = $2 AND target_id IS NOT DISTINCT FROM $3 AND period = $4 AND reset_at IS NOT DISTINCT FROM $5',
        [scope.limitUsd, scope.scope, scope.targetId, scope.period, resetAt]
      );
    }

    return {
      ...scope,
      usedUsd: Number(row.used_usd || 0),
      reservedUsd: Number(row.reserved_usd || 0)
    };
  }

  private async adjustReservation(client: any, scope: BudgetScope, reservedDelta: number, usedDelta: number): Promise<void> {
    const resetAt = scope.resetAt?.toISOString() || null;
    await client.query(
      `
      UPDATE budgets
      SET reserved_usd = GREATEST(0, reserved_usd + $1),
          used_usd = used_usd + $2,
          updated_at = NOW()
      WHERE scope = $3
        AND target_id IS NOT DISTINCT FROM $4
        AND period = $5
        AND reset_at IS NOT DISTINCT FROM $6`,
      [reservedDelta, usedDelta, scope.scope, scope.targetId, scope.period, resetAt]
    );
  }

  private reservationScopes(row: any): BudgetScope[] {
    return [
      {
        scope: 'global_daily',
        targetId: null,
        period: 'daily',
        resetAt: new Date(row.global_reset_at),
        limitUsd: 0
      },
      {
        scope: 'task',
        targetId: row.run_id,
        period: 'per_run',
        resetAt: null,
        limitUsd: 0
      }
    ];
  }

  private async lockScope(client: any, scope: BudgetScope): Promise<void> {
    const resetAt = scope.resetAt?.toISOString() || '';
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${scope.scope}:${scope.targetId || ''}:${scope.period}:${resetAt}`]);
  }

  private mapReservation(row: any): BudgetReservation {
    if (!row) throw new Error('Budget repository returned an empty reservation row.');
    return {
      id: row.id,
      runId: row.run_id,
      taskId: row.task_id,
      agentId: row.agent_id,
      amountUsd: Number(row.amount_usd || 0),
      status: row.status,
      committedCostUsd: row.committed_cost_usd == null ? null : Number(row.committed_cost_usd),
      globalResetAt: row.global_reset_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  private nextUtcDay(now: Date): Date {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  }

  private assertPositiveFinite(value: number, name: string): void {
    if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be a positive finite number.`);
  }

  private assertNonnegativeFinite(value: number, name: string): void {
    if (!Number.isFinite(value) || value < 0) throw new RangeError(`${name} must be a non-negative finite number.`);
  }
}
