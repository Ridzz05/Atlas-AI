import { describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  ToolRegistry,
  WebSearchTool,
  WebFetchTool,
  CompanyLookupTool,
  LeadEnrichmentTool,
  LeadScoringTool,
  PolicyVerifyTool,
  CreateDraftTool,
  SendApprovedCommunicationTool,
  createArtifactTools,
  ArtifactService,
  RubricEngine,
  DEFAULT_LEAD_RUBRIC,
  LEAD_DIMENSIONS,
  LeadScoringInput,
  createMemoryTools
} from '../src/index.js';
import { TokenVerifier } from '@atlas/policy';
import { InMemoryMemoryStore, MemoryRetriever, MemoryProposalService, MemoryTools } from '@atlas/memory';

const completeLeadEvidence = Object.fromEntries(LEAD_DIMENSIONS.map(dimension => [dimension, `${dimension} verified`]));

describe('@atlas/tools Tool Gateway & Rubric Tests', () => {
  it('rejects malformed tool output before returning it to orchestration', async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'test.malformed_output',
      description: 'Test-only tool with a strict output contract.',
      inputSchema: z.object({}),
      outputSchema: z.object({ verified: z.boolean() }),
      riskLevel: 'read',
      requiresApproval: false,
      timeoutMs: 1000,
      async execute() {
        return { verified: 'yes' };
      }
    });

    const result = await registry.execute(
      'test.malformed_output',
      {},
      {
        taskId: 'task-1',
        runId: 'run-1',
        agentId: 'argus'
      }
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid output from tool 'test.malformed_output'");
  });

  it('aborts a running tool when the gateway timeout expires', async () => {
    const registry = new ToolRegistry();
    let aborted = false;
    registry.register({
      name: 'test.timeout_abort',
      description: 'Test-only tool that waits for cancellation.',
      inputSchema: z.object({}),
      outputSchema: z.object({ completed: z.boolean() }),
      riskLevel: 'read',
      requiresApproval: false,
      timeoutMs: 10,
      async execute(context) {
        return new Promise(resolve => {
          context.signal?.addEventListener(
            'abort',
            () => {
              aborted = true;
              resolve({ completed: true });
            },
            { once: true }
          );
        });
      }
    });

    const result = await registry.execute(
      'test.timeout_abort',
      {},
      {
        taskId: 'task-1',
        runId: 'run-1',
        agentId: 'ned'
      }
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Tool 'test.timeout_abort' timed out");
    expect(aborted).toBe(true);
  });

  it('registers and executes read research tools safely', async () => {
    const registry = new ToolRegistry();
    registry.register(WebSearchTool);
    registry.register(CompanyLookupTool);

    const searchRes = await registry.execute(
      'web.search',
      { query: 'gyms in Palembang' },
      {
        taskId: 'task-1',
        runId: 'run-1',
        agentId: 'ned'
      }
    );

    expect(searchRes.success).toBe(true);
    expect((searchRes.output as any).configured).toBe(false);
    expect((searchRes.output as any).results).toEqual([]);
    expect((searchRes.output as any).warning).toContain('No verified research provider');

    const companyRes = await registry.execute(
      'company.lookup',
      { companyName: 'Unknown Gym' },
      {
        taskId: 'task-1',
        runId: 'run-1',
        agentId: 'ned'
      }
    );
    expect(companyRes.success).toBe(true);
    expect((companyRes.output as any).found).toBe(false);
    expect((companyRes.output as any).configured).toBe(false);
  });

  it('returns no fetched facts when the safe web provider is unavailable', async () => {
    const registry = new ToolRegistry();
    registry.register(WebFetchTool);

    const result = await registry.execute(
      'web.fetch_safe',
      {
        url: 'https://example.com/research'
      },
      {
        taskId: 'task-1',
        runId: 'run-1',
        agentId: 'ned',
        allowedTools: ['web.fetch_safe']
      }
    );

    expect(result.success).toBe(true);
    expect((result.output as any).configured).toBe(false);
    expect((result.output as any).content).toBeNull();
    expect((result.output as any).warning).toContain('No verified safe web provider');
  });

  it('accepts safe web content only with evidence and an untrusted-content marker', async () => {
    const registry = new ToolRegistry();
    registry.register(WebFetchTool);

    const result = await registry.execute(
      'web.fetch_safe',
      {
        url: 'https://example.com/research'
      },
      {
        taskId: 'task-1',
        runId: 'run-1',
        agentId: 'ned',
        allowedTools: ['web.fetch_safe'],
        researchProvider: {
          fetchSafe: vi.fn().mockResolvedValue({
            content: 'Untrusted business page content',
            sourceUrl: 'https://example.com/research',
            extractedAt: '2026-08-26T00:00:00.000Z',
            freshness: 'fresh',
            sensitivity: 'public',
            unresolvedQuestions: ['Owner identity is not confirmed'],
            confidence: 0.81
          })
        }
      }
    );

    expect(result.success).toBe(true);
    expect((result.output as any).configured).toBe(true);
    expect((result.output as any).contentIsUntrusted).toBe(true);
    expect((result.output as any).confidence).toBe(0.81);
  });

  it('rejects unsafe web URL schemes and credential-bearing URLs before provider access', async () => {
    const registry = new ToolRegistry();
    registry.register(WebFetchTool);
    const fetchSafe = vi.fn();
    const context = {
      taskId: 'task-1',
      runId: 'run-1',
      agentId: 'ned',
      allowedTools: ['web.fetch_safe'],
      researchProvider: { fetchSafe }
    } as any;

    const fileResult = await registry.execute('web.fetch_safe', { url: 'file:///etc/passwd' }, context);
    const credentialResult = await registry.execute('web.fetch_safe', { url: 'https://user:secret@example.com/page' }, context);

    expect(fileResult.success).toBe(false);
    expect(credentialResult.success).toBe(false);
    expect(fetchSafe).not.toHaveBeenCalled();
  });

  it('rejects localhost and literal IP web targets before provider access', async () => {
    const registry = new ToolRegistry();
    registry.register(WebFetchTool);
    const fetchSafe = vi.fn();
    const context = {
      taskId: 'task-1',
      runId: 'run-1',
      agentId: 'ned',
      allowedTools: ['web.fetch_safe'],
      researchProvider: { fetchSafe }
    } as any;

    const localHostResult = await registry.execute(
      'web.fetch_safe',
      {
        url: 'https://localhost/admin'
      },
      context
    );
    const privateIpResult = await registry.execute(
      'web.fetch_safe',
      {
        url: 'http://192.168.1.10/metadata'
      },
      context
    );
    const linkLocalResult = await registry.execute(
      'web.fetch_safe',
      {
        url: 'http://169.254.169.254/latest/meta-data'
      },
      context
    );
    const ipv6LoopbackResult = await registry.execute(
      'web.fetch_safe',
      {
        url: 'http://[::1]/admin'
      },
      context
    );

    expect(localHostResult.success).toBe(false);
    expect(privateIpResult.success).toBe(false);
    expect(linkLocalResult.success).toBe(false);
    expect(ipv6LoopbackResult.success).toBe(false);
    expect(fetchSafe).not.toHaveBeenCalled();
  });

  it('lets Argus inspect policy without bypassing the runtime write flag', async () => {
    const registry = new ToolRegistry();
    registry.register(PolicyVerifyTool);

    const result = await registry.execute(
      'policy.verify',
      {
        action: 'system.deploy'
      },
      {
        taskId: 'task-1',
        runId: 'run-1',
        agentId: 'argus',
        allowedTools: ['policy.verify'],
        externalWritesEnabled: false
      }
    );

    expect(result.success).toBe(true);
    expect((result.output as any).blocked).toBe(true);
    expect((result.output as any).requiresApproval).toBe(true);
  });

  it('exposes lead enrichment as an honest unavailable result without a provider', async () => {
    const registry = new ToolRegistry();
    registry.register(LeadEnrichmentTool);

    const result = await registry.execute(
      'lead.enrich',
      {
        companyName: 'Unknown Gym',
        location: 'Palembang'
      },
      {
        taskId: 'task-1',
        runId: 'run-1',
        agentId: 'layla',
        allowedTools: ['lead.enrich']
      }
    );

    expect(result.success).toBe(true);
    expect((result.output as any).configured).toBe(false);
    expect((result.output as any).found).toBe(false);
    expect((result.output as any).warning).toContain('No verified lead enrichment provider');
  });

  it('accepts provider-backed lead enrichment only with complete evidence', async () => {
    const registry = new ToolRegistry();
    registry.register(LeadEnrichmentTool);

    const result = await registry.execute(
      'lead.enrich',
      {
        companyName: 'Verified Gym',
        location: 'Palembang'
      },
      {
        taskId: 'task-1',
        runId: 'run-1',
        agentId: 'layla',
        allowedTools: ['lead.enrich'],
        researchProvider: {
          enrichLead: vi.fn().mockResolvedValue({
            found: true,
            companyName: 'Verified Gym',
            location: 'Palembang',
            category: 'Fitness Center',
            estimatedMembers: 600,
            sourceUrl: 'https://example.com/verified-gym',
            extractedAt: '2026-08-26T00:00:00.000Z',
            freshness: 'fresh',
            sensitivity: 'public',
            unresolvedQuestions: [],
            confidence: 0.92
          })
        }
      }
    );

    expect(result.success).toBe(true);
    expect((result.output as any).configured).toBe(true);
    expect((result.output as any).found).toBe(true);
    expect((result.output as any).confidence).toBe(0.92);
  });

  it('routes lead scoring through the deterministic rubric tool', async () => {
    const registry = new ToolRegistry();
    registry.register(LeadScoringTool);

    const result = await registry.execute(
      'lead.score',
      {
        leadId: 'gym-tool-1',
        name: 'Deterministic Gym',
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
        evidence: completeLeadEvidence
      },
      {
        taskId: 'task-1',
        runId: 'run-1',
        agentId: 'layla',
        allowedTools: ['lead.score']
      }
    );

    expect(result.success).toBe(true);
    expect((result.output as any).totalScore).toBe(100);
    expect((result.output as any).status).toBe('qualified');
    expect((result.output as any).evidenceComplete).toBe(true);
  });

  it('rejects lead enrichment output without research evidence metadata', async () => {
    const registry = new ToolRegistry();
    registry.register(LeadEnrichmentTool);

    const result = await registry.execute(
      'lead.enrich',
      {
        companyName: 'Malformed Gym',
        location: 'Palembang'
      },
      {
        taskId: 'task-1',
        runId: 'run-1',
        agentId: 'layla',
        allowedTools: ['lead.enrich'],
        researchProvider: {
          enrichLead: vi.fn().mockResolvedValue({
            found: true,
            companyName: 'Malformed Gym',
            location: 'Palembang',
            category: 'Gym',
            sourceUrl: 'https://example.com/gym'
          })
        } as any
      }
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid output from tool 'lead.enrich'");
  });

  it('rejects research provider results that omit evidence metadata', async () => {
    const registry = new ToolRegistry();
    registry.register(WebSearchTool);

    const result = await registry.execute(
      'web.search',
      { query: 'gyms in Palembang' },
      {
        taskId: 'task-1',
        runId: 'run-1',
        agentId: 'ned',
        researchProvider: {
          search: vi.fn().mockResolvedValue([
            {
              title: 'Gym result',
              url: 'https://example.com/gym',
              snippet: 'Gym profile',
              confidence: 0.9
            }
          ]),
          lookupCompany: vi.fn()
        } as any
      }
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid output from tool 'web.search'");
  });

  it('accepts research results only when evidence metadata is complete', async () => {
    const registry = new ToolRegistry();
    registry.register(WebSearchTool);
    registry.register(CompanyLookupTool);
    const evidence = {
      extractedAt: '2026-08-26T00:00:00.000Z',
      freshness: 'fresh' as const,
      sensitivity: 'public' as const,
      unresolvedQuestions: [],
      confidence: 0.9
    };

    const searchResult = await registry.execute(
      'web.search',
      { query: 'gyms in Palembang' },
      {
        taskId: 'task-1',
        runId: 'run-1',
        agentId: 'ned',
        researchProvider: {
          search: vi.fn().mockResolvedValue([
            {
              title: 'Gym result',
              url: 'https://example.com/gym',
              snippet: 'Gym profile',
              ...evidence
            }
          ]),
          lookupCompany: vi.fn()
        } as any
      }
    );

    expect(searchResult.success).toBe(true);

    const companyResult = await registry.execute(
      'company.lookup',
      { companyName: 'Gym result' },
      {
        taskId: 'task-1',
        runId: 'run-1',
        agentId: 'ned',
        researchProvider: {
          search: vi.fn(),
          lookupCompany: vi.fn().mockResolvedValue({
            found: true,
            companyName: 'Gym result',
            address: 'Palembang',
            sourceUrl: 'https://example.com/gym',
            ...evidence
          })
        } as any
      }
    );

    expect(companyResult.success).toBe(true);
  });

  it('blocks communication.send_approved if approval token is missing', async () => {
    const registry = new ToolRegistry();
    registry.register(SendApprovedCommunicationTool);

    const sendRes = await registry.execute(
      'communication.send_approved',
      {
        recipient: '+62812345678',
        channel: 'whatsapp',
        content: 'Hello Gym owner'
      },
      {
        taskId: 'task-1',
        runId: 'run-1',
        agentId: 'hermes',
        externalWritesEnabled: true
        // No approvalToken provided in context
      }
    );

    expect(sendRes.success).toBe(false);
    expect(sendRes.error).toContain('requires a valid human approval token');
  });

  it('allows communication.send_approved when valid approvalToken is supplied', async () => {
    const registry = new ToolRegistry();
    registry.register(SendApprovedCommunicationTool);
    const secret = 'test-secret-key-32-chars-length!!';
    const payload = {
      recipient: '+62812345678',
      channel: 'whatsapp' as const,
      content: 'Hello Gym owner'
    };
    const approvalToken = TokenVerifier.generateToken(randomUUID(), 'communication.send_approved', payload, secret);
    let sendCount = 0;

    const sendRes = await registry.execute('communication.send_approved', payload, {
      taskId: 'task-1',
      runId: 'run-1',
      agentId: 'hermes',
      externalWritesEnabled: true,
      approvalToken,
      approvalSecretKey: secret,
      communicationSender: async input => {
        sendCount += 1;
        return {
          messageId: 'provider-message-1',
          timestamp: new Date().toISOString(),
          recipient: input.recipient
        };
      }
    });

    expect(sendRes.success).toBe(true);
    expect((sendRes.output as any).messageId).toBe('provider-message-1');

    const replayRes = await registry.execute('communication.send_approved', payload, {
      taskId: 'task-1',
      runId: 'run-1',
      agentId: 'hermes',
      externalWritesEnabled: true,
      approvalToken,
      approvalSecretKey: secret,
      communicationSender: async () => ({
        messageId: 'should-not-send',
        timestamp: new Date().toISOString(),
        recipient: payload.recipient
      })
    });

    expect(replayRes.success).toBe(false);
    expect(replayRes.error).toContain('already been consumed');
    expect(sendCount).toBe(1);
  });

  it('rejects an approval token when the signed payload or action does not match', async () => {
    const registry = new ToolRegistry();
    registry.register(SendApprovedCommunicationTool);
    const secret = 'test-secret-key-32-chars-length!!';
    const approvalToken = TokenVerifier.generateToken(
      randomUUID(),
      'communication.send_approved',
      { recipient: '+62812345678', channel: 'whatsapp', content: 'Approved copy' },
      secret
    );

    const sendRes = await registry.execute(
      'communication.send_approved',
      {
        recipient: '+62812345678',
        channel: 'whatsapp',
        content: 'Tampered copy'
      },
      {
        taskId: 'task-1',
        runId: 'run-1',
        agentId: 'hermes',
        externalWritesEnabled: true,
        approvalToken,
        approvalSecretKey: secret,
        communicationSender: async () => ({
          messageId: 'should-not-send',
          timestamp: new Date().toISOString(),
          recipient: '+62812345678'
        })
      }
    );

    expect(sendRes.success).toBe(false);
    expect(sendRes.error).toContain('Payload has changed');
  });

  it('rejects outbound execution when no connector is configured', async () => {
    const registry = new ToolRegistry();
    registry.register(SendApprovedCommunicationTool);
    const secret = 'test-secret-key-32-chars-length!!';
    const payload = {
      recipient: '+62812345678',
      channel: 'whatsapp' as const,
      content: 'Hello Gym owner'
    };
    const approvalToken = TokenVerifier.generateToken(randomUUID(), 'communication.send_approved', payload, secret);

    const sendRes = await registry.execute('communication.send_approved', payload, {
      taskId: 'task-1',
      runId: 'run-1',
      agentId: 'hermes',
      externalWritesEnabled: true,
      approvalToken,
      approvalSecretKey: secret
    });

    expect(sendRes.success).toBe(false);
    expect(sendRes.error).toContain('connector configured');
  });

  it('uses a durable approval store to prevent replay across registry instances', async () => {
    const registryOne = new ToolRegistry();
    const registryTwo = new ToolRegistry();
    registryOne.register(SendApprovedCommunicationTool);
    registryTwo.register(SendApprovedCommunicationTool);

    const secret = 'test-secret-key-32-chars-length!!';
    const payload = {
      recipient: '+62812345678',
      channel: 'whatsapp' as const,
      content: 'Hello Gym owner'
    };
    const approvalToken = TokenVerifier.generateToken(randomUUID(), 'communication.send_approved', payload, secret);
    const claimed = new Set<string>();
    const approvalExecutionStore = {
      claimExecution: vi.fn(async (token: any) => {
        if (claimed.has(token.signature)) return null;
        claimed.add(token.signature);
        return { id: token.requestId };
      }),
      getExecutionStatus: vi.fn(async () => 'executing'),
      finalizeExecution: vi.fn(async (id: string, result: { success: boolean }) => ({
        id,
        status: result.success ? 'executed' : 'revoked'
      }))
    };
    const sender = async () => ({
      messageId: 'provider-message-1',
      timestamp: new Date().toISOString(),
      recipient: payload.recipient
    });

    const first = await registryOne.execute('communication.send_approved', payload, {
      taskId: 'task-1',
      runId: 'run-1',
      agentId: 'hermes',
      externalWritesEnabled: true,
      approvalToken,
      approvalSecretKey: secret,
      approvalExecutionStore,
      communicationSender: sender
    });
    const replay = await registryTwo.execute('communication.send_approved', payload, {
      taskId: 'task-1',
      runId: 'run-1',
      agentId: 'hermes',
      externalWritesEnabled: true,
      approvalToken,
      approvalSecretKey: secret,
      approvalExecutionStore,
      communicationSender: sender
    });

    expect(first.success).toBe(true);
    expect(replay.success).toBe(false);
    expect(replay.error).toContain('already been claimed');
    expect(approvalExecutionStore.claimExecution).toHaveBeenCalledTimes(2);
    expect(approvalExecutionStore.finalizeExecution).toHaveBeenCalledTimes(1);
  });

  it('creates a durable approval request when a protected tool has no token', async () => {
    const registry = new ToolRegistry();
    registry.register(SendApprovedCommunicationTool);
    const approvalRequestStore = {
      requestApproval: vi.fn().mockResolvedValue({ id: '123e4567-e89b-12d3-a456-426614174003' })
    };

    const result = await registry.execute(
      'communication.send_approved',
      {
        recipient: '+62812345678',
        channel: 'whatsapp',
        content: 'Approval required'
      },
      {
        taskId: '123e4567-e89b-12d3-a456-426614174000',
        runId: '123e4567-e89b-12d3-a456-426614174001',
        agentId: 'hermes',
        externalWritesEnabled: true,
        approvalRequestStore
      }
    );

    expect(result.success).toBe(false);
    expect(result.approvalId).toBe('123e4567-e89b-12d3-a456-426614174003');
    expect(result.error).toContain('human approval');
    expect(approvalRequestStore.requestApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'communication.send_approved',
        taskId: '123e4567-e89b-12d3-a456-426614174000'
      })
    );
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
      evidence: { ...completeLeadEvidence, memberCount: '600 members', channels: 'WA, IG, FB' }
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
      evidence: { ...completeLeadEvidence, memberCount: '50 members' }
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

  it('does not qualify a lead when positive scores lack per-dimension evidence', () => {
    const result = RubricEngine.calculate({
      leadId: 'gym-evidence-gap',
      name: 'Evidence Gap Gym',
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
      evidence: {
        businessTypeFit: 'Fitness center confirmed'
      }
    });

    expect(result.totalScore).toBe(100);
    expect(result.evidenceComplete).toBe(false);
    expect(result.missingEvidence).toContain('channelCount');
    expect(result.status).toBe('needs_review');
  });

  it('supports registered rubric versions with validated weights and thresholds', () => {
    RubricEngine.register({
      ...DEFAULT_LEAD_RUBRIC,
      version: 'v2-test',
      maxScores: {
        ...DEFAULT_LEAD_RUBRIC.maxScores,
        businessTypeFit: 10,
        channelCount: 15
      },
      thresholds: {
        qualified: 70,
        needsReview: 40
      }
    });

    const result = RubricEngine.calculate(
      {
        leadId: 'gym-v2',
        name: 'Versioned Gym',
        category: 'Fitness Center',
        location: 'Palembang',
        scores: {
          businessTypeFit: 10,
          channelCount: 15,
          customerVolume: 10,
          memberRetentionNeed: 15,
          digitalPresenceQuality: 8,
          responsiveness: 8,
          csAutomationPotential: 10,
          broadcastPotential: 8,
          decisionMakerEase: 6,
          dataFreshness: 10
        },
        evidence: {
          businessTypeFit: 'Fitness center confirmed',
          channelCount: 'WhatsApp and Instagram confirmed',
          customerVolume: '600 members reported',
          memberRetentionNeed: 'Retention program identified',
          digitalPresenceQuality: 'Active digital profiles',
          responsiveness: 'Response time observed',
          csAutomationPotential: 'Manual support workflow identified',
          broadcastPotential: 'Broadcast audience confirmed',
          decisionMakerEase: 'Owner contact identified',
          dataFreshness: 'Observed this week'
        }
      },
      { rubricVersion: 'v2-test' }
    );

    expect(result.rubricVersion).toBe('v2-test');
    expect(result.totalScore).toBe(100);
    expect(result.evidenceComplete).toBe(true);
    expect(result.status).toBe('qualified');
  });

  it('hydrates persisted rubric versions and selects the active version atomically', () => {
    const activeRubric = {
      ...DEFAULT_LEAD_RUBRIC,
      version: 'v2-hydrated',
      thresholds: { qualified: 70, needsReview: 40 }
    };

    try {
      RubricEngine.hydrate([DEFAULT_LEAD_RUBRIC, activeRubric], activeRubric.version);

      expect(RubricEngine.getRubric()).toEqual(activeRubric);
      expect(RubricEngine.getRubric(DEFAULT_LEAD_RUBRIC.version)).toEqual(DEFAULT_LEAD_RUBRIC);
    } finally {
      RubricEngine.hydrate([DEFAULT_LEAD_RUBRIC], DEFAULT_LEAD_RUBRIC.version);
    }
  });

  it('rejects duplicate or missing active rubric versions without replacing the current set', () => {
    expect(() => RubricEngine.hydrate([DEFAULT_LEAD_RUBRIC, DEFAULT_LEAD_RUBRIC], DEFAULT_LEAD_RUBRIC.version)).toThrow(
      'is duplicated during hydration'
    );

    expect(RubricEngine.getRubric().version).toBe(DEFAULT_LEAD_RUBRIC.version);
    expect(() => RubricEngine.hydrate([DEFAULT_LEAD_RUBRIC], 'missing-version')).toThrow('is not present during hydration');
    expect(RubricEngine.getRubric().version).toBe(DEFAULT_LEAD_RUBRIC.version);
  });

  it('rejects malformed or unknown rubric versions', () => {
    expect(() =>
      RubricEngine.register({
        ...DEFAULT_LEAD_RUBRIC,
        version: 'invalid-total',
        maxScores: {
          ...DEFAULT_LEAD_RUBRIC.maxScores,
          businessTypeFit: 14
        }
      })
    ).toThrow('must sum to 100');

    expect(() => RubricEngine.getRubric('missing-version')).toThrow('is not registered');
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
      evidence: completeLeadEvidence
    });

    const csvMeta = artifactService.exportLeadsCsv([sampleLead], 'test_leads.csv');
    expect(csvMeta.sizeBytes).toBeGreaterThan(0);
    expect(artifactService.read('test_leads.csv')).toContain('Palembang Gym Center');

    const reportMeta = artifactService.exportScoringReport([sampleLead], 'test_report.md');
    expect(reportMeta.sizeBytes).toBeGreaterThan(0);
    expect(artifactService.read('test_report.md')).toContain('Lead Scoring & ICP Evaluation Report');
    expect(artifactService.read('test_report.md')).toContain('Rubric version: v1');
    expect(artifactService.read('test_report.md')).toContain('**Incomplete evidence:** 0 leads');
  });

  it('rejects artifact paths that escape the storage root', () => {
    const artifactService = new ArtifactService('./data/test-artifacts');

    expect(() => artifactService.save('../outside.txt', 'must not escape')).toThrow('storage root');
    expect(artifactService.read('../outside.txt')).toBeNull();
  });

  it('registers memory tools with scope and permission enforcement', async () => {
    const store = new InMemoryMemoryStore();
    const approvedId = randomUUID();
    const restrictedId = randomUUID();
    const now = new Date().toISOString();
    await store.save({
      id: approvedId,
      type: 'entity',
      status: 'verified',
      content: 'Approved research about Mega Gym',
      scope: 'approved_research',
      author: 'ned',
      source: 'research',
      confidence: 0.9,
      taskId: null,
      artifactId: null,
      metadata: {},
      expiresAt: null,
      createdAt: now,
      updatedAt: now
    });
    await store.save({
      id: restrictedId,
      type: 'policy',
      status: 'verified',
      content: 'Restricted security instruction',
      scope: 'restricted_security',
      author: 'system',
      source: 'policy',
      confidence: 1,
      taskId: null,
      artifactId: null,
      metadata: {},
      expiresAt: null,
      createdAt: now,
      updatedAt: now
    });

    const memoryTools = new MemoryTools(new MemoryRetriever(store), new MemoryProposalService(store), store);
    const registry = new ToolRegistry();
    for (const tool of createMemoryTools(memoryTools)) registry.register(tool);
    registry.register(CreateDraftTool);
    const context = {
      taskId: 'task-1',
      runId: 'run-1',
      agentId: 'ned',
      grantedScopes: ['approved_research'],
      allowedTools: ['memory.search', 'memory.get', 'memory.propose_write']
    };

    const search = await registry.execute('memory.search', { query: 'Mega', limit: 10 }, context);
    expect(search.success).toBe(true);
    expect((search.output as any).results).toHaveLength(1);
    expect((search.output as any).results[0].id).toBe(approvedId);

    const approved = await registry.execute('memory.get', { id: approvedId }, context);
    expect(approved.success).toBe(true);
    expect((approved.output as any).item.id).toBe(approvedId);

    const restricted = await registry.execute('memory.get', { id: restrictedId }, context);
    expect(restricted.success).toBe(true);
    expect((restricted.output as any).item).toBeNull();

    const proposal = await registry.execute(
      'memory.propose_write',
      {
        type: 'semantic',
        content: 'Must be rejected outside granted scope',
        scope: 'restricted_security'
      },
      context
    );
    expect(proposal.success).toBe(false);
    expect(proposal.error).toContain('not granted');

    const denied = await registry.execute('communication.create_draft', {}, context);
    expect(denied.success).toBe(false);
    expect(denied.error).toContain('not permitted');
  });
});
