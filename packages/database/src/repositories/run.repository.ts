import { DatabaseClient } from '../client.js';
import { Run, RunStatus } from '@atlas/shared';

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
    const periodStart = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate()
    ));
    const periodEnd = new Date(periodStart.getTime() + 24 * 60 * 60 * 1000);

    const [summaryResult, byAgentResult] = await Promise.all([
      this.db.query(`
        SELECT
          COALESCE(SUM(cost_usd) FILTER (WHERE created_at >= $1 AND created_at < $2), 0) AS period_cost_usd,
          COALESCE(SUM(cost_usd), 0) AS total_cost_usd,
          COUNT(*)::int AS run_count,
          COUNT(*) FILTER (WHERE status IN ('created', 'active', 'waiting_tool', 'waiting_child', 'waiting_approval'))::int AS active_run_count,
          COUNT(*) FILTER (WHERE status = 'completed')::int AS completed_run_count,
          COUNT(*) FILTER (WHERE status IN ('failed', 'cancelled', 'timed_out'))::int AS failed_run_count
        FROM runs`,
      [periodStart.toISOString(), periodEnd.toISOString()]),
      this.db.query(`
        SELECT
          agent_id,
          COALESCE(SUM(cost_usd) FILTER (WHERE created_at >= $1 AND created_at < $2), 0) AS period_cost_usd,
          COALESCE(SUM(cost_usd), 0) AS cost_usd,
          COUNT(*)::int AS run_count
        FROM runs
        GROUP BY agent_id
        ORDER BY SUM(cost_usd) DESC, agent_id ASC`,
      [periodStart.toISOString(), periodEnd.toISOString()])
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

  public async acquireLease(runId: string, workerId: string, leaseSeconds = 60): Promise<Run | null> {
    this.assertLeaseInput(workerId, leaseSeconds);
    const result = await this.db.query(`
      UPDATE runs
      SET worker_id = $2,
          heartbeat_at = NOW(),
          lease_expires_at = NOW() + ($3 * INTERVAL '1 second'),
          updated_at = NOW()
      WHERE id = $1
        AND status IN ('created', 'active', 'waiting_tool', 'waiting_child')
        AND (worker_id IS NULL OR lease_expires_at < NOW() OR worker_id = $2)
      RETURNING *;
    `, [runId, workerId, leaseSeconds]);

    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }

  public async heartbeat(runId: string, workerId: string, leaseSeconds = 60): Promise<boolean> {
    this.assertLeaseInput(workerId, leaseSeconds);
    const result = await this.db.query(`
      UPDATE runs
      SET heartbeat_at = NOW(),
          lease_expires_at = NOW() + ($3 * INTERVAL '1 second'),
          updated_at = NOW()
      WHERE id = $1
        AND worker_id = $2
        AND status IN ('created', 'active', 'waiting_tool', 'waiting_child')
    `, [runId, workerId, leaseSeconds]);

    return (result.rowCount || 0) > 0;
  }

  public async releaseLease(runId: string, workerId?: string): Promise<boolean> {
    const result = await this.db.query(`
      UPDATE runs
      SET worker_id = NULL,
          heartbeat_at = NULL,
          lease_expires_at = NULL,
          updated_at = NOW()
      WHERE id = $1
        AND ($2::varchar IS NULL OR worker_id = $2)
    `, [runId, workerId || null]);

    return (result.rowCount || 0) > 0;
  }

  public async recoverStaleRuns(reason = 'Worker lease expired'): Promise<number> {
    if (!reason.trim()) throw new RangeError('reason must not be empty.');
    const result = await this.db.query(`
      UPDATE runs
      SET status = 'failed',
          error = COALESCE($1, error),
          ended_at = COALESCE(ended_at, NOW()),
          worker_id = NULL,
          heartbeat_at = NULL,
          lease_expires_at = NULL,
          updated_at = NOW()
      WHERE status IN ('created', 'active', 'waiting_tool', 'waiting_child')
        AND lease_expires_at IS NOT NULL
        AND lease_expires_at < NOW()
    `, [reason]);

    return result.rowCount || 0;
  }

  public async recordTurn(
    runId: string,
    inputTokens: number,
    outputTokens: number,
    costUsd: number
  ): Promise<Run> {
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

  public async updateStatus(runId: string, status: RunStatus, error?: string): Promise<Run> {
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
      RETURNING *;
    `;

    const res = await this.db.query(query, [status, error || null, isTerminal, runId]);
    if (!res.rows[0]) {
      throw new Error(`Run not found: ${runId}`);
    }
    return this.mapRow(res.rows[0]);
  }

  public async requestCancellation(runId: string, reason: string): Promise<Run | null> {
    const result = await this.db.query(`
      UPDATE runs
      SET cancel_requested = TRUE,
          cancel_reason = $1,
          updated_at = NOW()
      WHERE id = $2
        AND status IN ('created', 'active', 'waiting_tool', 'waiting_child', 'waiting_approval')
      RETURNING *;
    `, [reason, runId]);

    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }

  public async isCancellationRequested(runId: string): Promise<{ requested: boolean; reason?: string }> {
    const result = await this.db.query(
      'SELECT cancel_requested, cancel_reason FROM runs WHERE id = $1',
      [runId]
    );
    const row = result.rows[0];
    return {
      requested: Boolean(row?.cancel_requested),
      reason: row?.cancel_reason || undefined
    };
  }

  public async requestCancellationForTask(taskId: string, reason: string): Promise<number> {
    const result = await this.db.query(`
      UPDATE runs
      SET cancel_requested = TRUE,
          cancel_reason = $1,
          updated_at = NOW()
      WHERE task_id = $2
        AND status IN ('created', 'active', 'waiting_tool', 'waiting_child', 'waiting_approval')
        AND cancel_requested = FALSE;
    `, [reason, taskId]);

    return result.rowCount || 0;
  }

  public async requestCancellationForActive(reason: string): Promise<number> {
    const result = await this.db.query(`
      UPDATE runs
      SET cancel_requested = TRUE,
          cancel_reason = $1,
          updated_at = NOW()
      WHERE status IN ('created', 'active', 'waiting_tool', 'waiting_child', 'waiting_approval')
        AND cancel_requested = FALSE;
    `, [reason]);

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
