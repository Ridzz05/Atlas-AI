import { FastifyInstance } from 'fastify';
import { EventBus } from '@atlas/events';
import { SystemEventRepository } from '@atlas/database';

export interface EventRouteOptions {
  eventBus: EventBus;
  eventRepo?: SystemEventRepository;
}

export function registerEventRoutes(app: FastifyInstance, options: EventRouteOptions): void {
  app.get('/api/v1/events', async (req, reply) => {
    const query = req.query as { limit?: string; since?: string };
    const limit = query.limit ? Number(query.limit) : 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      return reply.status(400).send({ error: 'Event limit must be an integer from 1 to 100.' });
    }

    if (!options.eventRepo) {
      return reply.status(200).send({ data: [], count: 0, durable: false });
    }

    const since = query.since ? new Date(query.since) : undefined;
    if (since && Number.isNaN(since.getTime())) {
      return reply.status(400).send({ error: 'Event since must be a valid ISO timestamp.' });
    }

    const data = await options.eventRepo.list({ limit, since });
    return reply.status(200).send({ data, count: data.length, durable: true });
  });

  app.get('/api/v1/events/stream', async (req, reply) => {
    reply.hijack();
    const response = reply.raw;
    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no'
    });
    response.write(': connected\n\n');

    const send = (event: unknown) => {
      if (!response.writableEnded) {
        const typedEvent = event as { id?: string; type?: string };
        response.write(`id: ${typedEvent.id || 'event'}\nevent: ${typedEvent.type || 'message'}\ndata: ${JSON.stringify(event)}\n\n`);
      }
    };
    const unsubscribe = options.eventBus.subscribe('*', send);
    const heartbeat = setInterval(() => {
      if (!response.writableEnded) response.write(': heartbeat\n\n');
    }, 15000);
    const cleanup = () => {
      clearInterval(heartbeat);
      unsubscribe();
    };
    req.raw.once('close', cleanup);
    return reply;
  });
}
