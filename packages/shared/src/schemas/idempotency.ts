import { createHash } from 'node:crypto';
import { z } from 'zod';

export const IdempotencyOutcomeSchema = z.enum(['in_flight', 'succeeded', 'failed', 'expired']);
export type IdempotencyOutcome = z.infer<typeof IdempotencyOutcomeSchema>;

export const IdempotencyKeySchema = z.object({
  key: z.string().min(1),
  taskId: z.string().uuid(),
  runId: z.string().uuid().optional(),
  actionName: z.string().min(1),
  payloadHash: z.string().min(1),
  createdAt: z.date().or(z.string())
});
export type IdempotencyKey = z.infer<typeof IdempotencyKeySchema>;

export const IdempotencyRecordSchema = IdempotencyKeySchema.extend({
  outcome: IdempotencyOutcomeSchema,
  provider: z.string().nullable().default(null),
  remoteId: z.string().nullable().default(null),
  result: z.record(z.unknown()).nullable().default(null),
  error: z.string().nullable().default(null),
  expiresAt: z.date().or(z.string()).nullable().default(null)
});
export type IdempotencyRecord = z.infer<typeof IdempotencyRecordSchema>;

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(item => stableStringify(item)).join(',') + ']';
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return '{' + entries.map(([k, v]) => JSON.stringify(k) + ':' + stableStringify(v)).join(',') + '}';
}

export function computeIdempotencyKey(input: { taskId: string; runId?: string; actionName: string; payload: unknown }): string {
  const hash = createHash('sha256').update(stableStringify(input.payload)).digest('hex');
  return `${input.taskId}:${input.runId ?? 'norun'}:${input.actionName}:${hash}`;
}
