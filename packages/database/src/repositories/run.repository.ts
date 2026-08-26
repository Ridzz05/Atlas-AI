import { DatabaseClient } from '../client.js';
import { Run, RunStatus } from '@atlas/shared';

export interface CreateRunInput {
  taskId: string;
  agentId: string;
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
}
