import { FastifyInstance } from 'fastify';
import { ArtifactRepository, AuditRepository, BudgetRepository, MessageRepository, RunRepository, ToolCallRepository } from '@atlas/database';
import type { MemoryStore } from '@atlas/memory';
import { MemoryStatusSchema, MemoryTypeSchema } from '@atlas/shared';

export interface MetadataRouteOptions {
  artifactRepo?: ArtifactRepository;
  auditRepo?: AuditRepository;
  messageRepo?: MessageRepository;
  toolCallRepo?: ToolCallRepository;
  memoryStore?: MemoryStore;
  runRepo?: RunRepository;
  budgetRepo?: BudgetRepository;
}

function parseLimit(value: string | undefined, label: string): number | { error: string } {
  const limit = value ? Number(value) : 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return { error: `${label} limit must be an integer from 1 to 100.` };
  }
  return limit;
}

export function registerMetadataRoutes(app: FastifyInstance, options: MetadataRouteOptions): void {
  app.get('/api/v1/costs', async (_req, reply) => {
    const getCostSummary = options.runRepo && typeof (options.runRepo as any).getCostSummary === 'function'
      ? () => (options.runRepo as RunRepository).getCostSummary()
      : async () => null;
    const getBudgetSummary = options.budgetRepo && typeof (options.budgetRepo as any).getGlobalDailySummary === 'function'
      ? () => (options.budgetRepo as BudgetRepository).getGlobalDailySummary()
      : async () => null;

    try {
      const [costs, budget] = await Promise.all([getCostSummary(), getBudgetSummary()]);
      return reply.status(200).send({
        data: { costs, budget },
        durable: Boolean(options.runRepo || options.budgetRepo)
      });
    } catch {
      return reply.status(503).send({ error: 'Cost and budget metrics are unavailable.' });
    }
  });

  app.get('/api/v1/artifacts', async (req, reply) => {
    const query = req.query as { taskId?: string; limit?: string };
    const limit = parseLimit(query.limit, 'Artifact');
    if (typeof limit !== 'number') return reply.status(400).send(limit);
    if (!options.artifactRepo) return reply.status(200).send({ data: [], count: 0, durable: false });

    const records = await options.artifactRepo.list({ taskId: query.taskId, limit });
    const data = records.map(({ filePath: _filePath, ...record }) => record);
    return reply.status(200).send({ data, count: data.length, durable: true });
  });

  app.get('/api/v1/audit', async (req, reply) => {
    const query = req.query as {
      actor?: string;
      action?: string;
      taskId?: string;
      runId?: string;
      limit?: string;
    };
    const limit = parseLimit(query.limit, 'Audit');
    if (typeof limit !== 'number') return reply.status(400).send(limit);
    if (!options.auditRepo) return reply.status(200).send({ data: [], count: 0, durable: false });

    const data = await options.auditRepo.list({
      actor: query.actor,
      action: query.action,
      taskId: query.taskId,
      runId: query.runId,
      limit
    });
    return reply.status(200).send({ data, count: data.length, durable: true });
  });

  app.get('/api/v1/messages', async (req, reply) => {
    const query = req.query as { taskId?: string; runId?: string; limit?: string };
    const limit = parseLimit(query.limit, 'Message');
    if (typeof limit !== 'number') return reply.status(400).send(limit);
    if (!options.messageRepo) return reply.status(200).send({ data: [], count: 0, durable: false });

    const data = await options.messageRepo.list({
      taskId: query.taskId,
      runId: query.runId,
      limit
    });
    return reply.status(200).send({ data, count: data.length, durable: true });
  });

  app.get('/api/v1/tool-calls', async (req, reply) => {
    const query = req.query as { taskId?: string; runId?: string; limit?: string };
    const limit = parseLimit(query.limit, 'Tool call');
    if (typeof limit !== 'number') return reply.status(400).send(limit);
    if (!options.toolCallRepo) return reply.status(200).send({ data: [], count: 0, durable: false });

    const data = await options.toolCallRepo.list({
      taskId: query.taskId,
      runId: query.runId,
      limit
    });
    return reply.status(200).send({ data, count: data.length, durable: true });
  });

  app.get('/api/v1/memory', async (req, reply) => {
    const query = req.query as { scope?: string; type?: string; status?: string; limit?: string };
    const limit = parseLimit(query.limit, 'Memory');
    if (typeof limit !== 'number') return reply.status(400).send(limit);
    const type = query.type ? MemoryTypeSchema.safeParse(query.type) : null;
    const status = query.status ? MemoryStatusSchema.safeParse(query.status) : null;
    if (query.type && !type?.success) return reply.status(400).send({ error: 'Invalid memory type.' });
    if (query.status && !status?.success) return reply.status(400).send({ error: 'Invalid memory status.' });
    if (!options.memoryStore) return reply.status(200).send({ data: [], count: 0, durable: false });

    const data = await options.memoryStore.search({
      scopes: query.scope ? [query.scope] : undefined,
      types: type?.success ? [type.data] : undefined,
      status: status?.success ? status.data : undefined,
      limit
    });
    return reply.status(200).send({ data, count: data.length, durable: true });
  });

  app.get('/api/v1/memory/:id', async (req, reply) => {
    if (!options.memoryStore) return reply.status(200).send({ item: null, durable: false });
    const { id } = req.params as { id: string };
    if (!/^[0-9a-f-]{36}$/i.test(id)) return reply.status(400).send({ error: 'Memory id must be a UUID.' });
    const item = await options.memoryStore.findById(id);
    if (!item) return reply.status(404).send({ error: 'Memory item not found.' });
    return reply.status(200).send({ item, durable: true });
  });
}
