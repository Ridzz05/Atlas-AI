import { FastifyInstance } from 'fastify';
import { SecondBrainService } from '@atlas/memory';
import { z } from 'zod';

const IngestBodySchema = z.object({
  title: z.string().optional(),
  filePath: z.string().optional(),
  content: z.string().optional(),
  vaultPath: z.string().optional(),
  scope: z.string().optional()
});

const QueryBodySchema = z.object({
  query: z.string().min(1),
  scope: z.string().optional(),
  limit: z.number().int().min(1).max(20).optional()
});

export interface SecondBrainRouteOptions {
  secondBrainService: SecondBrainService;
}

export function registerSecondBrainRoutes(app: FastifyInstance, options: SecondBrainRouteOptions): void {
  const service = options.secondBrainService;

  // 1. Stats
  app.get('/api/v1/brain/stats', async (_req, reply) => {
    try {
      const stats = service.getStats();
      return reply.status(200).send({ data: stats, durable: true });
    } catch (err) {
      return reply.status(500).send({ error: 'Failed to retrieve second brain statistics.' });
    }
  });

  // 2. List Notes
  app.get('/api/v1/brain/notes', async (req, reply) => {
    const query = req.query as { scope?: string; tag?: string; limit?: string };
    const limit = query.limit ? Math.min(100, Math.max(1, parseInt(query.limit, 10))) : 50;

    const notes = service.listDocuments({
      scope: query.scope,
      tag: query.tag,
      limit
    });

    return reply.status(200).send({
      data: notes,
      count: notes.length,
      durable: true
    });
  });

  // 3. Get Note by ID
  app.get('/api/v1/brain/notes/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const note = service.getDocument(id);

    if (!note) {
      return reply.status(404).send({ error: `Note with id '${id}' not found.` });
    }

    return reply.status(200).send({ data: note, durable: true });
  });

  // 4. Delete Note by ID
  app.delete('/api/v1/brain/notes/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const deleted = service.deleteDocument(id);

    if (!deleted) {
      return reply.status(404).send({ error: `Note with id '${id}' not found.` });
    }

    return reply.status(200).send({ success: true, id });
  });

  // 5. Ingest Document or Vault
  app.post('/api/v1/brain/ingest', async (req, reply) => {
    const parse = IngestBodySchema.safeParse(req.body);
    if (!parse.success) {
      return reply.status(400).send({ error: 'Invalid ingest payload', details: parse.error.format() });
    }

    const { title, filePath, content, vaultPath, scope } = parse.data;

    if (vaultPath) {
      try {
        const result = await service.ingestVaultDirectory(vaultPath, { scope });
        return reply.status(200).send({
          type: 'vault_sync',
          status: 'success',
          ...result
        });
      } catch (err) {
        return reply.status(500).send({
          error: `Vault sync failed: ${err instanceof Error ? err.message : String(err)}`
        });
      }
    }

    if (!content) {
      return reply.status(400).send({ error: "Either 'content' or 'vaultPath' must be provided." });
    }

    try {
      const doc = await service.ingestDocument({
        title,
        filePath: filePath || `note-${Date.now()}.md`,
        content,
        scope
      });

      return reply.status(201).send({
        type: 'document_ingest',
        status: 'success',
        data: doc
      });
    } catch (err) {
      return reply.status(500).send({
        error: `Document ingestion failed: ${err instanceof Error ? err.message : String(err)}`
      });
    }
  });

  // 6. Search Notes (Semantic & Keyword Vector Search)
  app.get('/api/v1/brain/search', async (req, reply) => {
    const query = req.query as { q?: string; query?: string; scope?: string; tag?: string; limit?: string };
    const searchQuery = query.q || query.query;

    if (!searchQuery || !searchQuery.trim()) {
      return reply.status(400).send({ error: "Search query parameter 'q' or 'query' is required." });
    }

    const limit = query.limit ? Math.min(50, Math.max(1, parseInt(query.limit, 10))) : 5;

    const results = await service.search({
      query: searchQuery,
      scope: query.scope,
      tag: query.tag,
      limit
    });

    return reply.status(200).send({
      data: results,
      count: results.length,
      query: searchQuery
    });
  });

  // 7. Grounded RAG Query (Chat with your Notes)
  app.post('/api/v1/brain/query', async (req, reply) => {
    const parse = QueryBodySchema.safeParse(req.body);
    if (!parse.success) {
      return reply.status(400).send({ error: 'Invalid query payload', details: parse.error.format() });
    }

    const { query, scope, limit } = parse.data;

    try {
      const response = await service.queryGrounded(query, {
        scope,
        limit: limit || 4
      });

      return reply.status(200).send({
        data: response
      });
    } catch (err) {
      return reply.status(500).send({
        error: `Second brain grounded query failed: ${err instanceof Error ? err.message : String(err)}`
      });
    }
  });
}
