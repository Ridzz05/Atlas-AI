import { z } from 'zod';
import { ApprovalMatrix } from '@atlas/policy';
import { ToolDefinition } from '../types.js';

const PolicyVerifyOutputSchema = z.object({
  action: z.string().min(1),
  requiresApproval: z.boolean(),
  blocked: z.boolean(),
  riskLevel: z.enum(['read', 'low', 'medium', 'high', 'critical']),
  reason: z.string().nullable()
});

export const PolicyVerifyTool: ToolDefinition = {
  name: 'policy.verify',
  description: 'Inspect the effective policy for an action using the current runtime write configuration.',
  inputSchema: z.object({
    action: z.string().trim().min(1).max(128)
  }),
  outputSchema: PolicyVerifyOutputSchema,
  riskLevel: 'read',
  requiresApproval: false,
  timeoutMs: 1000,
  async execute(ctx, input) {
    const policy = ApprovalMatrix.evaluate(input.action, {
      externalWritesEnabled: ctx.externalWritesEnabled
    });
    return {
      action: input.action,
      requiresApproval: policy.requiresApproval,
      blocked: policy.blocked,
      riskLevel: policy.riskLevel,
      reason: policy.reason || null
    };
  }
};
