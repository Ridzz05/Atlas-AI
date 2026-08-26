import { FastifyInstance } from 'fastify';
import { RunRepository, TelegramStateRepository } from '@atlas/database';
import { rootLogger } from '@atlas/observability';
import { z } from 'zod';

const ControlBodySchema = z.object({
  reason: z.string().trim().min(1).max(500).optional()
});

const API_OWNER = 'api-owner';

export interface ControlRouteOptions {
  controlStateRepo?: TelegramStateRepository;
  runRepo?: RunRepository;
}

export function registerControlRoutes(app: FastifyInstance, options: ControlRouteOptions): void {
  app.get('/api/v1/control', async (_req, reply) => {
    if (!options.controlStateRepo) {
      return reply.status(503).send({ error: 'Durable control state unavailable.' });
    }

    try {
      const data = await options.controlStateRepo.getControlState();
      return reply.status(200).send({ data, durable: true });
    } catch (err) {
      rootLogger.error('Failed to read durable execution control state', { error: String(err) });
      return reply.status(503).send({ error: 'Durable control state unavailable.' });
    }
  });

  app.post('/api/v1/control/emergency-stop', async (req, reply) => {
    const parsedBody = ControlBodySchema.safeParse(req.body ?? {});
    if (!parsedBody.success) {
      return reply.status(400).send({ error: 'Invalid control action reason.' });
    }
    if (!options.controlStateRepo) {
      return reply.status(503).send({ error: 'Durable control state unavailable.' });
    }

    const reason = parsedBody.data.reason || 'Emergency stop activated by API owner';
    try {
      const data = await options.controlStateRepo.setEmergencyStop(true, API_OWNER);
      const cancelledRuns = options.runRepo?.requestCancellationForActive ? await options.runRepo.requestCancellationForActive(reason) : 0;
      return reply.status(200).send({ data, cancelledRuns, reason, durable: true });
    } catch (err) {
      rootLogger.error('Failed to activate durable emergency stop', { error: String(err) });
      return reply.status(503).send({ error: 'Emergency stop could not be completed.' });
    }
  });

  app.post('/api/v1/control/pause', async (req, reply) => {
    const parsedBody = ControlBodySchema.safeParse(req.body ?? {});
    if (!parsedBody.success) {
      return reply.status(400).send({ error: 'Invalid control action reason.' });
    }
    if (!options.controlStateRepo) {
      return reply.status(503).send({ error: 'Durable control state unavailable.' });
    }

    try {
      const data = await options.controlStateRepo.setPaused(true, API_OWNER);
      return reply.status(200).send({ data, reason: parsedBody.data.reason, durable: true });
    } catch (err) {
      rootLogger.error('Failed to pause durable execution control state', { error: String(err) });
      return reply.status(503).send({ error: 'Pause action could not be completed.' });
    }
  });

  app.post('/api/v1/control/resume', async (req, reply) => {
    const parsedBody = ControlBodySchema.safeParse(req.body ?? {});
    if (!parsedBody.success) {
      return reply.status(400).send({ error: 'Invalid control action reason.' });
    }
    if (!options.controlStateRepo) {
      return reply.status(503).send({ error: 'Durable control state unavailable.' });
    }

    try {
      const data =
        typeof options.controlStateRepo.resume === 'function'
          ? await options.controlStateRepo.resume(API_OWNER)
          : await options.controlStateRepo.setPaused(false, API_OWNER);
      return reply.status(200).send({ data, reason: parsedBody.data.reason, durable: true });
    } catch (err) {
      rootLogger.error('Failed to resume durable execution control state', { error: String(err) });
      return reply.status(503).send({ error: 'Resume action could not be completed.' });
    }
  });
}
