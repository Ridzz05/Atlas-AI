import { describe, expect, it, vi } from 'vitest';
import { PostgresEventBus } from '../src/index.js';
import { SystemEvent } from '@atlas/shared';

const event: SystemEvent = {
  id: '123e4567-e89b-12d3-a456-426614174000',
  type: 'task.created',
  taskId: '123e4567-e89b-12d3-a456-426614174001',
  payload: { title: 'Test task' },
  timestamp: '2026-08-26T00:00:00.000Z'
};

describe('PostgresEventBus', () => {
  it('persists events in the outbox and publishes a notification', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const bus = new PostgresEventBus({ query } as any);
    const handler = vi.fn();
    bus.subscribe('*', handler);

    await bus.publish(event);

    expect(query).toHaveBeenNthCalledWith(1, expect.stringContaining('INSERT INTO event_outbox'), [
      event.id,
      event.type,
      event.taskId,
      null,
      null,
      JSON.stringify(event.payload),
      event.timestamp
    ]);
    expect(query).toHaveBeenNthCalledWith(2, expect.stringContaining('pg_notify'), ['atlas_events', JSON.stringify(event)]);
    expect(handler).toHaveBeenCalledWith(event);
  });
});
