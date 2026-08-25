import { describe, expect, it, vi } from 'vitest';
import { ApprovalRepository } from '../src/index.js';

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
});
