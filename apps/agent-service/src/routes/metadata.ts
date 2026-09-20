import { FastifyInstance, FastifyReply } from 'fastify';
import {
  ArtifactRepository,
  AuditRepository,
  BudgetRepository,
  MessageRepository,
  RunRepository,
  ToolCallRepository
} from '@atlas/database';
import type { MemoryStore } from '@atlas/memory';
import { MemoryProposalService } from '@atlas/memory';
import { MemoryStatusSchema, MemoryTypeSchema } from '@atlas/shared';
import { z } from 'zod';

const MemoryIdSchema = z.string().uuid();

export interface MetadataRouteOptions {
  artifactRepo?: ArtifactRepository;
  auditRepo?: AuditRepository;
  messageRepo?: MessageRepository;
  toolCallRepo?: ToolCallRepository;
  memoryStore?: MemoryStore;
  runRepo?: RunRepository;
  budgetRepo?: BudgetRepository;
}

/**
 * The window direction for a list read: `oldest` (a thread, from its beginning) or `newest` (a feed).
 *
 * Absent means oldest, matching the repository default. Anything else is rejected rather than ignored,
 * because a caller that asks for an order it does not get has no way to tell.
 */
function parseOrder(value?: string): 'oldest' | 'newest' | { error: string } {
  if (value === undefined || value === '') return 'oldest';
  if (value === 'oldest' || value === 'newest') return value;
  return { error: `Invalid order '${value}'. Expected 'oldest' or 'newest'.` };
}

function parseLimit(value: string | undefined, label: string): number | { error: string } {
  const limit = value ? Number(value) : 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return { error: `${label} limit must be an integer from 1 to 100.` };
  }
  return limit;
}

function parseOptionalUuid(value: unknown, label: string): string | undefined | { error: string } {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !z.string().uuid().safeParse(value).success) {
    return { error: `${label} must be a UUID.` };
  }
  return value;
}

function isValidationError(value: unknown): value is { error: string } {
  return typeof value === 'object' && value !== null && 'error' in value;
}

export function registerMetadataRoutes(app: FastifyInstance, options: MetadataRouteOptions): void {
  app.get('/api/v1/costs', async (_req, reply) => {
    const getCostSummary =
      options.runRepo && typeof (options.runRepo as any).getCostSummary === 'function'
        ? () => (options.runRepo as RunRepository).getCostSummary()
        : async () => null;
    const getBudgetSummary =
      options.budgetRepo && typeof (options.budgetRepo as any).getGlobalDailySummary === 'function'
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

  app.get('/api/v1/recovery', async (_req, reply) => {
    if (!options.runRepo || typeof (options.runRepo as any).getLeaseSummary !== 'function') {
      return reply.status(200).send({ data: null, durable: false });
    }

    try {
      const data = await (options.runRepo as RunRepository).getLeaseSummary();
      return reply.status(200).send({ data, durable: true });
    } catch {
      return reply.status(503).send({ error: 'Recovery metrics are unavailable.' });
    }
  });

  app.get('/api/v1/artifacts', async (req, reply) => {
    const query = req.query as { taskId?: string; limit?: string };
    const limit = parseLimit(query.limit, 'Artifact');
    if (typeof limit !== 'number') return reply.status(400).send(limit);
    const taskId = parseOptionalUuid(query.taskId, 'taskId');
    if (isValidationError(taskId)) return reply.status(400).send(taskId);
    if (!options.artifactRepo) return reply.status(200).send({ data: [], count: 0, durable: false });

    const records = await options.artifactRepo.list({ taskId, limit });
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
    const taskId = parseOptionalUuid(query.taskId, 'taskId');
    if (isValidationError(taskId)) return reply.status(400).send(taskId);
    const runId = parseOptionalUuid(query.runId, 'runId');
    if (isValidationError(runId)) return reply.status(400).send(runId);
    if (!options.auditRepo) return reply.status(200).send({ data: [], count: 0, durable: false });

    const data = await options.auditRepo.list({
      actor: query.actor,
      action: query.action,
      taskId,
      runId,
      limit
    });
    return reply.status(200).send({ data, count: data.length, durable: true });
  });

  app.get('/api/v1/messages', async (req, reply) => {
    const query = req.query as { taskId?: string; runId?: string; limit?: string; order?: string };
    const limit = parseLimit(query.limit, 'Message');
    if (typeof limit !== 'number') return reply.status(400).send(limit);
    const order = parseOrder(query.order);
    if (isValidationError(order)) return reply.status(400).send(order);
    const taskId = parseOptionalUuid(query.taskId, 'taskId');
    if (isValidationError(taskId)) return reply.status(400).send(taskId);
    const runId = parseOptionalUuid(query.runId, 'runId');
    if (isValidationError(runId)) return reply.status(400).send(runId);
    if (!options.messageRepo) return reply.status(200).send({ data: [], count: 0, durable: false });

    const data = await options.messageRepo.list({
      taskId,
      runId,
      limit,
      order
    });
    return reply.status(200).send({ data, count: data.length, durable: true });
  });

  app.get('/api/v1/tool-calls', async (req, reply) => {
    const query = req.query as { taskId?: string; runId?: string; limit?: string; order?: string };
    const limit = parseLimit(query.limit, 'Tool call');
    if (typeof limit !== 'number') return reply.status(400).send(limit);
    const order = parseOrder(query.order);
    if (isValidationError(order)) return reply.status(400).send(order);
    const taskId = parseOptionalUuid(query.taskId, 'taskId');
    if (isValidationError(taskId)) return reply.status(400).send(taskId);
    const runId = parseOptionalUuid(query.runId, 'runId');
    if (isValidationError(runId)) return reply.status(400).send(runId);
    if (!options.toolCallRepo) return reply.status(200).send({ data: [], count: 0, durable: false });

    const data = await options.toolCallRepo.list({
      taskId,
      runId,
      limit,
      order
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
    if (!MemoryIdSchema.safeParse(id).success) return reply.status(400).send({ error: 'Memory id must be a UUID.' });
    const item = await options.memoryStore.findById(id);
    if (!item) return reply.status(404).send({ error: 'Memory item not found.' });
    return reply.status(200).send({ item, durable: true });
  });

  /**
   * The memory loop's missing step.
   *
   * Agents write through `memory.propose_write`, which always creates an item as `unverified`, and
   * their reads are verified-only — a rule enforced on every agent-facing route. `verify()` and
   * `deprecate()` implement the promotion and audit it, but nothing reachable called either one, so
   * every proposal stayed `unverified` forever and every agent read returned nothing. The only way to
   * change a status was to edit the database by hand, bypassing the audit trail these methods exist
   * to write.
   *
   * These are operator routes, and the operator is the bearer of `API_AUTH_TOKEN` — the same
   * principal that decides approvals and can pause or stop the system. Promotion is that kind of act.
   */
  const memoryGovernanceService = (): MemoryProposalService | null =>
    options.memoryStore
      ? new MemoryProposalService(
          options.memoryStore,
          options.auditRepo ? { record: event => options.auditRepo!.create(event) } : undefined
        )
      : null;

  const applyMemoryStatus = async (req: { params: { id: string } }, reply: FastifyReply, action: 'verify' | 'deprecate') => {
    const service = memoryGovernanceService();
    if (!service) return reply.status(503).send({ error: 'Memory governance is unavailable: no memory store is configured.' });

    const { id } = req.params;
    if (!MemoryIdSchema.safeParse(id).success) return reply.status(400).send({ error: 'Memory id must be a UUID.' });

    const item = action === 'verify' ? await service.verify(id) : await service.deprecate(id);
    // The service refuses an item it cannot read back, which covers both an unknown id and an expired
    // one — every read path in this system treats an expired item as gone, so the message says so
    // rather than implying the id was wrong.
    if (!item) return reply.status(404).send({ error: 'Memory item not found or already expired.' });
    return reply.status(200).send({ item, durable: true });
  };

  // The route generic types `req.params.id`, so the shared handler takes a plain params shape.
  app.post<{ Params: { id: string } }>('/api/v1/memory/:id/verify', async (req, reply) => applyMemoryStatus(req, reply, 'verify'));
  app.post<{ Params: { id: string } }>('/api/v1/memory/:id/deprecate', async (req, reply) => applyMemoryStatus(req, reply, 'deprecate'));
}
