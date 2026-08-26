import { z } from 'zod';

export const MemoryTypeSchema = z.enum(['working', 'conversation', 'episodic', 'semantic', 'entity', 'artifact', 'policy']);
export type MemoryType = z.infer<typeof MemoryTypeSchema>;

export const MemoryStatusSchema = z.enum(['proposed', 'verified', 'unverified', 'deprecated', 'archived']);
export type MemoryStatus = z.infer<typeof MemoryStatusSchema>;

export const MemoryItemSchema = z.object({
  id: z.string().uuid(),
  type: MemoryTypeSchema,
  status: MemoryStatusSchema.default('unverified'),
  content: z.string().min(1),
  scope: z.string().default('global'),
  author: z.string(),
  source: z.string().default('system'),
  confidence: z.number().min(0).max(1).default(1.0),
  taskId: z.string().uuid().nullable().default(null),
  artifactId: z.string().uuid().nullable().default(null),
  metadata: z.record(z.unknown()).default({}),
  expiresAt: z.date().or(z.string()).nullable().default(null),
  createdAt: z.date().or(z.string()),
  updatedAt: z.date().or(z.string())
});
export type MemoryItem = z.infer<typeof MemoryItemSchema>;

export const MemoryWriteProposalSchema = z.object({
  type: MemoryTypeSchema,
  content: z.string().min(1),
  scope: z.string().default('global'),
  source: z.string(),
  confidence: z.number().min(0).max(1).default(0.8),
  metadata: z.record(z.unknown()).default({})
});
export type MemoryWriteProposal = z.infer<typeof MemoryWriteProposalSchema>;
