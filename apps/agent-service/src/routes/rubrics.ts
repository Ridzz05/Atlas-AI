import { FastifyInstance } from 'fastify';
import { LeadRubricRepository } from '@atlas/database';
import {
  LeadRubricDefinitionSchema,
  RubricEngine
} from '@atlas/tools';
import { z } from 'zod';

const CreateRubricSchema = z.object({
  definition: LeadRubricDefinitionSchema,
  activate: z.boolean().default(false)
}).strict();

const RubricVersionSchema = z.string().trim().min(1).max(128);

async function hydrateActiveRubric(repository: LeadRubricRepository) {
  const [rubrics, active] = await Promise.all([
    repository.list(),
    repository.getActive()
  ]);
  if (!active) {
    throw new Error('No active lead rubric is configured.');
  }

  RubricEngine.hydrate(
    rubrics.map(record => LeadRubricDefinitionSchema.parse(record.definition)),
    active.version
  );
  return active;
}

export interface RubricRouteOptions {
  rubricRepo?: LeadRubricRepository;
}

export function registerRubricRoutes(app: FastifyInstance, options: RubricRouteOptions): void {
  app.get('/api/v1/rubrics', async (_req, reply) => {
    if (!options.rubricRepo) {
      return reply.status(503).send({ error: 'Lead rubric storage is unavailable.' });
    }

    try {
      const [data, active] = await Promise.all([
        options.rubricRepo.list(),
        options.rubricRepo.getActive()
      ]);
      if (!active) {
        return reply.status(503).send({ error: 'No active lead rubric is configured.' });
      }
      return reply.status(200).send({
        data,
        activeVersion: active.version,
        durable: true
      });
    } catch {
      return reply.status(503).send({ error: 'Lead rubric data is unavailable.' });
    }
  });

  app.post('/api/v1/rubrics', async (req, reply) => {
    if (!options.rubricRepo) {
      return reply.status(503).send({ error: 'Lead rubric storage is unavailable.' });
    }

    const parsed = CreateRubricSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Invalid lead rubric definition.',
        details: parsed.error.flatten()
      });
    }

    try {
      const created = await options.rubricRepo.create({
        version: parsed.data.definition.version,
        definition: parsed.data.definition,
        createdBy: 'owner-api',
        activate: parsed.data.activate
      });
      const active = await hydrateActiveRubric(options.rubricRepo);
      return reply.status(201).send({
        data: created,
        activeVersion: active.version,
        durable: true
      });
    } catch {
      return reply.status(503).send({ error: 'Lead rubric could not be persisted.' });
    }
  });

  app.post('/api/v1/rubrics/:version/activate', async (req, reply) => {
    if (!options.rubricRepo) {
      return reply.status(503).send({ error: 'Lead rubric storage is unavailable.' });
    }

    const { version: rawVersion } = req.params as { version?: string };
    const parsedVersion = RubricVersionSchema.safeParse(rawVersion);
    if (!parsedVersion.success) {
      return reply.status(400).send({ error: 'Rubric version must be 1 to 128 characters.' });
    }

    try {
      const activated = await options.rubricRepo.activate(parsedVersion.data);
      if (!activated) {
        return reply.status(404).send({ error: 'Lead rubric version not found.' });
      }
      const active = await hydrateActiveRubric(options.rubricRepo);
      return reply.status(200).send({
        data: activated,
        activeVersion: active.version,
        durable: true
      });
    } catch {
      return reply.status(503).send({ error: 'Lead rubric could not be activated.' });
    }
  });
}
