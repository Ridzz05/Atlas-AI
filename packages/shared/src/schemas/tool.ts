import { z } from 'zod';

export const ToolRiskLevelSchema = z.enum(['read', 'low', 'medium', 'high', 'critical']);
export type ToolRiskLevel = z.infer<typeof ToolRiskLevelSchema>;

export const ToolCallSchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  taskId: z.string().uuid(),
  agentId: z.string(),
  toolName: z.string(),
  input: z.record(z.unknown()),
  output: z.record(z.unknown()).nullable().default(null),
  error: z.string().nullable().default(null),
  durationMs: z.number().int().nonnegative().nullable().default(null),
  riskLevel: ToolRiskLevelSchema.default('read'),
  requiresApproval: z.boolean().default(false),
  approvalId: z.string().uuid().nullable().default(null),
  status: z.enum(['pending', 'running', 'success', 'failed', 'blocked_approval']).default('pending'),
  createdAt: z.date().or(z.string())
});
export type ToolCall = z.infer<typeof ToolCallSchema>;

export const ToolExecutionResultSchema = z.object({
  toolCallId: z.string().uuid(),
  success: z.boolean(),
  output: z.unknown().optional(),
  error: z.string().optional(),
  durationMs: z.number().int().nonnegative()
});
export type ToolExecutionResult = z.infer<typeof ToolExecutionResultSchema>;
