import { z } from 'zod';

export const RunStatusSchema = z.enum([
  'created',
  'active',
  'waiting_tool',
  'waiting_child',
  'waiting_approval',
  'completed',
  'failed',
  'cancelled',
  'timed_out'
]);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const AgentRunRequestSchema = z.object({
  runId: z.string().uuid(),
  taskId: z.string().uuid(),
  agentId: z.string(),
  prompt: z.string().min(1),
  context: z.record(z.unknown()).default({}),
  maxTurns: z.number().int().positive().default(10),
  timeoutSeconds: z.number().int().positive().default(180),
  maxCostUsd: z.number().positive().default(1.0)
});
export type AgentRunRequest = z.infer<typeof AgentRunRequestSchema>;

export const CostEstimateSchema = z.object({
  promptTokens: z.number().int().nonnegative(),
  completionTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  estimatedCostUsd: z.number().nonnegative()
});
export type CostEstimate = z.infer<typeof CostEstimateSchema>;

export const RunSchema = z.object({
  id: z.string().uuid(),
  taskId: z.string().uuid(),
  agentId: z.string(),
  status: RunStatusSchema.default('created'),
  cancelRequested: z.boolean().default(false),
  cancelReason: z.string().nullable().default(null),
  inputTokens: z.number().int().nonnegative().default(0),
  outputTokens: z.number().int().nonnegative().default(0),
  costUsd: z.number().nonnegative().default(0),
  turnsCount: z.number().int().nonnegative().default(0),
  startedAt: z.date().or(z.string()).nullable().default(null),
  endedAt: z.date().or(z.string()).nullable().default(null),
  error: z.string().nullable().default(null),
  createdAt: z.date().or(z.string()),
  updatedAt: z.date().or(z.string())
});
export type Run = z.infer<typeof RunSchema>;
