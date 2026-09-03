import { SecondBrainService } from '@atlas/memory';
import { z } from 'zod';
import { ToolDefinition } from '../types.js';

export function createSecondBrainTools(secondBrainService: SecondBrainService): ToolDefinition[] {
  const search: ToolDefinition = {
    name: 'second_brain.search',
    description:
      'Search through personal knowledge notes and markdown documents in the Second Brain with vector similarity and citation tracing.',
    inputSchema: z.object({
      query: z.string().min(1),
      scope: z.string().optional(),
      tag: z.string().optional(),
      limit: z.number().int().min(1).max(20).default(5)
    }),
    outputSchema: z.object({
      results: z.array(
        z.object({
          id: z.string(),
          documentTitle: z.string(),
          filePath: z.string(),
          sectionHeading: z.string().nullable(),
          score: z.number(),
          content: z.string(),
          citation: z.object({
            noteTitle: z.string(),
            filePath: z.string(),
            sectionHeading: z.string().nullable(),
            relevanceScore: z.number(),
            excerpt: z.string()
          })
        })
      )
    }),
    riskLevel: 'read',
    requiresApproval: false,
    timeoutMs: 5000,
    async execute(_ctx, input) {
      const hits = await secondBrainService.search({
        query: input.query,
        scope: input.scope,
        tag: input.tag,
        limit: input.limit
      });

      return {
        results: hits.map(h => ({
          id: h.chunk.id,
          documentTitle: h.chunk.documentTitle,
          filePath: h.chunk.filePath,
          sectionHeading: h.chunk.sectionHeading,
          score: h.score,
          content: h.chunk.content,
          citation: {
            noteTitle: h.citation.noteTitle,
            filePath: h.citation.filePath,
            sectionHeading: h.citation.sectionHeading,
            relevanceScore: h.citation.relevanceScore,
            excerpt: h.citation.excerpt
          }
        }))
      };
    }
  };

  const readNote: ToolDefinition = {
    name: 'second_brain.read_note',
    description: 'Read the full content, metadata, tags, and linked notes of a specific note in the Second Brain.',
    inputSchema: z.object({
      id: z.string().optional(),
      filePath: z.string().optional(),
      title: z.string().optional()
    }),
    outputSchema: z.object({
      note: z
        .object({
          id: z.string(),
          title: z.string(),
          filePath: z.string(),
          content: z.string(),
          tags: z.array(z.string()),
          links: z.array(z.string()),
          frontmatter: z.record(z.unknown()),
          chunksCount: z.number(),
          updatedAt: z.string()
        })
        .nullable()
    }),
    riskLevel: 'read',
    requiresApproval: false,
    timeoutMs: 3000,
    async execute(_ctx, input) {
      let doc = null;
      if (input.id) {
        doc = secondBrainService.getDocument(input.id);
      } else if (input.filePath) {
        doc = secondBrainService.getDocumentByPath(input.filePath);
      } else if (input.title) {
        doc = secondBrainService.getDocumentByPath(input.title);
      }

      if (!doc) {
        return { note: null };
      }

      return {
        note: {
          id: doc.id,
          title: doc.title,
          filePath: doc.filePath,
          content: doc.content,
          tags: doc.tags,
          links: doc.links,
          frontmatter: doc.frontmatter,
          chunksCount: doc.chunksCount,
          updatedAt: doc.updatedAt
        }
      };
    }
  };

  const listNotes: ToolDefinition = {
    name: 'second_brain.list_notes',
    description: 'List indexed notes, categories, tags, and chunk stats in the Second Brain vault.',
    inputSchema: z.object({
      scope: z.string().optional(),
      tag: z.string().optional(),
      limit: z.number().int().min(1).max(100).default(25)
    }),
    outputSchema: z.object({
      notes: z.array(
        z.object({
          id: z.string(),
          title: z.string(),
          filePath: z.string(),
          tags: z.array(z.string()),
          links: z.array(z.string()),
          chunksCount: z.number(),
          updatedAt: z.string()
        })
      ),
      totalCount: z.number()
    }),
    riskLevel: 'read',
    requiresApproval: false,
    timeoutMs: 3000,
    async execute(_ctx, input) {
      const docs = secondBrainService.listDocuments({
        scope: input.scope,
        tag: input.tag,
        limit: input.limit
      });

      return {
        notes: docs.map(d => ({
          id: d.id,
          title: d.title,
          filePath: d.filePath,
          tags: d.tags,
          links: d.links,
          chunksCount: d.chunksCount,
          updatedAt: d.updatedAt
        })),
        totalCount: docs.length
      };
    }
  };

  const queryRAG: ToolDefinition = {
    name: 'second_brain.query',
    description: 'Ask a question to the Second Brain knowledge base and get a grounded answer with traceable note citations.',
    inputSchema: z.object({
      query: z.string().min(1),
      scope: z.string().optional(),
      limit: z.number().int().min(1).max(10).default(4)
    }),
    outputSchema: z.object({
      answer: z.string(),
      citations: z.array(
        z.object({
          noteTitle: z.string(),
          filePath: z.string(),
          sectionHeading: z.string().nullable(),
          relevanceScore: z.number(),
          excerpt: z.string()
        })
      ),
      sources: z.array(
        z.object({
          title: z.string(),
          filePath: z.string(),
          sectionHeading: z.string().nullable(),
          score: z.number()
        })
      )
    }),
    riskLevel: 'read',
    requiresApproval: false,
    timeoutMs: 8000,
    async execute(_ctx, input) {
      const result = await secondBrainService.queryGrounded(input.query, {
        scope: input.scope,
        limit: input.limit
      });

      return {
        answer: result.answer,
        citations: result.citations,
        sources: result.sources
      };
    }
  };

  const syncVault: ToolDefinition = {
    name: 'second_brain.sync_vault',
    description: 'Sync and index a directory of markdown notes into the Second Brain.',
    inputSchema: z.object({
      vaultPath: z.string().min(1),
      scope: z.string().default('second_brain')
    }),
    outputSchema: z.object({
      status: z.string(),
      totalFiles: z.number(),
      ingested: z.number(),
      skipped: z.number(),
      errorsCount: z.number()
    }),
    riskLevel: 'low',
    requiresApproval: false,
    timeoutMs: 15000,
    async execute(_ctx, input) {
      const result = await secondBrainService.ingestVaultDirectory(input.vaultPath, {
        scope: input.scope
      });

      return {
        status: result.errors.length === 0 ? 'success' : 'completed_with_errors',
        totalFiles: result.totalFiles,
        ingested: result.ingested,
        skipped: result.skipped,
        errorsCount: result.errors.length
      };
    }
  };

  return [search, readNote, listNotes, queryRAG, syncVault];
}
