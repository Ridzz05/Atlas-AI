import { FastifyInstance } from 'fastify';
import { AgentRunner } from '@atlas/orchestration';
import { RunRepository } from '@atlas/database';
import { rootLogger } from '@atlas/observability';

export interface RunRouteOptions {
  runner: AgentRunner;
  runRepo?: RunRepository;
}

export function registerRunRoutes(app: FastifyInstance, options: RunRouteOptions): void {
  // Cancel active run
  app.post('/api/v1/runs/:id/cancel', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body as any) || {};
    const reason = body.reason || 'Cancelled via API';

    const cancelled = options.runner.cancelRun(id, reason);
    if (!cancelled) {
      return reply.status(404).send({
        error: `Active run not found or already completed: ${id}`
      });
    }

    return reply.status(200).send({
      message: `Run ${id} cancelled successfully`,
      reason
    });
  });

  // Get run details
  app.get('/api/v1/runs/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
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
