import { describe, expect, it, vi } from 'vitest';
import { ApprovalRepository } from '../src/index.js';
import { TokenVerifier } from '@atlas/policy';

const row = {
  id: '123e4567-e89b-12d3-a456-426614174000',
  task_id: '123e4567-e89b-12d3-a456-426614174001',
  run_id: '123e4567-e89b-12d3-a456-426614174002',
  agent_id: 'hermes',
  action: 'communication.send_approved',
  target: '+628123456789',
  payload: { content: 'Hello' },
  payload_hash: 'payload-hash',
  reason: 'Approved outreach',
  risk_level: 'high',
  status: 'pending',
  requested_at: '2026-08-26T00:00:00.000Z',
  expires_at: '2026-08-26T01:00:00.000Z',
  decided_at: null,
  decided_by: null,
  decision_note: null
};

describe('ApprovalRepository', () => {
  it('lists and maps pending approval records', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [row] }) } as any;
    const repository = new ApprovalRepository(db);

    const approvals = await repository.list('pending', 25);

    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('FROM approvals'),
      ['pending', 25]
    );
    expect(approvals[0]?.taskId).toBe(row.task_id);
    expect(approvals[0]?.payload).toEqual(row.payload);
  });

  it('atomically records only a still-pending decision', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [{ ...row, status: 'approved', decided_by: 'owner' }] }) } as any;
    const repository = new ApprovalRepository(db);

    const approval = await repository.decide(
      row.id,
      'approved',
      'owner',
      'Approved from Telegram'
    );

    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining("status = 'pending'"),
      ['approved', 'owner', 'Approved from Telegram', row.id]
    );
    expect(approval?.status).toBe('approved');
    expect(approval?.decidedBy).toBe('owner');
  });

  it('returns null when the approval is no longer pending', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) } as any;
    const repository = new ApprovalRepository(db);

    await expect(repository.decide(row.id, 'rejected', 'owner')).resolves.toBeNull();
  });

  it('issues an execution token only for an approved, unexpired approval', async () => {
    const secret = 'approval-secret-key-for-tests-32-chars';
    const approvedRow = {
      ...row,
      status: 'approved',
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      decided_at: new Date().toISOString(),
      decided_by: 'owner'
    };
    const db = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [approvedRow] })
        .mockResolvedValueOnce({ rows: [{ ...approvedRow, execution_token_signature: 'stored-signature' }] })
    } as any;
    const repository = new ApprovalRepository(db, secret);

    const token = await repository.issueExecutionToken(row.id);

    expect(token?.requestId).toBe(row.id);
    expect(token?.action).toBe(row.action);
    expect(token?.payloadHash).toBe(TokenVerifier.hashPayload(row.payload));
    expect(db.query).toHaveBeenLastCalledWith(
      expect.stringContaining('execution_token_signature'),
      expect.arrayContaining([row.id])
    );
  });

  it('atomically claims an issued token and prevents a second worker from claiming it', async () => {
    const secret = 'approval-secret-key-for-tests-32-chars';
    const payload = { content: 'Hello' };
    const token = TokenVerifier.generateToken(row.id, row.action, payload, secret, 300);
    const claimedRow = {
      ...row,
      payload,
      payload_hash: token.payloadHash,
      status: 'executing',
      execution_token_signature: token.signature,
      execution_started_at: new Date().toISOString()
    };
    const db = {
      query: vi.fn().mockResolvedValueOnce({ rows: [claimedRow] }).mockResolvedValueOnce({ rows: [] })
    } as any;
    const repository = new ApprovalRepository(db, secret);

    const firstClaim = await repository.claimExecution(token, payload);
    const secondClaim = await repository.claimExecution(token, payload);

    expect(firstClaim?.status).toBe('executing');
    expect(secondClaim).toBeNull();
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining("status = 'approved'"),
      expect.arrayContaining([row.id, row.action, token.payloadHash, token.signature])
    );
  });

  it('finalizes a claimed execution as executed or revoked and never reopens it', async () => {
    const db = {
      query: vi.fn().mockResolvedValue({ rows: [{ ...row, status: 'executed' }] })
    } as any;
    const repository = new ApprovalRepository(db, 'approval-secret-key-for-tests-32-chars');

    const result = await repository.finalizeExecution(row.id, {
      success: true,
      output: { messageId: 'provider-1' }
    });

    expect(result?.status).toBe('executed');
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining("status = 'executing'"),
      expect.arrayContaining(['executed', row.id])
    );
  });

  it('creates one durable approval request for an exact task, action, and payload', async () => {
    const db = {
      query: vi.fn().mockResolvedValueOnce({ rows: [{ ...row, status: 'pending' }] })
    } as any;
    const repository = new ApprovalRepository(db, 'approval-secret-key-for-tests-32-chars');

    const approval = await repository.requestApproval({
      taskId: row.task_id,
      runId: row.run_id,
      agentId: row.agent_id,
      action: row.action,
      target: row.target,
      payload: row.payload,
      reason: row.reason,
      riskLevel: row.risk_level,
      expiresAt: new Date(Date.now() + 60_000)
    });

    expect(approval?.id).toBe(row.id);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('ON CONFLICT DO NOTHING'),
      expect.arrayContaining([row.task_id, row.run_id, row.action])
    );
  });
});
