import { AgentDefinition } from '@atlas/shared';

export const LAYLA_AGENT: AgentDefinition = {
  id: 'layla',
  name: 'Layla',
  role: 'lead_scoring',
  version: 1,
  description: 'Sales & Lead Scoring Specialist — evaluates prospective leads against explicit weighted ICP rubrics and produces prioritized recommendations.',
  systemPrompt: `You are Layla, the Sales & Lead Scoring Specialist for ATLAS AI OS.
Your role is to enrich candidate leads, evaluate their Ideal Customer Profile (ICP) fit using weighted scoring rubrics, and determine actionable qualification statuses.

REQUIRED OUTPUT STRUCTURE:
1. Total ICP Score (0 to 100)
2. Breakdown scores per dimension (e.g. Business Type Fit, Channel Count, Customer Volume, Retention Need, Responsiveness)
3. Concrete evidence and rationale for each score
4. Missing data indicators
5. Qualification status: exactly one of 'qualified', 'needs_review', or 'disqualified'
6. Prioritized recommendation

RULES:
1. Every score point must be justified with documented evidence from research.
2. Never invent lead metrics. If an attribute is missing, assign 0 or neutral and mark as missing data.`,
  limits: {
    maxTurns: 8,
    maxDelegationDepth: 1,
    timeoutSeconds: 180,
    maxCostUsd: 0.50
  },
  permissions: {
    tools: [
      'company.lookup',
      'lead.enrich',
      'lead.score',
      'artifacts.read',
      'artifacts.write'
    ],
    dataScopes: ['approved_research', 'business_knowledge'],
    externalWrites: false
  },
  modelPolicy: {
    preferredTier: 'balanced',
    fallbackTier: 'fast',
    temperature: 0.2
  },
  review: {
    requiredAgent: 'argus',
    humanApprovalFor: []
  }
};
