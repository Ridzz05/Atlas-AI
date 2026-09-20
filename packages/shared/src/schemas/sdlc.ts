import { z } from 'zod';

export const SDLCPhaseSchema = z.enum([
  'inception',
  'architecture',
  'budget_gate',
  'sprint_planning',
  'implementation',
  'qa_compliance',
  'release_signoff',
  'completed',
  'failed'
]);
export type SDLCPhase = z.infer<typeof SDLCPhaseSchema>;

/**
 * The order in which phases execute. `completed` is terminal and has no task of its own;
 * `failed` is not part of the happy path.
 */
export const SDLC_PHASE_SEQUENCE = [
  'inception',
  'architecture',
  'budget_gate',
  'sprint_planning',
  'implementation',
  'qa_compliance',
  'release_signoff',
  'completed'
] as const;

/**
 * Which agent owns each phase, as a single shared mapping. Every phase runs as a normal
 * task through the task pipeline, so the agent named here is the task's assigned agent —
 * and therefore inherits that agent's budget ceiling, timeout, turn limit and tool
 * allowlist instead of bypassing them.
 *
 * `sprint_planning` and `implementation` belong to `chief` on purpose: chief is the
 * orchestrator, so the delegator expands those phases into specialist subtasks.
 */
export const SDLC_PHASE_AGENT: Readonly<Record<string, string>> = {
  inception: 'ceo',
  architecture: 'cto',
  budget_gate: 'cfo',
  sprint_planning: 'chief',
  implementation: 'chief',
  qa_compliance: 'argus',
  release_signoff: 'chief'
};

export const StrategicBriefSchema = z.object({
  title: z.string().min(1),
  executiveSummary: z.string(),
  problemStatement: z.string(),
  targetAudience: z.string().optional(),
  keyObjectives: z.array(z.string()).default([]),
  acceptanceCriteria: z.array(z.string()).default([]),
  strategicPriority: z.enum(['critical', 'high', 'medium', 'low']).default('high'),
  authorAgent: z.string().default('ceo'),
  createdAt: z.string().datetime().optional()
});
export type StrategicBrief = z.infer<typeof StrategicBriefSchema>;

export const TechnicalSpecSchema = z.object({
  architectureSummary: z.string(),
  requiredCapabilities: z.array(z.string()).default([]),
  allowedTools: z.array(z.string()).default([]),
  disallowedTools: z.array(z.string()).default([]),
  securityConsiderations: z.array(z.string()).default([]),
  technicalFeasibility: z.enum(['approved', 'rejected', 'needs_revision']).default('approved'),
  authorAgent: z.string().default('cto'),
  createdAt: z.string().datetime().optional()
});
export type TechnicalSpec = z.infer<typeof TechnicalSpecSchema>;

export const BudgetEnvelopeSchema = z.object({
  estimatedCostUsd: z.number().nonnegative(),
  maxAuthorizedCostUsd: z.number().positive(),
  estimatedTokenCount: z.number().int().nonnegative().optional(),
  roiRationale: z.string(),
  financialApproval: z.enum(['approved', 'rejected', 'escalated_to_human']).default('approved'),
  authorAgent: z.string().default('cfo'),
  createdAt: z.string().datetime().optional()
});
export type BudgetEnvelope = z.infer<typeof BudgetEnvelopeSchema>;

export const SprintSubtaskSchema = z.object({
  stepId: z.string(),
  title: z.string(),
  assignedAgent: z.string(),
  goal: z.string(),
  dependencies: z.array(z.string()).default([]),
  depth: z.number().int().min(0).max(2).default(1)
});
export type SprintSubtask = z.infer<typeof SprintSubtaskSchema>;

export const SprintPlanSchema = z.object({
  decompositionStrategy: z.string(),
  subtasks: z.array(SprintSubtaskSchema).default([]),
  maxConcurrency: z.number().int().min(1).max(5).default(3),
  authorAgent: z.string().default('coo'),
  createdAt: z.string().datetime().optional()
});
export type SprintPlan = z.infer<typeof SprintPlanSchema>;

export const QACheckItemSchema = z.object({
  name: z.string(),
  passed: z.boolean(),
  notes: z.string().optional()
});
export type QACheckItem = z.infer<typeof QACheckItemSchema>;

export const QAReportSchema = z.object({
  verificationScore: z.number().min(0).max(100),
  complianceChecks: z.array(QACheckItemSchema).default([]),
  riskAssessment: z.enum(['low', 'medium', 'high', 'critical']).default('low'),
  verdict: z.enum(['PASS', 'PASS_WITH_WARNINGS', 'REVISE', 'REJECT']).default('PASS'),
  critique: z.string().optional(),
  authorAgent: z.string().default('argus'),
  createdAt: z.string().datetime().optional()
});
export type QAReport = z.infer<typeof QAReportSchema>;

export const SDLCInitiativeSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1),
  intent: z.string().min(1),
  status: z.enum(['active', 'paused', 'completed', 'failed']).default('active'),
  currentPhase: SDLCPhaseSchema.default('inception'),
  strategicBrief: StrategicBriefSchema.optional(),
  technicalSpec: TechnicalSpecSchema.optional(),
  budgetEnvelope: BudgetEnvelopeSchema.optional(),
  sprintPlan: SprintPlanSchema.optional(),
  qaReport: QAReportSchema.optional(),
  parentTaskId: z.string().uuid().optional(),
  phaseTaskId: z.string().uuid().optional(),
  phaseAttempt: z.number().int().nonnegative().default(0),
  artifacts: z.array(z.string()).default([]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});
export type SDLCInitiative = z.infer<typeof SDLCInitiativeSchema>;

export const CreateSDLCInitiativeInputSchema = z.object({
  title: z.string().min(1),
  intent: z.string().min(1),
  priority: z.enum(['critical', 'high', 'medium', 'low']).default('high'),
  maxAuthorizedBudgetUsd: z.number().positive().optional()
});
export type CreateSDLCInitiativeInput = z.infer<typeof CreateSDLCInitiativeInputSchema>;
