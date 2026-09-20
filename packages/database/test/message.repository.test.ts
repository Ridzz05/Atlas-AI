import { describe, expect, it, vi } from 'vitest';
import { MessageRepository } from '../src/index.js';

const taskId = '123e4567-e89b-12d3-a456-426614174000';

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: '123e4567-e89b-12d3-a456-426614174001',
    task_id: taskId,
    run_id: null,
    sender_type: 'agent',
    sender_id: 'chief',
    recipient_id: null,
    content: 'hello',
    metadata: {},
    created_at: '2026-08-26T00:00:00.000Z',
    ...overrides
  };
}

/**
 * A feed read and a thread read want opposite ends of the table, and the repository only had one.
 *
 * `list()` always ordered `created_at ASC, id ASC LIMIT $n` with the limit clamped to 200. That is
 * right for a conversation (a task's messages from its beginning) and wrong for a feed: the dashboard
 * asked for `limit=100`, so it received the first 100 messages ever written, sorted them newest-first,
 * and re-fetched that same page on every SSE event. New activity could never enter the page — the
 * header read "Live durable stream of peer messages" over a list whose newest row was months old.
 *
 * The direction is now an explicit argument rather than something a caller has to infer from the SQL.
 */
describe('MessageRepository.list ordering', () => {
  function capture() {
    const query = vi.fn().mockResolvedValue({ rows: [row()] });
    return { repository: new MessageRepository({ query } as any), query };
  }

  it('reads the newest messages first for a feed', async () => {
    const { repository, query } = capture();

    await repository.list({ order: 'newest', limit: 100 });

    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toMatch(/ORDER BY created_at DESC, id DESC/);
  });

  it('reads a task thread from its beginning', async () => {
    const { repository, query } = capture();

    await repository.list({ taskId, order: 'oldest' });

    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toMatch(/ORDER BY created_at ASC, id ASC/);
  });

  it('defaults to the chronological order a thread needs', async () => {
    const { repository, query } = capture();

    await repository.list({ taskId });

    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toMatch(/ORDER BY created_at ASC, id ASC/);
  });

  it('still clamps the limit', async () => {
    const { repository, query } = capture();

    await repository.list({ order: 'newest', limit: 100000 });

    expect(query.mock.calls[0]?.[1]).toContain(200);
  });
});
