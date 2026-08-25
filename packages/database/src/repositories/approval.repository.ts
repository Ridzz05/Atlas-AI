import { ApprovalRequest, ApprovalStatus } from '@atlas/shared';
import { DatabaseClient } from '../client.js';

export class ApprovalRepository {
  constructor(private db: DatabaseClient) {}

  public async findById(id: string): Promise<ApprovalRequest | null> {
    const result = await this.db.query('SELECT * FROM approvals WHERE id = $1', [id]);
    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }

  public async list(status: ApprovalStatus = 'pending', limit = 50): Promise<ApprovalRequest[]> {
    const result = await this.db.query(
      'SELECT * FROM approvals WHERE status = $1 ORDER BY requested_at DESC LIMIT $2',
      [status, limit]
    );
    return result.rows.map(row => this.mapRow(row));
  }

  public async decide(
    id: string,
    status: Extract<ApprovalStatus, 'approved' | 'rejected' | 'revision_requested'>,
    decidedBy: string,
    decisionNote?: string
  ): Promise<ApprovalRequest | null> {
    const result = await this.db.query(
      `UPDATE approvals
       SET status = $1,
           decided_at = NOW(),
           decided_by = $2,
           decision_note = $3
       WHERE id = $4
         AND status = 'pending'
         AND expires_at > NOW()
       RETURNING *`,
      [status, decidedBy, decisionNote || null, id]
    );
    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }

  private mapRow(row: any): ApprovalRequest {
    return {
      id: row.id,
      taskId: row.task_id,
      runId: row.run_id,
      agentId: row.agent_id,
      action: row.action,
      target: row.target,
      payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload || {},
      payloadHash: row.payload_hash,
      reason: row.reason,
      riskLevel: row.risk_level,
      status: row.status,
      requestedAt: row.requested_at,
      expiresAt: row.expires_at,
      decidedAt: row.decided_at,
      decidedBy: row.decided_by,
      decisionNote: row.decision_note
    };
  }
}
