import { z } from 'zod';

export const LeadDimensionScoresSchema = z.object({
  businessTypeFit: z.number().min(0).max(15),
  channelCount: z.number().min(0).max(10),
  customerVolume: z.number().min(0).max(10),
  memberRetentionNeed: z.number().min(0).max(15),
  digitalPresenceQuality: z.number().min(0).max(8),
  responsiveness: z.number().min(0).max(8),
  csAutomationPotential: z.number().min(0).max(10),
  broadcastPotential: z.number().min(0).max(8),
  decisionMakerEase: z.number().min(0).max(6),
  dataFreshness: z.number().min(0).max(10)
});
export type LeadDimensionScores = z.infer<typeof LeadDimensionScoresSchema>;

export interface LeadScoringInput {
  leadId: string;
  name: string;
  category: string;
  location: string;
  scores: LeadDimensionScores;
  evidence: Record<string, string>;
  decisionMaker?: string;
  phone?: string;
  instagram?: string;
}

export interface LeadScoringResult {
  leadId: string;
  name: string;
  totalScore: number;
  maxScore: 100;
  dimensionScores: LeadDimensionScores;
  evidence: Record<string, string>;
  status: 'qualified' | 'needs_review' | 'disqualified';
  rank: number;
  recommendation: string;
}

export class RubricEngine {
  public static calculate(input: LeadScoringInput): LeadScoringResult {
    const s = input.scores;
    const totalScore =
      s.businessTypeFit +
      s.channelCount +
      s.customerVolume +
      s.memberRetentionNeed +
      s.digitalPresenceQuality +
      s.responsiveness +
      s.csAutomationPotential +
      s.broadcastPotential +
      s.decisionMakerEase +
      s.dataFreshness;

    let status: 'qualified' | 'needs_review' | 'disqualified' = 'disqualified';
    let recommendation = '';

    if (totalScore >= 80) {
      status = 'qualified';
      recommendation = 'Top tier candidate — highly recommended for personalized WhatsApp CRM consultation.';
    } else if (totalScore >= 60) {
      status = 'needs_review';
      recommendation = 'Moderate fit — needs secondary manual review on digital responsiveness before outreach.';
    } else {
      status = 'disqualified';
      recommendation = 'Low ICP fit — insufficient customer volume or retention requirement.';
    }

    return {
      leadId: input.leadId,
      name: input.name,
      totalScore: Math.min(100, Math.max(0, Math.round(totalScore))),
      maxScore: 100,
      dimensionScores: s,
      evidence: input.evidence,
      status,
      rank: 0,
      recommendation
    };
  }

  public static rank(leads: LeadScoringResult[]): LeadScoringResult[] {
    const sorted = [...leads].sort((a, b) => b.totalScore - a.totalScore);
    return sorted.map((lead, idx) => ({ ...lead, rank: idx + 1 }));
  }
}
