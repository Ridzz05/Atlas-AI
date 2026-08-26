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

  it('replays events after a durable event cursor in chronological order', async () => {
    const cursorId = '123e4567-e89b-12d3-a456-426614174000';
    const nextEventId = '123e4567-e89b-12d3-a456-426614174002';
    const db = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ event_id: cursorId, occurred_at: '2026-08-26T00:00:00.000Z' }] })
        .mockResolvedValueOnce({ rows: [{
          event_id: nextEventId,
          event_type: 'run.completed',
          task_id: null,
          run_id: '123e4567-e89b-12d3-a456-426614174001',
          agent_id: 'chief',
          payload: { status: 'completed' },
          occurred_at: '2026-08-26T00:00:01.000Z'
        }] })
    } as any;
    const repository = new SystemEventRepository(db);

    const events = await repository.listAfterId(cursorId, 10);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ id: nextEventId, type: 'run.completed' });
    expect(db.query).toHaveBeenNthCalledWith(2, expect.stringContaining('ORDER BY occurred_at ASC'), [
      '2026-08-26T00:00:00.000Z',
      cursorId,
      10
    ]);
  });
});
