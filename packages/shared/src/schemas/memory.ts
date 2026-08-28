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

export const SecondBrainDocumentSchema = z.object({
  id: z.string(),
  title: z.string(),
  filePath: z.string(),
  content: z.string(),
  frontmatter: z.record(z.unknown()).default({}),
  tags: z.array(z.string()).default([]),
  links: z.array(z.string()).default([]),
  scope: z.string().default('second_brain'),
  contentHash: z.string(),
  chunksCount: z.number().int().default(0),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type SecondBrainDocument = z.infer<typeof SecondBrainDocumentSchema>;

export const SecondBrainChunkSchema = z.object({
  id: z.string(),
  documentId: z.string(),
  documentTitle: z.string(),
  filePath: z.string(),
  chunkIndex: z.number().int(),
  sectionHeading: z.string().nullable().default(null),
  content: z.string(),
  tokensCount: z.number().int().default(0),
  embedding: z.array(z.number()).optional(),
  tags: z.array(z.string()).default([]),
  scope: z.string().default('second_brain'),
  createdAt: z.string()
});
export type SecondBrainChunk = z.infer<typeof SecondBrainChunkSchema>;

export const SecondBrainCitationSchema = z.object({
  documentId: z.string(),
  noteTitle: z.string(),
  filePath: z.string(),
  sectionHeading: z.string().nullable().default(null),
  chunkIndex: z.number().int(),
  relevanceScore: z.number(),
  excerpt: z.string()
});
export type SecondBrainCitation = z.infer<typeof SecondBrainCitationSchema>;

export const SecondBrainSearchResultSchema = z.object({
  chunk: SecondBrainChunkSchema,
  score: z.number(),
  relevanceScore: z.number(),
  vectorScore: z.number(),
  citation: SecondBrainCitationSchema
});
export type SecondBrainSearchResult = z.infer<typeof SecondBrainSearchResultSchema>;

export const SecondBrainStatsSchema = z.object({
  totalDocuments: z.number().int(),
  totalChunks: z.number().int(),
  totalEmbeddings: z.number().int(),
  embeddingProvider: z.string(),
  embeddingModel: z.string(),
  vectorDimension: z.number().int(),
  lastSyncAt: z.string().nullable()
});
export type SecondBrainStats = z.infer<typeof SecondBrainStatsSchema>;

