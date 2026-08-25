import { describe, it, expect } from 'vitest';
import {
  ToolRegistry,
  WebSearchTool,
  CompanyLookupTool,
  CreateDraftTool,
  SendApprovedCommunicationTool,
  createArtifactTools,
  ArtifactService,
  RubricEngine,
  LeadScoringInput
} from '../src/index.js';

describe('@atlas/tools Tool Gateway & Rubric Tests', () => {
  it('registers and executes read research tools safely', async () => {
    const registry = new ToolRegistry();
    registry.register(WebSearchTool);
    registry.register(CompanyLookupTool);

    const searchRes = await registry.execute('web.search', { query: 'gyms in Palembang' }, {
      taskId: 'task-1',
      runId: 'run-1',
      agentId: 'ned'
    });

    expect(searchRes.success).toBe(true);
    expect((searchRes.output as any).results.length).toBeGreaterThan(0);
  });

  it('blocks communication.send_approved if approval token is missing', async () => {
    const registry = new ToolRegistry();
    registry.register(SendApprovedCommunicationTool);

    const sendRes = await registry.execute('communication.send_approved', {
      recipient: '+62812345678',
      channel: 'whatsapp',
      content: 'Hello Gym owner',
      approvalToken: ''
    }, {
      taskId: 'task-1',
      runId: 'run-1',
      agentId: 'hermes',
      externalWritesEnabled: true
      // No approvalToken provided in context
    });

    expect(sendRes.success).toBe(false);
    expect(sendRes.error).toContain('requires a valid human approval token');
  });

  it('allows communication.send_approved when valid approvalToken is supplied', async () => {
    const registry = new ToolRegistry();
    registry.register(SendApprovedCommunicationTool);

    const sendRes = await registry.execute('communication.send_approved', {
      recipient: '+62812345678',
      channel: 'whatsapp',
      content: 'Hello Gym owner',
      approvalToken: 'valid-token-123'
    }, {
      taskId: 'task-1',
      runId: 'run-1',
      agentId: 'hermes',
      externalWritesEnabled: true,
      approvalToken: 'valid-token-123'
    });

    expect(sendRes.success).toBe(true);
    expect((sendRes.output as any).status).toBe('sent');
  });

  it('calculates 10-dimension rubric scores and ranks leads properly', () => {
    const gym1: LeadScoringInput = {
      leadId: 'gym-1',
      name: 'Mega Fitness Palembang',
      category: 'Fitness Center',
      location: 'Palembang',
      scores: {
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
      evidence: { memberCount: '600 members', channels: 'WA, IG, FB' }
    };

    const gym2: LeadScoringInput = {
      leadId: 'gym-2',
      name: 'Small Studio Gym',
      category: 'Boutique Gym',
      location: 'Palembang',
      scores: {
        businessTypeFit: 10,
        channelCount: 5,
        customerVolume: 5,
        memberRetentionNeed: 10,
        digitalPresenceQuality: 5,
        responsiveness: 5,
        csAutomationPotential: 5,
        broadcastPotential: 5,
        decisionMakerEase: 5,
        dataFreshness: 5
      },
      evidence: { memberCount: '50 members' }
    };

    const evaluated1 = RubricEngine.calculate(gym1);
    const evaluated2 = RubricEngine.calculate(gym2);

    expect(evaluated1.totalScore).toBe(100);
    expect(evaluated1.status).toBe('qualified');

    expect(evaluated2.totalScore).toBe(60);
    expect(evaluated2.status).toBe('needs_review');

    const ranked = RubricEngine.rank([evaluated2, evaluated1]);
    expect(ranked[0]?.name).toBe('Mega Fitness Palembang');
    expect(ranked[0]?.rank).toBe(1);
    expect(ranked[1]?.rank).toBe(2);
  });

  it('generates CSV and Markdown artifacts properly', () => {
    const artifactService = new ArtifactService('./data/test-artifacts');

    const sampleLead = RubricEngine.calculate({
      leadId: 'gym-test',
      name: 'Palembang Gym Center',
      category: 'Gym',
      location: 'Palembang',
      scores: {
        businessTypeFit: 15,
        channelCount: 10,
        customerVolume: 8,
        memberRetentionNeed: 14,
        digitalPresenceQuality: 7,
        responsiveness: 7,
        csAutomationPotential: 9,
        broadcastPotential: 7,
        decisionMakerEase: 5,
        dataFreshness: 9
      },
      evidence: {}
    });

    const csvMeta = artifactService.exportLeadsCsv([sampleLead], 'test_leads.csv');
    expect(csvMeta.sizeBytes).toBeGreaterThan(0);
    expect(artifactService.read('test_leads.csv')).toContain('Palembang Gym Center');

    const reportMeta = artifactService.exportScoringReport([sampleLead], 'test_report.md');
    expect(reportMeta.sizeBytes).toBeGreaterThan(0);
    expect(artifactService.read('test_report.md')).toContain('Lead Scoring & ICP Evaluation Report');
  });
});
