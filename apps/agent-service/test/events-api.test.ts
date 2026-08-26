import { describe, expect, it, vi } from 'vitest';
import { InMemoryEventBus } from '@atlas/events';
import { EnvConfigSchema } from '@atlas/shared';
import { buildServer } from '../src/server.js';

describe('agent-service event endpoints', () => {
  const event = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    type: 'task.updated' as const,
    taskId: '123e4567-e89b-12d3-a456-426614174001',
    payload: { status: 'running' },
    timestamp: '2026-08-26T00:00:00.000Z'
  };

  it('returns durable events with validated query parameters', async () => {
    const eventRepo = { list: vi.fn().mockResolvedValue([event]) } as any;
    const server = buildServer({
      config: EnvConfigSchema.parse({ NODE_ENV: 'test' }),
      eventRepo
    });

    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/events?limit=10&since=2026-08-25T00:00:00.000Z'
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({ data: [event], count: 1, durable: true });
    expect(eventRepo.list).toHaveBeenCalledWith({
      limit: 10,
      since: new Date('2026-08-25T00:00:00.000Z')
    });
  });

  it('rejects invalid event query parameters', async () => {
    const server = buildServer({
      config: EnvConfigSchema.parse({ NODE_ENV: 'test' }),
      eventRepo: { list: vi.fn() } as any
    });

    const invalidLimit = await server.inject({ method: 'GET', url: '/api/v1/events?limit=0' });
    const invalidSince = await server.inject({ method: 'GET', url: '/api/v1/events?since=not-a-date' });

    expect(invalidLimit.statusCode).toBe(400);
    expect(invalidSince.statusCode).toBe(400);
  });

  it('exposes an authenticated-compatible SSE stream backed by the event bus', async () => {
    const eventBus = new InMemoryEventBus();
    const server = buildServer({
      config: EnvConfigSchema.parse({ NODE_ENV: 'test' }),
      eventBus
    });

    const address = await server.listen({ host: '127.0.0.1', port: 0 });
    const controller = new AbortController();
    try {
      const response = await fetch(`${address}/api/v1/events/stream`, { signal: controller.signal });
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/event-stream');
      const reader = response.body!.getReader();
      const firstChunk = await reader.read();
      expect(new TextDecoder().decode(firstChunk.value)).toContain(': connected');
      await reader.cancel();
      controller.abort();
    } finally {
      await server.close();
    }
  });
});
