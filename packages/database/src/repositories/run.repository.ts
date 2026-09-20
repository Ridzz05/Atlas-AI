import { DatabaseClient } from '../client.js';
import { Run, RunStatus } from '@atlas/shared';
import { runIsAliveSql, runIsRecoverableSql } from './run-liveness.js';

export interface CreateRunInput {
  taskId: string;
  agentId: string;
}

export interface CostByAgent {
  agentId: string;
  periodCostUsd: number;
  costUsd: number;
  runCount: number;
}

export interface CostSummary {
  periodStart: string;
  periodEnd: string;
  periodCostUsd: number;
  totalCostUsd: number;
  runCount: number;
  activeRunCount: number;
  completedRunCount: number;
  failedRunCount: number;
  byAgent: CostByAgent[];
}

export interface LeaseSummary {
  checkedAt: string;
  activeLeaseCount: number;
  expiredLeaseCount: number;
  unleasedExecutableRunCount: number;
  cancellationRequestedCount: number;
}

export class RunRepository {
  constructor(private db: DatabaseClient) {}

  public async create(input: CreateRunInput, id?: string): Promise<Run> {
    const runId = id || crypto.randomUUID();
    const query = `
      INSERT INTO runs (
        id, task_id, agent_id, status, started_at
      ) VALUES ($1, $2, $3, 'active', NOW())
      RETURNING *;
    `;

    const res = await this.db.query(query, [runId, input.taskId, input.agentId]);
    return this.mapRow(res.rows[0]);
  }

  public async findById(id: string): Promise<Run | null> {
    const res = await this.db.query('SELECT * FROM runs WHERE id = $1', [id]);
    if (!res.rows[0]) return null;
    return this.mapRow(res.rows[0]);
  }

  public async findByTaskId(taskId: string): Promise<Run[]> {
    const res = await this.db.query('SELECT * FROM runs WHERE task_id = $1 ORDER BY created_at ASC', [taskId]);
    return res.rows.map(r => this.mapRow(r));
  }

  public async getCostSummary(now = new Date()): Promise<CostSummary> {
    const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const periodEnd = new Date(periodStart.getTime() + 24 * 60 * 60 * 1000);

    const [summaryResult, byAgentResult] = await Promise.all([
      this.db.query(
        `
        SELECT
          COALESCE(SUM(cost_usd) FILTER (WHERE created_at >= $1 AND created_at < $2), 0) AS period_cost_usd,
          COALESCE(SUM(cost_usd), 0) AS total_cost_usd,
          COUNT(*)::int AS run_count,
          COUNT(*) FILTER (WHERE status IN ('created', 'active', 'waiting_tool', 'waiting_child', 'waiting_approval'))::int AS active_run_count,
          COUNT(*) FILTER (WHERE status = 'completed')::int AS completed_run_count,
          COUNT(*) FILTER (WHERE status IN ('failed', 'cancelled', 'timed_out'))::int AS failed_run_count
        FROM runs`,
        [periodStart.toISOString(), periodEnd.toISOString()]
      ),
      this.db.query(
        `
        SELECT
          agent_id,
          COALESCE(SUM(cost_usd) FILTER (WHERE created_at >= $1 AND created_at < $2), 0) AS period_cost_usd,
          COALESCE(SUM(cost_usd), 0) AS cost_usd,
          COUNT(*)::int AS run_count
        FROM runs
        GROUP BY agent_id
        ORDER BY SUM(cost_usd) DESC, agent_id ASC`,
        [periodStart.toISOString(), periodEnd.toISOString()]
      )
    ]);

    const summary = summaryResult.rows[0] || {};
    return {
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      periodCostUsd: Number(summary.period_cost_usd || 0),
      totalCostUsd: Number(summary.total_cost_usd || 0),
      runCount: Number(summary.run_count || 0),
      activeRunCount: Number(summary.active_run_count || 0),
      completedRunCount: Number(summary.completed_run_count || 0),
      failedRunCount: Number(summary.failed_run_count || 0),
      byAgent: byAgentResult.rows.map(row => ({
        agentId: row.agent_id,
        periodCostUsd: Number(row.period_cost_usd || 0),
        costUsd: Number(row.cost_usd || 0),
        runCount: Number(row.run_count || 0)
      }))
    };
  }

  public async getLeaseSummary(now = new Date()): Promise<LeaseSummary> {
    const checkedAt = now.toISOString();
    const result = await this.db.query(
      `
      SELECT
        COUNT(*) FILTER (
          WHERE status IN ('created', 'active', 'waiting_tool', 'waiting_child')
            AND worker_id IS NOT NULL
            AND lease_expires_at IS NOT NULL
            AND lease_expires_at >= $1
        )::int AS active_lease_count,
        COUNT(*) FILTER (
          WHERE status IN ('created', 'active', 'waiting_tool', 'waiting_child')
            AND lease_expires_at IS NOT NULL
            AND lease_expires_at < $1
        )::int AS expired_lease_count,
        COUNT(*) FILTER (
          WHERE status IN ('created', 'active', 'waiting_tool', 'waiting_child')
            AND worker_id IS NULL
        )::int AS unleased_executable_run_count,
        COUNT(*) FILTER (
          WHERE status IN ('created', 'active', 'waiting_tool', 'waiting_child', 'waiting_approval')
            AND cancel_requested = TRUE
        )::int AS cancellation_requested_count
      FROM runs
    `,
      [checkedAt]
    );

    const summary = result.rows[0] || {};
    return {
      checkedAt,
      activeLeaseCount: Number(summary.active_lease_count || 0),
      expiredLeaseCount: Number(summary.expired_lease_count || 0),
      unleasedExecutableRunCount: Number(summary.unleased_executable_run_count || 0),
      cancellationRequestedCount: Number(summary.cancellation_requested_count || 0)
    };
  }

  public async acquireLease(runId: string, workerId: string, leaseSeconds = 60): Promise<Run | null> {
    this.assertLeaseInput(workerId, leaseSeconds);
    const result = await this.db.query(
      `
      UPDATE runs
      SET worker_id = $2,
          heartbeat_at = NOW(),
          lease_expires_at = NOW() + ($3 * INTERVAL '1 second'),
          updated_at = NOW()
      WHERE id = $1
        AND status IN ('created', 'active', 'waiting_tool', 'waiting_child')
        AND (worker_id IS NULL OR lease_expires_at < NOW() OR worker_id = $2)
      RETURNING *;
    `,
      [runId, workerId, leaseSeconds]
    );

    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }

  public async heartbeat(runId: string, workerId: string, leaseSeconds = 60): Promise<boolean> {
    this.assertLeaseInput(workerId, leaseSeconds);
    const result = await this.db.query(
      `
      UPDATE runs
      SET heartbeat_at = NOW(),
          lease_expires_at = NOW() + ($3 * INTERVAL '1 second'),
          updated_at = NOW()
      WHERE id = $1
        AND worker_id = $2
        AND status IN ('created', 'active', 'waiting_tool', 'waiting_child')
    `,
      [runId, workerId, leaseSeconds]
    );

    return (result.rowCount || 0) > 0;
  }

  public async releaseLease(runId: string, workerId?: string): Promise<boolean> {
    const result = await this.db.query(
      `
      UPDATE runs
      SET worker_id = NULL,
          heartbeat_at = NULL,
          lease_expires_at = NULL,
          updated_at = NOW()
      WHERE id = $1
        AND ($2::varchar IS NULL OR worker_id = $2)
    `,
      [runId, workerId || null]
    );

    return (result.rowCount || 0) > 0;
  }

  /**
   * Recover work abandoned by a worker that died.
   *
   * Two sweeps:
   *
   * 1. Runs. A run whose lease expired is failed. A run in an active status that never
   *    acquired a lease at all is ALSO failed once it goes stale — the previous predicate
   *    required `lease_expires_at IS NOT NULL`, which made such a run immortal, and because
   *    the task sweep below then saw it as an active run, its task was never recovered either
   *    and stayed `running` forever across restarts.
   * 2. Orphaned tasks. A task in `running`/`planning` with no active run is failed, but only
   *    once it has been stale for `staleAfterSeconds`, so a task is not killed in the window
   *    between "task -> running" and "run created".
   *
   * Returns the number of runs failed. The worker calls this on its recovery interval, not
   * only at boot.
   */
  public async recoverStaleRuns(reason = 'Worker lease expired', staleAfterSeconds = 900): Promise<number> {
    if (!reason.trim()) throw new RangeError('reason must not be empty.');
    if (!Number.isFinite(staleAfterSeconds) || staleAfterSeconds <= 0) {
      throw new RangeError('staleAfterSeconds must be a positive number.');
    }

    const result = await this.db.query(
      `
      UPDATE runs
      SET status = 'failed',
          error = COALESCE($1, error),
          ended_at = COALESCE(ended_at, NOW()),
          worker_id = NULL,
          heartbeat_at = NULL,
          lease_expires_at = NULL,
          updated_at = NOW()
      WHERE ${runIsRecoverableSql('runs')}
        AND NOT ${runIsAliveSql('runs')}
        AND (
          (lease_expires_at IS NOT NULL AND lease_expires_at < NOW())
          OR (lease_expires_at IS NULL AND updated_at < NOW() - ($2 * INTERVAL '1 second'))
        )
    `,
      [reason, staleAfterSeconds]
    );

    // Also update any orphaned tasks that are stuck in 'running' or 'planning'
    // with no active runs
    await this.db.query(
      `
      UPDATE tasks
      SET status = 'failed',
          error = COALESCE(error, 'Execution terminated: worker lease expired or abandoned'),
          updated_at = NOW(),
          completed_at = NOW()
      WHERE status IN ('running', 'planning')
        AND updated_at < NOW() - ($1 * INTERVAL '1 second')
        AND NOT EXISTS (
          SELECT 1 FROM runs
          WHERE runs.task_id = tasks.id
            AND ${runIsAliveSql('runs')}
        )
    `,
      [staleAfterSeconds]
    );

    return result.rowCount || 0;
  }

  public async recordTurn(runId: string, inputTokens: number, outputTokens: number, costUsd: number): Promise<Run> {
    const query = `
      UPDATE runs
      SET input_tokens = input_tokens + $1,
          output_tokens = output_tokens + $2,
          cost_usd = cost_usd + $3,
          turns_count = turns_count + 1,
          updated_at = NOW()
      WHERE id = $4
      RETURNING *;
    `;

    const res = await this.db.query(query, [inputTokens, outputTokens, costUsd, runId]);
    if (!res.rows[0]) {
      throw new Error(`Run not found: ${runId}`);
    }
    return this.mapRow(res.rows[0]);
  }

  /**
   * Writes a run's status.
   *
   * `workerId` is the lease guard: when it is supplied, a run that is currently owned by a
   * DIFFERENT worker is left untouched and `null` is returned. Without it, a worker that
   * merely failed to acquire the lease would still write a terminal status here, and because
   * a terminal write clears `worker_id` / `heartbeat_at` / `lease_expires_at`, it would
   * strip the lease from the worker that legitimately held the run. That worker's next
   * heartbeat then returned false and it aborted a healthy run.
   *
   * A run with no lease owner (`worker_id IS NULL`) is always writable, so unleased runs and
   * the approval-resume path keep working.
   */
  public async updateStatus(runId: string, status: RunStatus, error?: string, workerId?: string): Promise<Run | null> {
    const isTerminal = ['completed', 'failed', 'cancelled', 'timed_out'].includes(status);
    const query = `
      UPDATE runs
      SET status = CASE
            WHEN $1 = 'completed' AND cancel_requested THEN 'cancelled'
            ELSE $1
          END,
          error = CASE
            WHEN $1 = 'completed' AND cancel_requested
              THEN COALESCE(cancel_reason, $2, 'Execution cancelled')
            ELSE COALESCE($2, error)
          END,
          ended_at = CASE
            WHEN $3::boolean OR ($1 = 'completed' AND cancel_requested) THEN NOW()
            ELSE ended_at
          END,
          worker_id = CASE
            WHEN $3::boolean OR ($1 = 'completed' AND cancel_requested) THEN NULL
            ELSE worker_id
          END,
          heartbeat_at = CASE
            WHEN $3::boolean OR ($1 = 'completed' AND cancel_requested) THEN NULL
            ELSE heartbeat_at
          END,
          lease_expires_at = CASE
            WHEN $3::boolean OR ($1 = 'completed' AND cancel_requested) THEN NULL
            ELSE lease_expires_at
          END,
          updated_at = NOW()
      WHERE id = $4
        AND ($5::varchar IS NULL OR worker_id IS NULL OR worker_id = $5)
      RETURNING *;
    `;

    const res = await this.db.query(query, [status, error || null, isTerminal, runId, workerId || null]);
    if (!res.rows[0]) {
      // With a worker guard, an empty result is the expected outcome of losing the lease
      // race; the caller must not treat it as a failure. Without a guard it means the run
      // genuinely does not exist.
      if (workerId) return null;
      throw new Error(`Run not found: ${runId}`);
    }
    return this.mapRow(res.rows[0]);
  }

  public async requestCancellation(runId: string, reason: string): Promise<Run | null> {
    const result = await this.db.query(
      `
      UPDATE runs
      SET cancel_requested = TRUE,
          cancel_reason = $1,
          updated_at = NOW()
      WHERE id = $2
        AND status IN ('created', 'active', 'waiting_tool', 'waiting_child', 'waiting_approval')
      RETURNING *;
    `,
      [reason, runId]
    );

    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }

  public async isCancellationRequested(runId: string): Promise<{ requested: boolean; reason?: string }> {
    const result = await this.db.query('SELECT cancel_requested, cancel_reason FROM runs WHERE id = $1', [runId]);
    const row = result.rows[0];
    return {
      requested: Boolean(row?.cancel_requested),
      reason: row?.cancel_reason || undefined
    };
  }

  /**
   * Task-level cancellation read, the counterpart to `requestCancellationForTask`.
   *
   * An orchestrator task drives a whole delegation graph but has no Run row of its own, so a
   * cancel aimed at it is visible only through the runs of its child tasks (or a run created
   * directly on the task). Both cases are covered by the join.
   */
  public async isCancellationRequestedForTask(taskId: string): Promise<{ requested: boolean; reason?: string }> {
    const result = await this.db.query(
      `
      SELECT r.cancel_reason
      FROM runs r
      LEFT JOIN tasks t ON t.id = r.task_id
      WHERE (r.task_id = $1 OR t.parent_id = $1)
        AND r.cancel_requested = TRUE
      ORDER BY r.updated_at DESC
      LIMIT 1;
    `,
      [taskId]
    );

    const row = result.rows[0];
    return {
      requested: Boolean(row),
      reason: row?.cancel_reason || undefined
    };
  }

  /**
   * Task-level cancellation write, the counterpart to `isCancellationRequestedForTask`.
   *
   * It must match exactly what the read matches. An orchestrator task drives a whole delegation
   * graph and owns no Run row of its own, so its cancel is carried by the runs of its CHILD
   * tasks. Matching only `task_id = $2` updated zero rows for such a task: the delegator's poll
   * kept answering requested:false and the planner, every specialist, the QA gate and the
   * synthesiser ran to completion while the operator was told the stop had been sent.
   */
  public async requestCancellationForTask(taskId: string, reason: string): Promise<number> {
    const result = await this.db.query(
      `
      UPDATE runs
      SET cancel_requested = TRUE,
          cancel_reason = $1,
          updated_at = NOW()
      WHERE (
          task_id = $2
          OR task_id IN (SELECT id FROM tasks WHERE parent_id = $2)
        )
        AND status IN ('created', 'active', 'waiting_tool', 'waiting_child', 'waiting_approval')
        AND cancel_requested = FALSE;
    `,
      [reason, taskId]
    );

    return result.rowCount || 0;
  }

  public async requestCancellationForActive(reason: string): Promise<number> {
    const result = await this.db.query(
      `
      UPDATE runs
      SET cancel_requested = TRUE,
          cancel_reason = $1,
          updated_at = NOW()
      WHERE status IN ('created', 'active', 'waiting_tool', 'waiting_child', 'waiting_approval')
        AND cancel_requested = FALSE;
    `,
      [reason]
    );

    return result.rowCount || 0;
  }

  private mapRow(row: any): Run {
    return {
      id: row.id,
      taskId: row.task_id,
      agentId: row.agent_id,
      status: row.status,
      cancelRequested: Boolean(row.cancel_requested),
      cancelReason: row.cancel_reason || null,
      inputTokens: Number(row.input_tokens || 0),
      outputTokens: Number(row.output_tokens || 0),
      costUsd: Number(row.cost_usd || 0),
      turnsCount: Number(row.turns_count || 0),
      startedAt: row.started_at,
      endedAt: row.ended_at,
      error: row.error,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  private assertLeaseInput(workerId: string, leaseSeconds: number): void {
    if (!workerId.trim()) throw new RangeError('workerId must not be empty.');
    if (!Number.isFinite(leaseSeconds) || leaseSeconds <= 0) {
      throw new RangeError('leaseSeconds must be a positive finite number.');
    }
  }
}
