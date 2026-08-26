import { z } from 'zod';
import { ToolDefinition } from '../types.js';
import {
  LeadScoringInputSchema,
  LeadScoringResultSchema,
  RubricEngine
} from '../scoring/rubric-engine.js';

const LeadScoringToolInputSchema = LeadScoringInputSchema.extend({
  rubricVersion: z.string().trim().min(1).optional()
});

export const LeadScoringTool: ToolDefinition = {
  name: 'lead.score',
  description: 'Calculate a lead score through the registered, evidence-aware ICP rubric.',
  inputSchema: LeadScoringToolInputSchema,
  outputSchema: LeadScoringResultSchema,
  riskLevel: 'low',
  requiresApproval: false,
  timeoutMs: 3000,
  async execute(_ctx, input) {
    const { rubricVersion, ...lead } = input as z.infer<typeof LeadScoringToolInputSchema>;
    return RubricEngine.calculate(lead, { rubricVersion });
  }
};
