import { describe, expect, it, vi } from 'vitest';
import { IdempotencyRepository } from '../src/index.js';

const taskId = '123e4567-e89b-12d3-a456-426614174000';

function row(overrides: Record<string, unknown> = {}) {
  return {
    key: 'k1',
    task_id: taskId,
    run_id: null,
    action_name: 'communication.send_approved',
    payload_hash: 'hash',
    provider: null,
    remote_id: null,
    outcome: 'in_flight',
    result: null,
    error: null,
    created_at: '2026-08-26T00:00:00.000Z',
    updated_at: '2026-08-26T00:00:00.000Z',
    expires_at: '2026-08-26T01:00:00.000Z',
    ...overrides
  };
}

/**
 * A crashed process must not poison an idempotency key forever.
 *
 * `claim()` inserted with `ON CONFLICT (key) DO NOTHING` and never consulted `expires_at`, so a
 * row left `in_flight` by a process that died between claim and recordSuccess/recordFailure stayed
 * that way permanently. The tool gateway answers an `in_flight` record with
 * `{ success: false, error: 'Idempotent action is still in flight.' }`, and only the `expired`
 * outcome releases the key — so that (taskId, runId, action, payload) could never execute again,
 * and nothing in the system cleared the row: `expireStale` existed with no caller anywhere.
 */
describe('IdempotencyRepository.claim', () => {
  it('can take over an expired in-flight key instead of being blocked by it', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [row()] }) } as any;
    const repository = new IdempotencyRepository(db);

    await repository.claim({
      key: 'k1',
      taskId,
      actionName: 'communication.send_approved',
      payloadHash: 'hash',
      createdAt: new Date()
    });

    const sql = String(db.query.mock.calls[0][0]);
    // Reclaiming requires an upsert that is conditional on the stored row being stale.
    expect(sql).toContain('DO UPDATE');
    expect(sql).toContain('expires_at');
    expect(sql).toContain('in_flight');
  });

  it('still reports an unexpired in-flight key as taken', async () => {
    // The reclaim must not hand a live key to a second caller.
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) } as any;
    const repository = new IdempotencyRepository(db);

    const claimed = await repository.claim({
      key: 'k1',
      taskId,
      actionName: 'communication.send_approved',
      payloadHash: 'hash',
      createdAt: new Date()
    });

    expect(claimed).toBeNull();
    const sql = String(db.query.mock.calls[0][0]);
    // A live row fails the guard, so the upsert returns nothing.
    expect(sql).toContain("outcome = 'in_flight'");
    expect(sql).toContain('expires_at < NOW()');
  });
});
