import { z } from 'zod';

export const ApprovalStatusSchema = z.enum([
  'pending',
  'approved',
  'rejected',
  'revision_requested',
  'expired',
  'executed',
  'revoked'
]);
export type ApprovalStatus = z.infer<typeof ApprovalStatusSchema>;

export const ApprovalRiskLevelSchema = z.enum([
  'read',
  'low',
  'medium',
  'high',
  'critical'
]);
export type ApprovalRiskLevel = z.infer<typeof ApprovalRiskLevelSchema>;

export const ApprovalRequestSchema = z.object({
  id: z.string().uuid(),
  taskId: z.string().uuid(),
  runId: z.string().uuid(),
  agentId: z.string(),
  action: z.string(),
  target: z.string(),
  payload: z.record(z.unknown()),
  payloadHash: z.string(),
  reason: z.string(),
  riskLevel: ApprovalRiskLevelSchema,
  status: ApprovalStatusSchema.default('pending'),
  requestedAt: z.date().or(z.string()),
  expiresAt: z.date().or(z.string()),
  decidedAt: z.date().or(z.string()).nullable().default(null),
  decidedBy: z.string().nullable().default(null),
  decisionNote: z.string().nullable().default(null)
});
export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>;

export const ApprovalTokenSchema = z.object({
  requestId: z.string().uuid(),
  action: z.string(),
  payloadHash: z.string(),
  signature: z.string(),
  expiresAt: z.number().int()
});
export type ApprovalToken = z.infer<typeof ApprovalTokenSchema>;
