import { FastifyInstance } from 'fastify';
import { EventBus } from '@atlas/events';
import { SystemEventRepository } from '@atlas/database';
import { SystemEvent, SystemEventSchema } from '@atlas/shared';

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
    const lastEventHeader = req.headers['last-event-id'];
    const lastEventId = Array.isArray(lastEventHeader) ? lastEventHeader[0] : lastEventHeader;
    if (lastEventId && !SystemEventSchema.shape.id.safeParse(lastEventId).success) {
      return reply.status(400).send({ error: 'Last-Event-ID must be a valid event UUID.' });
    }

    reply.hijack();
    const response = reply.raw;
    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no'
    });
    response.write(': connected\n\n');

    const pendingLiveEvents: SystemEvent[] = [];
    let replayComplete = !lastEventId || !options.eventRepo;
    const send = (event: SystemEvent) => {
      if (!response.writableEnded) {
        response.write(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      }
    };
    const handleLiveEvent = (event: SystemEvent) => {
      if (!replayComplete) {
        pendingLiveEvents.push(event);
        return;
      }
      send(event);
    };
    const unsubscribe = options.eventBus.subscribe('*', handleLiveEvent);

    if (!replayComplete && lastEventId && options.eventRepo) {
      try {
        const replayedEvents = await options.eventRepo.listAfterId(lastEventId, 100);
        const replayedIds = new Set(replayedEvents.map(event => event.id));
        replayedEvents.forEach(send);
        pendingLiveEvents.filter(event => !replayedIds.has(event.id)).forEach(send);
      } catch {
        response.write(': durable replay unavailable; live events remain connected\n\n');
      } finally {
        replayComplete = true;
        pendingLiveEvents.length = 0;
      }
    }

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
