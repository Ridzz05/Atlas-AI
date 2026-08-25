import { MemoryItem, MemoryType, MemoryStatus } from '@atlas/shared';

export interface MemoryQuery {
  query: string;
  scope?: string;
  allowedScopes?: string[];
  types?: MemoryType[];
  status?: MemoryStatus;
  limit?: number;
  minConfidence?: number;
  tokenBudget?: number;
}

export interface RankedMemoryResult {
  item: MemoryItem;
  score: number;
  relevanceScore: number;
  confidenceScore: number;
  freshnessScore: number;
}

export interface ProposeMemoryInput {
  type: MemoryType;
  content: string;
  author: string;
  scope?: string;
  source?: string;
  confidence?: number;
  taskId?: string;
  artifactId?: string;
  metadata?: Record<string, unknown>;
  expiresAt?: string;
}
