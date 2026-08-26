import { FastifyInstance } from 'fastify';
import { AgentRunner } from '@atlas/orchestration';
import { RunRepository } from '@atlas/database';
import { rootLogger } from '@atlas/observability';
import { z } from 'zod';

const RunIdSchema = z.string().uuid();
const CancellationBodySchema = z.object({
  reason: z.string().trim().min(1).max(500).optional()
});

export interface RunRouteOptions {
  runner: AgentRunner;
  runRepo?: RunRepository;
}

export function registerRunRoutes(app: FastifyInstance, options: RunRouteOptions): void {
  // Cancel active run
  app.post('/api/v1/runs/:id/cancel', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!RunIdSchema.safeParse(id).success) {
      return reply.status(400).send({ error: 'Run id must be a UUID.' });
    }

    const parsedBody = CancellationBodySchema.safeParse(req.body ?? {});
    if (!parsedBody.success) {
      return reply.status(400).send({ error: 'Invalid cancellation reason.' });
    }
    const reason = parsedBody.data.reason || 'Cancelled via API';

    const cancelled = await options.runner.requestCancellation(id, reason);
    if (!cancelled) {
      return reply.status(404).send({
        error: `Active run not found or already completed: ${id}`
      });
    }

    return reply.status(200).send({
      message: `Cancellation requested for run ${id}`,
      reason
    });
  });

  // Get run details
  app.get('/api/v1/runs/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!RunIdSchema.safeParse(id).success) {
      return reply.status(400).send({ error: 'Run id must be a UUID.' });
    }
    if (!options.runRepo) {
      return reply.status(501).send({ error: 'Run repository not configured' });
    }

    const run = await options.runRepo.findById(id);
    if (!run) {
      return reply.status(404).send({ error: `Run not found: ${id}` });
    }

    return reply.status(200).send(run);
  });
}
