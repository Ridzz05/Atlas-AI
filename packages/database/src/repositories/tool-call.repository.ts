import { ToolCall, ToolRiskLevel } from '@atlas/shared';
import { DatabaseClient } from '../client.js';

export type ToolCallStatus = 'pending' | 'running' | 'success' | 'failed' | 'blocked_approval';

export interface ToolCallCreateInput {
  runId: string;
  taskId: string;
  agentId: string;
  toolName: string;
  input: Record<string, unknown>;
  riskLevel?: ToolRiskLevel;
  requiresApproval?: boolean;
  approvalId?: string | null;
}

export interface ToolCallCompletionInput {
  status: ToolCallStatus;
  output?: Record<string, unknown> | null;
  error?: string | null;
  durationMs?: number | null;
  approvalId?: string | null;
}

export class ToolCallRepository {
  constructor(private db: DatabaseClient) {}

  public async create(input: ToolCallCreateInput, id = crypto.randomUUID()): Promise<ToolCall> {
    const result = await this.db.query(
      `
      INSERT INTO tool_calls (
        id, run_id, task_id, agent_id, tool_name, input, risk_level, requires_approval, approval_id, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending')
      RETURNING *
    `,
      [
        id,
        input.runId,
        input.taskId,
        input.agentId,
        input.toolName,
        JSON.stringify(input.input),
        input.riskLevel || 'read',
        input.requiresApproval || false,
        input.approvalId || null
      ]
    );

    return this.mapRow(result.rows[0]);
  }

  public async complete(id: string, input: ToolCallCompletionInput): Promise<ToolCall | null> {
    const result = await this.db.query(
      `
      UPDATE tool_calls
      SET output = $1,
          error = $2,
          duration_ms = $3,
          status = $4,
          approval_id = COALESCE($5, approval_id)
      WHERE id = $6
      RETURNING *
    `,
      [
        input.output == null ? null : JSON.stringify(input.output),
        input.error || null,
        input.durationMs ?? null,
        input.status,
        input.approvalId || null,
        id
      ]
    );

    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }

  /**
   * List tool calls, oldest-first by default (a run's or a task's own history reads forwards).
   * `order: 'newest'` is what a feed wants; see MessageRepository.list for why the direction is an
   * explicit argument rather than something implied by the SQL alone.
   */
  public async list(options: { taskId?: string; runId?: string; limit?: number; order?: 'oldest' | 'newest' } = {}): Promise<ToolCall[]> {
    const limit = Math.min(200, Math.max(1, Math.trunc(options.limit || 100)));
    const values: unknown[] = [];
    const filters: string[] = [];

    if (options.taskId) {
      values.push(options.taskId);
      filters.push(`task_id = $${values.length}`);
    }
    if (options.runId) {
      values.push(options.runId);
      filters.push(`run_id = $${values.length}`);
    }

    let sql = 'SELECT * FROM tool_calls';
    if (filters.length > 0) sql += ` WHERE ${filters.join(' AND ')}`;
    values.push(limit);
    const direction = options.order === 'newest' ? 'DESC' : 'ASC';
    sql += ` ORDER BY created_at ${direction}, id ${direction} LIMIT $${values.length}`;

    const result = await this.db.query(sql, values);
    return result.rows.map(row => this.mapRow(row));
  }

  private mapRow(row: any): ToolCall {
    if (!row) throw new Error('Tool call repository returned an empty row.');
    return {
      id: row.id,
      runId: row.run_id,
      taskId: row.task_id,
      agentId: row.agent_id,
      toolName: row.tool_name,
      input: this.parseJson(row.input) || {},
      output: this.parseJson(row.output),
      error: row.error || null,
      durationMs: row.duration_ms == null ? null : Number(row.duration_ms),
      riskLevel: row.risk_level || 'read',
      requiresApproval: Boolean(row.requires_approval),
      approvalId: row.approval_id || null,
      status: row.status || 'pending',
      createdAt: row.created_at
    };
  }

  private parseJson(value: unknown): any {
    return typeof value === 'string' ? JSON.parse(value) : value || null;
  }
}
