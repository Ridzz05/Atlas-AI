import { ApprovalRequest, ApprovalStatus, ApprovalToken } from '@atlas/shared';
import { TokenVerifier } from '@atlas/policy';
import { DatabaseClient } from '../client.js';

export class ApprovalRepository {
  constructor(private db: DatabaseClient, private approvalSecretKey?: string) {}

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

  public async requestApproval(input: {
    taskId: string;
    runId: string;
    agentId: string;
    action: string;
    target: string;
    payload: Record<string, unknown>;
    reason: string;
    riskLevel: ApprovalRequest['riskLevel'];
    expiresAt: Date;
  }): Promise<ApprovalRequest | null> {
    const id = crypto.randomUUID();
    const payloadHash = TokenVerifier.hashPayload(input.payload);
    const inserted = await this.db.query(
      `WITH expired_requests AS (
         UPDATE approvals
         SET status = 'expired',
             decided_at = COALESCE(decided_at, NOW()),
             decision_note = COALESCE(decision_note, 'Approval request expired before retry.')
         WHERE task_id = $2
           AND run_id = $3
           AND action = $5
           AND payload_hash = $8
           AND status IN ('pending', 'approved', 'executing')
           AND expires_at <= NOW()
       )
       INSERT INTO approvals (
         id, task_id, run_id, agent_id, action, target, payload, payload_hash,
         reason, risk_level, status, expires_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending', $11)
       ON CONFLICT DO NOTHING
       RETURNING *`,
      [
        id,
        input.taskId,
        input.runId,
        input.agentId,
        input.action,
        input.target,
        JSON.stringify(input.payload),
        payloadHash,
        input.reason,
        input.riskLevel,
        input.expiresAt
      ]
    );
    if (inserted.rows[0]) return this.mapRow(inserted.rows[0]);

    const existing = await this.db.query(
      `SELECT * FROM approvals
       WHERE task_id = $1
         AND run_id = $2
         AND action = $3
         AND payload_hash = $4
         AND status IN ('pending', 'approved', 'executing')
         AND expires_at > NOW()
       ORDER BY requested_at DESC
       LIMIT 1`,
      [input.taskId, input.runId, input.action, payloadHash]
    );
    return existing.rows[0] ? this.mapRow(existing.rows[0]) : null;
  }

  public async issueExecutionToken(id: string, ttlSeconds = 3600): Promise<ApprovalToken | null> {
    if (!this.approvalSecretKey) {
      throw new Error('Approval token signing key is not configured.');
    }

    const current = await this.db.query(
      'SELECT * FROM approvals WHERE id = $1 AND status = $2 AND expires_at > NOW()',
      [id, 'approved']
    );
    const row = current.rows[0];
    if (!row) return null;

    const approvalExpiresAt = Math.floor(new Date(row.expires_at).getTime() / 1000);
    const requestedExpiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
    const expiresAt = Math.min(approvalExpiresAt, requestedExpiresAt);
    if (expiresAt <= Math.floor(Date.now() / 1000)) return null;

    const token = TokenVerifier.generateTokenForExpiry(
      row.id,
      row.action,
      typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload || {},
      this.approvalSecretKey,
      expiresAt
    );

    const stored = await this.db.query(
      `UPDATE approvals
       SET execution_token_signature = $1,
           token_issued_at = NOW()
       WHERE id = $2
         AND status = 'approved'
         AND expires_at > NOW()
       RETURNING *`,
      [token.signature, id]
    );
    return stored.rows[0] ? token : null;
  }

  public async claimExecution(token: ApprovalToken, currentPayload: unknown): Promise<ApprovalRequest | null> {
    if (!this.approvalSecretKey) {
      throw new Error('Approval token signing key is not configured.');
    }

    const verification = TokenVerifier.verifyToken(token, currentPayload, this.approvalSecretKey);
    if (!verification.valid) return null;

    const result = await this.db.query(
      `UPDATE approvals
       SET status = 'executing',
           execution_started_at = NOW(),
           execution_error = NULL
       WHERE id = $1
         AND action = $2
         AND payload_hash = $3
         AND execution_token_signature = $4
         AND status = 'approved'
         AND expires_at > NOW()
       RETURNING *`,
      [token.requestId, token.action, token.payloadHash, token.signature]
    );
    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }

  public async getExecutionStatus(id: string): Promise<ApprovalStatus | null> {
    const result = await this.db.query(
      'SELECT status FROM approvals WHERE id = $1',
      [id]
    );
    return result.rows[0]?.status || null;
  }

  public async finalizeExecution(
    id: string,
    result: { success: boolean; output?: unknown; error?: string }
  ): Promise<ApprovalRequest | null> {
    const status: Extract<ApprovalStatus, 'executed' | 'revoked'> = result.success ? 'executed' : 'revoked';
    const updated = await this.db.query(
      `UPDATE approvals
       SET status = $1,
           executed_at = NOW(),
           execution_result = $2,
           execution_error = $3
       WHERE id = $4
         AND status = 'executing'
       RETURNING *`,
      [status, result.output === undefined ? null : JSON.stringify(result.output), result.error || null, id]
    );
    return updated.rows[0] ? this.mapRow(updated.rows[0]) : null;
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
      decisionNote: row.decision_note,
      executionStartedAt: row.execution_started_at || null,
      executedAt: row.executed_at || null,
      executionResult: typeof row.execution_result === 'string' ? JSON.parse(row.execution_result) : row.execution_result || null,
      executionError: row.execution_error || null
    };
  }
}
