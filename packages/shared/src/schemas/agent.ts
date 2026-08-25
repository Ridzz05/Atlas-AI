import { z } from 'zod';

export const AgentRoleSchema = z.enum([
  'orchestrator',
  'researcher',
  'lead_scoring',
  'content_creator',
  'qa_verifier',
  'custom'
]);
export type AgentRole = z.infer<typeof AgentRoleSchema>;

export const ModelPolicySchema = z.object({
  preferredTier: z.enum(['fast', 'balanced', 'deep']).default('balanced'),
  fallbackTier: z.enum(['fast', 'balanced', 'deep']).default('fast'),
  temperature: z.number().min(0).max(2).default(0.2)
});
export type ModelPolicy = z.infer<typeof ModelPolicySchema>;

export const AgentLimitsSchema = z.object({
  maxTurns: z.number().int().min(1).max(30).default(10),
  maxDelegationDepth: z.number().int().min(0).max(2).default(1),
  timeoutSeconds: z.number().int().min(10).max(600).default(180),
  maxCostUsd: z.number().positive().default(0.5)
});
export type AgentLimits = z.infer<typeof AgentLimitsSchema>;

export const AgentPermissionsSchema = z.object({
  tools: z.array(z.string()).default([]),
  dataScopes: z.array(z.string()).default([]),
  externalWrites: z.boolean().default(false)
});
export type AgentPermissions = z.infer<typeof AgentPermissionsSchema>;

export const AgentReviewPolicySchema = z.object({
  requiredAgent: z.string().optional(),
  humanApprovalFor: z.array(z.string()).default([])
});
export type AgentReviewPolicy = z.infer<typeof AgentReviewPolicySchema>;

export const AgentDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  role: AgentRoleSchema,
  version: z.number().int().positive().default(1),
  description: z.string(),
  systemPrompt: z.string().min(1),
  modelPolicy: ModelPolicySchema.default({}),
  limits: AgentLimitsSchema.default({}),
  permissions: AgentPermissionsSchema.default({}),
  review: AgentReviewPolicySchema.default({})
});
export type AgentDefinition = z.infer<typeof AgentDefinitionSchema>;
