import { describe, expect, it, vi } from 'vitest';
import { SystemEventRepository } from '../src/index.js';

describe('SystemEventRepository', () => {
  it('lists recent outbox events in newest-first order', async () => {
    const db = {
      query: vi.fn().mockResolvedValue({ rows: [{
        event_id: '123e4567-e89b-12d3-a456-426614174000',
        event_type: 'task.updated',
        task_id: '123e4567-e89b-12d3-a456-426614174001',
        run_id: null,
        agent_id: 'chief',
        payload: { status: 'running' },
        occurred_at: '2026-08-26T00:00:00.000Z'
      }] })
    } as any;
    const repository = new SystemEventRepository(db);

    const events = await repository.list({ limit: 10 });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      id: '123e4567-e89b-12d3-a456-426614174000',
      type: 'task.updated',
      taskId: '123e4567-e89b-12d3-a456-426614174001',
      payload: { status: 'running' }
    });
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('ORDER BY occurred_at DESC'),
      [10]
    );
  });
});
