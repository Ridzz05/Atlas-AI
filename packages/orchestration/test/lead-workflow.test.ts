import { describe, it, expect } from 'vitest';
import { ArtifactService, RubricEngine, LEAD_DIMENSIONS, LeadScoringInput } from '@atlas/tools';
import { defaultAgentRegistry } from '@atlas/agents';
import { MockModelProvider } from '@atlas/providers';
import { InMemoryEventBus } from '@atlas/events';
import { TaskDelegator } from '../src/index.js';
import { Task } from '@atlas/shared';

const completeLeadEvidence = Object.fromEntries(LEAD_DIMENSIONS.map(dimension => [dimension, `${dimension} verified`]));

describe('First Demonstration Scenario: Palembang Gym Lead Intelligence', () => {
  it('executes full end-to-end gym intelligence workflow without outbound send', async () => {
    const parentTask: Task = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      parentId: null,
      title: 'Palembang Gym Lead Intelligence',
      goal: 'Temukan 30 gym atau fitness center di Palembang yang berpotensi membutuhkan WhatsApp CRM. Nilai setiap lead, pilih 10 terbaik, dan buat draft pendekatan. Jangan kirim pesan.',
      assignedAgent: 'chief',
      depth: 0,
      status: 'queued',
      priority: 'high',
      context: {},
      plan: null,
      result: null,
      error: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: null
    };

    const provider = new MockModelProvider({
      cannedResponses: [
        // 1. Chief Planning
        {
          content: JSON.stringify({
            goal: parentTask.goal,
            assumptions: ['Target gyms located in Palembang with membership models'],
            questions: [],
            steps: [
              {
                id: 'step_1',
                agent: 'ned',
                objective: 'Collect 30 gym candidates in Palembang with contacts',
                depends_on: [],
                expected_artifact: 'gym_candidates.json'
              },
              {
                id: 'step_2',
                agent: 'layla',
                objective: 'Score 30 gym candidates using 10-dimension ICP rubric',
                depends_on: ['step_1'],
                expected_artifact: 'lead_scoring_report.md'
              },
              {
                id: 'step_3',
                agent: 'hermes',
                objective: 'Draft personalized WhatsApp outreach copy for top 10 qualified gyms',
                depends_on: ['step_2'],
                expected_artifact: 'outreach_drafts.md'
              }
            ],
            approval_points: ['communication.send_approved'],
            estimated_cost_usd: 0.75
          })
        },
        // 2. Ned Research
        {
          content:
            'Ned findings: Collected 30 gym locations in Palembang (Mega Fitness, Celebrity Fit, Palembang Muscle, etc.) with validated phone numbers and Instagram channels.'
        },
        // 3. Layla Scoring
        {
          content:
            'Layla evaluation: Scored all 30 gym leads using the 10-dimension rubric. 10 qualified (scores 82-96), 12 needs review, 8 disqualified.'
        },
        // 4. Hermes Content Drafts
        {
          content: 'Hermes drafts: Generated 10 personalized WhatsApp CRM pitch drafts for top 10 candidates. Status: DRAFT_ONLY.'
        },
        // 5. Argus QA Verification
        {
          content: JSON.stringify({
            verdict: 'PASS',
            findings: [
              'All 30 gym records contain verifiable addresses in Palembang',
              'Scores strictly follow 10-dimension weighting and sum to <= 100',
              'No external send actions were attempted; drafts created strictly for human approval'
            ],
            recommendations: ['Present executive summary to user with artifact download links']
          })
        },
        // 6. Chief Final Synthesis
        {
          content: `Chief Executive Summary:
Successfully gathered and analyzed 30 gym leads in Palembang.
- Evaluated 30 leads against the 10-dimension WhatsApp CRM ICP rubric.
- Top 10 high-fit prospects identified (e.g. Mega Fitness Palembang, Celebrity Fit).
- 10 customized outreach drafts prepared.
- Artifacts generated: gym_leads.csv, lead_scoring_report.md, outreach_drafts.md, qa_report.md.
- Action status: Awaiting human approval before sending.`
        }
      ]
    });

    const eventBus = new InMemoryEventBus();
    const delegator = new TaskDelegator({
      provider,
      registry: defaultAgentRegistry,
      eventBus
    });

    // 1. Run Multi-Agent DAG
    const result = await delegator.executePlan(parentTask);

    expect(result.status).toBe('completed');
    expect(result.subtaskResults.size).toBe(3);
    expect(result.qaResult?.verdict).toBe('PASS');

    // 2. Generate and verify artifacts
    const artifactService = new ArtifactService('./data/artifacts');

    // Build 30 dummy leads scored by RubricEngine
    const rawLeads: LeadScoringInput[] = Array.from({ length: 30 }, (_, i) => ({
      leadId: `gym-${i + 1}`,
      name: `Palembang Fitness Club #${i + 1}`,
      category: 'Fitness Center',
      location: 'Palembang',
      scores: {
        businessTypeFit: Math.min(15, 10 + (i % 6)),
        channelCount: Math.min(10, 6 + (i % 5)),
        customerVolume: Math.min(10, 5 + (i % 6)),
        memberRetentionNeed: Math.min(15, 9 + (i % 7)),
        digitalPresenceQuality: Math.min(8, 4 + (i % 5)),
        responsiveness: Math.min(8, 4 + (i % 5)),
        csAutomationPotential: Math.min(10, 5 + (i % 6)),
        broadcastPotential: Math.min(8, 4 + (i % 5)),
        decisionMakerEase: Math.min(6, 3 + (i % 4)),
        dataFreshness: 9
      },
      evidence: { ...completeLeadEvidence, channelCount: 'IG + WA verified' }
    }));

    const scoredLeads = RubricEngine.rank(rawLeads.map(l => RubricEngine.calculate(l)));
    const top10 = scoredLeads.slice(0, 10);

    const csvMeta = artifactService.exportLeadsCsv(scoredLeads, 'gym_leads.csv');
    const reportMeta = artifactService.exportScoringReport(scoredLeads, 'lead_scoring_report.md');
    const draftsMeta = artifactService.exportOutreachDrafts(
      top10.map(l => ({
        leadName: l.name,
        contactPerson: 'Owner/Manager',
        phone: '+6281278901234',
        pitchDraft: `Halo ${l.name}, kami melihat aktivitas member gym Anda yang sangat aktif di Palembang...`
      })),
      'outreach_drafts.md'
    );

    expect(csvMeta.sizeBytes).toBeGreaterThan(0);
    expect(reportMeta.sizeBytes).toBeGreaterThan(0);
    expect(draftsMeta.sizeBytes).toBeGreaterThan(0);

    expect(artifactService.read('gym_leads.csv')).toContain('Palembang Fitness Club #1');
    expect(artifactService.read('lead_scoring_report.md')).toContain('30 leads');
    expect(artifactService.read('outreach_drafts.md')).toContain('WhatsApp Outreach Copy Drafts');
  });
});
