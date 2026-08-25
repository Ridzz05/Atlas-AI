import { describe, it, expect, vi } from 'vitest';
import { InMemoryEventBus } from '../src/index.js';
import { SystemEvent } from '@atlas/shared';

describe('@atlas/events InMemoryEventBus', () => {
  it('publishes and receives specific events', async () => {
    const bus = new InMemoryEventBus();
    const handler = vi.fn();

    bus.subscribe('task.created', handler);

    const event: SystemEvent = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      type: 'task.created',
      taskId: '123e4567-e89b-12d3-a456-426614174000',
      payload: { title: 'Test Task' },
      timestamp: new Date().toISOString()
    };

    await bus.publish(event);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(event);
  });

  it('handles wildcard subscribers', async () => {
    const bus = new InMemoryEventBus();
    const wildcardHandler = vi.fn();

    bus.subscribe('*', wildcardHandler);

    const event: SystemEvent = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      type: 'run.started',
      payload: { agentId: 'chief' },
      timestamp: new Date().toISOString()
    };

    await bus.publish(event);

    expect(wildcardHandler).toHaveBeenCalledTimes(1);
    expect(wildcardHandler).toHaveBeenCalledWith(event);
  });

  it('unsubscribes properly', async () => {
    const bus = new InMemoryEventBus();
    const handler = vi.fn();

    const unsubscribe = bus.subscribe('task.created', handler);
    unsubscribe();

    const event: SystemEvent = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      type: 'task.created',
      payload: { title: 'Test Task' },
      timestamp: new Date().toISOString()
    };

    await bus.publish(event);
    expect(handler).not.toHaveBeenCalled();
  });
});
