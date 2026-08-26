import { MemoryItem, MemoryType, MemoryStatus } from '@atlas/shared';
import type { AuditRecord } from '@atlas/observability';

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

export interface MemoryAuditSink {
  record(event: AuditRecord): Promise<unknown>;
}

export interface MemoryMaintenanceOptions {
  now?: Date;
  deletionGraceDays?: number;
  batchSize?: number;
}

export interface MemoryMaintenanceResult {
  inspected: number;
  deprecated: number;
  deleted: number;
}
