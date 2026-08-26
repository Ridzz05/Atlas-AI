import { z } from 'zod';

export const LEAD_DIMENSIONS = [
  'businessTypeFit',
  'channelCount',
  'customerVolume',
  'memberRetentionNeed',
  'digitalPresenceQuality',
  'responsiveness',
  'csAutomationPotential',
  'broadcastPotential',
  'decisionMakerEase',
  'dataFreshness'
] as const;
export type LeadDimension = typeof LEAD_DIMENSIONS[number];

export const LeadDimensionScoresSchema = z.object({
  businessTypeFit: z.number().finite().nonnegative(),
  channelCount: z.number().finite().nonnegative(),
  customerVolume: z.number().finite().nonnegative(),
  memberRetentionNeed: z.number().finite().nonnegative(),
  digitalPresenceQuality: z.number().finite().nonnegative(),
  responsiveness: z.number().finite().nonnegative(),
  csAutomationPotential: z.number().finite().nonnegative(),
  broadcastPotential: z.number().finite().nonnegative(),
  decisionMakerEase: z.number().finite().nonnegative(),
  dataFreshness: z.number().finite().nonnegative()
});
export type LeadDimensionScores = z.infer<typeof LeadDimensionScoresSchema>;

export const LeadScoringInputSchema = z.object({
  leadId: z.string().min(1),
  name: z.string().min(1),
  category: z.string().min(1),
  location: z.string().min(1),
  scores: LeadDimensionScoresSchema,
  evidence: z.record(z.string()),
  decisionMaker: z.string().min(1).optional(),
  phone: z.string().min(1).optional(),
  instagram: z.string().min(1).optional()
});
export type LeadScoringInput = z.infer<typeof LeadScoringInputSchema>;

export const LeadRubricDefinitionSchema = z.object({
  version: z.string().trim().min(1),
  maxScores: LeadDimensionScoresSchema,
  thresholds: z.object({
    qualified: z.number().finite().min(0).max(100),
    needsReview: z.number().finite().min(0).max(100)
  })
}).superRefine((definition, ctx) => {
  const maxScore = LEAD_DIMENSIONS.reduce((sum, dimension) => sum + definition.maxScores[dimension], 0);
  if (Math.abs(maxScore - 100) > Number.EPSILON) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['maxScores'],
      message: `Rubric maximum scores must sum to 100, received ${maxScore}.`
    });
  }
  if (definition.thresholds.qualified <= definition.thresholds.needsReview) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['thresholds'],
      message: 'The qualified threshold must be greater than the needs-review threshold.'
    });
  }
});
export type LeadRubricDefinition = z.infer<typeof LeadRubricDefinitionSchema>;

export const DEFAULT_LEAD_RUBRIC: LeadRubricDefinition = {
  version: 'v1',
  maxScores: {
    businessTypeFit: 15,
    channelCount: 10,
    customerVolume: 10,
    memberRetentionNeed: 15,
    digitalPresenceQuality: 8,
    responsiveness: 8,
    csAutomationPotential: 10,
    broadcastPotential: 8,
    decisionMakerEase: 6,
    dataFreshness: 10
  },
  thresholds: {
    qualified: 80,
    needsReview: 60
  }
};

export interface LeadEvidenceValidation {
  complete: boolean;
  missingDimensions: LeadDimension[];
}

export const LeadScoringResultSchema = z.object({
  leadId: z.string().min(1),
  name: z.string().min(1),
  rubricVersion: z.string().min(1),
  totalScore: z.number().finite().min(0).max(100),
  maxScore: z.literal(100),
  dimensionScores: LeadDimensionScoresSchema,
  evidence: z.record(z.string()),
  evidenceComplete: z.boolean(),
  missingEvidence: z.array(z.enum(LEAD_DIMENSIONS)),
  status: z.enum(['qualified', 'needs_review', 'disqualified']),
  rank: z.number().int().nonnegative(),
  recommendation: z.string()
});
export type LeadScoringResult = z.infer<typeof LeadScoringResultSchema>;

export class RubricEngine {
  private static readonly rubrics = new Map<string, LeadRubricDefinition>([
    [DEFAULT_LEAD_RUBRIC.version, DEFAULT_LEAD_RUBRIC]
  ]);

  public static register(rubric: LeadRubricDefinition): void {
    const validated = LeadRubricDefinitionSchema.parse(rubric);
    if (this.rubrics.has(validated.version)) {
      throw new Error(`Rubric version '${validated.version}' is already registered.`);
    }
    this.rubrics.set(validated.version, this.cloneRubric(validated));
  }

  public static getRubric(version = DEFAULT_LEAD_RUBRIC.version): LeadRubricDefinition {
    const rubric = this.rubrics.get(version);
    if (!rubric) {
      throw new Error(`Rubric version '${version}' is not registered.`);
    }
    return this.cloneRubric(rubric);
  }

  public static validateEvidence(
    input: Pick<LeadScoringInput, 'scores' | 'evidence'>
  ): LeadEvidenceValidation {
    const missingDimensions = LEAD_DIMENSIONS.filter(dimension => {
      const evidence = input.evidence?.[dimension];
      return input.scores[dimension] > 0 && (typeof evidence !== 'string' || evidence.trim().length === 0);
    });

    return {
      complete: missingDimensions.length === 0,
      missingDimensions
    };
  }

  public static calculate(
    input: LeadScoringInput,
    options: { rubricVersion?: string } = {}
  ): LeadScoringResult {
    const rubric = this.getRubric(options.rubricVersion);
    const scores = LeadDimensionScoresSchema.parse(input.scores);

    for (const dimension of LEAD_DIMENSIONS) {
      if (scores[dimension] > rubric.maxScores[dimension]) {
        throw new Error(
          `Score for '${dimension}' exceeds rubric '${rubric.version}' maximum of ${rubric.maxScores[dimension]}.`
        );
      }
    }

    const evidenceValidation = this.validateEvidence({ scores, evidence: input.evidence });
    const totalScore = LEAD_DIMENSIONS.reduce((sum, dimension) => sum + scores[dimension], 0);
    const roundedScore = Math.round(Math.min(100, Math.max(0, totalScore)));

    let status: LeadScoringResult['status'];
    let recommendation: string;
    if (roundedScore >= rubric.thresholds.qualified) {
      status = 'qualified';
      recommendation = 'Top tier candidate — highly recommended for personalized WhatsApp CRM consultation.';
    } else if (roundedScore >= rubric.thresholds.needsReview) {
      status = 'needs_review';
      recommendation = 'Moderate fit — needs secondary manual review on digital responsiveness before outreach.';
    } else {
      status = 'disqualified';
      recommendation = 'Low ICP fit — insufficient customer volume or retention requirement.';
    }

    if (!evidenceValidation.complete) {
      if (status === 'qualified') status = 'needs_review';
      recommendation = `Evidence incomplete for: ${evidenceValidation.missingDimensions.join(', ')}. ${recommendation}`;
    }

    return {
      leadId: input.leadId,
      name: input.name,
      rubricVersion: rubric.version,
      totalScore: roundedScore,
      maxScore: 100,
      dimensionScores: scores,
      evidence: input.evidence,
      evidenceComplete: evidenceValidation.complete,
      missingEvidence: evidenceValidation.missingDimensions,
      status,
      rank: 0,
      recommendation
    };
  }

  public static rank(leads: LeadScoringResult[]): LeadScoringResult[] {
    const sorted = [...leads].sort((a, b) =>
      b.totalScore - a.totalScore || a.leadId.localeCompare(b.leadId)
    );
    return sorted.map((lead, idx) => ({ ...lead, rank: idx + 1 }));
  }

  private static cloneRubric(rubric: LeadRubricDefinition): LeadRubricDefinition {
    return {
      version: rubric.version,
      maxScores: { ...rubric.maxScores },
      thresholds: { ...rubric.thresholds }
    };
  }
}
