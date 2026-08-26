import { MemoryTools as MemoryService } from '@atlas/memory';
import { MemoryTypeSchema } from '@atlas/shared';
import { z } from 'zod';
import { ToolDefinition } from '../types.js';

export function createMemoryTools(memoryTools: MemoryService): ToolDefinition[] {
  const search: ToolDefinition = {
    name: 'memory.search',
    description: 'Search verified and scoped ATLAS memory without exposing unauthorized scopes.',
    inputSchema: z.object({
      query: z.string().min(1),
      types: z.array(MemoryTypeSchema).optional(),
      limit: z.number().int().min(1).max(20).default(5)
    }),
    outputSchema: z.object({
      results: z.array(
        z.object({
          id: z.string(),
          content: z.string(),
          source: z.string(),
          confidence: z.number(),
          score: z.number()
        })
      )
    }),
    riskLevel: 'read',
    requiresApproval: false,
    timeoutMs: 5000,
    async execute(ctx, input) {
      return memoryTools.search({
        query: input.query,
        allowedScopes: ctx.grantedScopes || [],
        types: input.types,
        limit: input.limit
      });
    }
  };

  const get: ToolDefinition = {
    name: 'memory.get',
    description: 'Retrieve one memory item only when its scope is available to the calling agent.',
    inputSchema: z.object({ id: z.string().uuid() }),
    outputSchema: z.object({ item: z.unknown().nullable() }),
    riskLevel: 'read',
    requiresApproval: false,
    timeoutMs: 3000,
    async execute(ctx, input) {
      return memoryTools.get({ id: input.id, allowedScopes: ctx.grantedScopes || [] });
    }
  };

  const proposeWrite: ToolDefinition = {
    name: 'memory.propose_write',
    description: "Propose an unverified memory item within the calling agent's granted scopes.",
    inputSchema: z.object({
      type: MemoryTypeSchema,
      content: z.string().min(1),
      scope: z.string().default('global'),
      source: z.string().default('agent'),
      confidence: z.number().min(0).max(1).default(0.8),
      metadata: z.record(z.unknown()).default({})
    }),
    outputSchema: z.object({
      id: z.string().uuid(),
      status: z.string(),
      duplicate: z.boolean()
    }),
    riskLevel: 'low',
    requiresApproval: false,
    timeoutMs: 5000,
    async execute(ctx, input) {
      return memoryTools.proposeWrite({
        ...input,
        author: ctx.agentId,
        taskId: ctx.taskId,
        allowedScopes: ctx.grantedScopes || []
      });
    }
  };

  return [search, get, proposeWrite];
}
