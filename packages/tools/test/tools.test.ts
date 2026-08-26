import { describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  ToolRegistry,
  WebSearchTool,
  CompanyLookupTool,
  CreateDraftTool,
  SendApprovedCommunicationTool,
  createArtifactTools,
  ArtifactService,
  RubricEngine,
  LeadScoringInput,
  createMemoryTools
} from '../src/index.js';
import { TokenVerifier } from '@atlas/policy';
import { InMemoryMemoryStore, MemoryRetriever, MemoryProposalService, MemoryTools } from '@atlas/memory';

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

    const result = await registry.execute('test.malformed_output', {}, {
      taskId: 'task-1',
      runId: 'run-1',
      agentId: 'argus'
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid output from tool 'test.malformed_output'");
  });

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
    expect((searchRes.output as any).configured).toBe(false);
    expect((searchRes.output as any).results).toEqual([]);
    expect((searchRes.output as any).warning).toContain('No verified research provider');

    const companyRes = await registry.execute('company.lookup', { companyName: 'Unknown Gym' }, {
      taskId: 'task-1',
      runId: 'run-1',
      agentId: 'ned'
    });
    expect(companyRes.success).toBe(true);
    expect((companyRes.output as any).found).toBe(false);
    expect((companyRes.output as any).configured).toBe(false);
  });

  it('blocks communication.send_approved if approval token is missing', async () => {
    const registry = new ToolRegistry();
    registry.register(SendApprovedCommunicationTool);

    const sendRes = await registry.execute('communication.send_approved', {
      recipient: '+62812345678',
      channel: 'whatsapp',
      content: 'Hello Gym owner',
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
    const secret = 'test-secret-key-32-chars-length!!';
    const payload = {
      recipient: '+62812345678',
      channel: 'whatsapp' as const,
      content: 'Hello Gym owner'
    };
    const approvalToken = TokenVerifier.generateToken(
      randomUUID(),
      'communication.send_approved',
      payload,
      secret
    );
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

    const sendRes = await registry.execute('communication.send_approved', {
      recipient: '+62812345678',
      channel: 'whatsapp',
      content: 'Tampered copy'
    }, {
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
    });

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
    const approvalToken = TokenVerifier.generateToken(
      randomUUID(),
      'communication.send_approved',
      payload,
      secret
    );

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
    const approvalToken = TokenVerifier.generateToken(
      randomUUID(),
      'communication.send_approved',
      payload,
      secret
    );
    const claimed = new Set<string>();
    const approvalExecutionStore = {
      claimExecution: vi.fn(async (token: any) => {
        if (claimed.has(token.signature)) return null;
        claimed.add(token.signature);
        return { id: token.requestId };
      }),
      getExecutionStatus: vi.fn(async () => 'executing'),
      finalizeExecution: vi.fn(async (id: string, result: { success: boolean }) => ({ id, status: result.success ? 'executed' : 'revoked' }))
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

    const result = await registry.execute('communication.send_approved', {
      recipient: '+62812345678',
      channel: 'whatsapp',
      content: 'Approval required'
    }, {
      taskId: '123e4567-e89b-12d3-a456-426614174000',
      runId: '123e4567-e89b-12d3-a456-426614174001',
      agentId: 'hermes',
      externalWritesEnabled: true,
      approvalRequestStore
    });

    expect(result.success).toBe(false);
    expect(result.approvalId).toBe('123e4567-e89b-12d3-a456-426614174003');
    expect(result.error).toContain('human approval');
    expect(approvalRequestStore.requestApproval).toHaveBeenCalledWith(expect.objectContaining({
      action: 'communication.send_approved',
      taskId: '123e4567-e89b-12d3-a456-426614174000'
    }));
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

    const memoryTools = new MemoryTools(
      new MemoryRetriever(store),
      new MemoryProposalService(store),
      store
    );
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

    const proposal = await registry.execute('memory.propose_write', {
      type: 'semantic',
      content: 'Must be rejected outside granted scope',
      scope: 'restricted_security'
    }, context);
    expect(proposal.success).toBe(false);
    expect(proposal.error).toContain('not granted');

    const denied = await registry.execute('communication.create_draft', {}, context);
    expect(denied.success).toBe(false);
    expect(denied.error).toContain('not permitted');
  });
});
