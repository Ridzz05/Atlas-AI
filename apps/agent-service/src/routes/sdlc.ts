import { FastifyInstance } from 'fastify';
import { CreateSDLCInitiativeInputSchema } from '@atlas/shared';
import { SDLCRepository } from '@atlas/database';
import { SDLCEngine } from '@atlas/orchestration';
import { rootLogger } from '@atlas/observability';
import { z } from 'zod';

const InitiativeIdSchema = z.string().uuid();

export interface SDLCRouteOptions {
  sdlcRepo: SDLCRepository;
  sdlcEngine: SDLCEngine;
}

export function registerSDLCRoutes(app: FastifyInstance, options: SDLCRouteOptions): void {
  // Create New SDLC Initiative
  app.post('/api/v1/sdlc/initiatives', async (req, reply) => {
    const parseResult = CreateSDLCInitiativeInputSchema.safeParse(req.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: 'Invalid SDLC initiative input',
        details: parseResult.error.errors
      });
    }

    const { title, intent } = parseResult.data;
    try {
      const initiative = await options.sdlcRepo.create({ title, intent });

      // The first phase is enqueued as a normal task, so the work runs in the worker with
      // a budget reservation, a run lease and an audit trail. This is awaited rather than
      // fire-and-forget: if enqueueing fails the caller must hear about it instead of
      // receiving a 201 for an initiative that will never start.
      const query = req.query as { autoAdvance?: string };
      const autoAdvance = query?.autoAdvance !== 'false';

      let current = initiative;
      if (autoAdvance) {
        current = await options.sdlcEngine.startPhase(initiative.id);
      }

      return reply.status(201).send({
        data: current,
        message: autoAdvance
          ? `SDLC initiative initiated; phase '${current.currentPhase}' enqueued`
          : 'SDLC initiative created; no phase enqueued'
      });
    } catch (err) {
      rootLogger.error('Failed to create SDLC initiative', { error: String(err) });
      return reply.status(500).send({ error: 'Failed to create SDLC initiative' });
    }
  });

  // List SDLC Initiatives
  app.get('/api/v1/sdlc/initiatives', async (req, reply) => {
    const query = req.query as { status?: string; limit?: string; offset?: string };
    const limit = query.limit ? parseInt(query.limit, 10) : 50;
    const offset = query.offset ? parseInt(query.offset, 10) : 0;

    try {
      const list = await options.sdlcRepo.list({
        status: query.status,
        limit,
        offset
      });

      return reply.send({
        data: list,
        count: list.length
      });
    } catch (err) {
      rootLogger.error('Failed to list SDLC initiatives', { error: String(err) });
      return reply.status(500).send({ error: 'Failed to list SDLC initiatives' });
    }
  });

  // Get SDLC Initiative Detail
  app.get('/api/v1/sdlc/initiatives/:id', async (req, reply) => {
    const params = req.params as { id: string };
    const idValidation = InitiativeIdSchema.safeParse(params.id);
    if (!idValidation.success) {
      return reply.status(400).send({ error: 'Invalid initiative UUID' });
    }

    try {
      const initiative = await options.sdlcRepo.findById(params.id);
      if (!initiative) {
        return reply.status(404).send({ error: 'SDLC initiative not found' });
      }

      return reply.send({ data: initiative });
    } catch (err) {
      rootLogger.error(`Failed to get SDLC initiative ${params.id}`, { error: String(err) });
      return reply.status(500).send({ error: 'Failed to get SDLC initiative' });
    }
  });

  /**
   * (Re)start the initiative's current phase.
   *
   * This enqueues the phase's task rather than executing the phase inline, so it is safe to
   * retry: if a phase task is already open, the compare-and-set inside startPhase rejects
   * the duplicate and the response reports the phase that is already running.
   */
  app.post('/api/v1/sdlc/initiatives/:id/advance', async (req, reply) => {
    const params = req.params as { id: string };
    const idValidation = InitiativeIdSchema.safeParse(params.id);
    if (!idValidation.success) {
      return reply.status(400).send({ error: 'Invalid initiative UUID' });
    }

    try {
      const initiative = await options.sdlcRepo.findById(params.id);
      if (!initiative) {
        return reply.status(404).send({ error: 'SDLC initiative not found' });
      }

      if (initiative.currentPhase === 'completed' || initiative.currentPhase === 'failed') {
        return reply.status(400).send({
          error: `Initiative is in terminal phase: ${initiative.currentPhase}`
        });
      }

      const updated = await options.sdlcEngine.startPhase(initiative.id);

      return reply.send({
        data: updated,
        message: `Phase '${updated.currentPhase}' is enqueued (task ${updated.phaseTaskId || 'none'})`
      });
    } catch (err) {
      rootLogger.error(`Failed to advance SDLC initiative ${params.id}`, { error: String(err) });
      return reply.status(500).send({ error: 'Failed to advance SDLC initiative' });
    }
  });
}
