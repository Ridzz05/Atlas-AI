import { describe, it, expect, vi } from 'vitest';
import {
  InMemoryMemoryStore,
  DatabaseMemoryStore,
  MemoryRetriever,
  MemoryMaintenanceService,
  MemoryProposalService,
  MemoryTools
} from '../src/index.js';

describe('@atlas/memory tests', () => {
  it('stores and retrieves memory items across scopes and types', async () => {
    const store = new InMemoryMemoryStore();
    const retriever = new MemoryRetriever(store);

    const mem1Id = crypto.randomUUID();
    const mem2Id = crypto.randomUUID();
    const mem3Id = crypto.randomUUID();

    await store.save({
      id: mem1Id,
      type: 'semantic',
      status: 'verified',
      content: 'ATLAS AI OS uses TypeScript and Fastify architecture.',
      scope: 'business_knowledge',
      author: 'chief',
      source: 'blueprint',
      confidence: 1.0,
      taskId: null,
      artifactId: null,
      metadata: {},
      expiresAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    await store.save({
      id: mem2Id,
      type: 'entity',
      status: 'verified',
      content: 'Celebrity Fitness Palembang is a candidate gym lead.',
      scope: 'approved_research',
      author: 'ned',
      source: 'web.search',
      confidence: 0.9,
      taskId: null,
      artifactId: null,
      metadata: {},
      expiresAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    await store.save({
      id: mem3Id,
      type: 'policy',
      status: 'verified',
      content: 'Financial transfers require owner approval.',
      scope: 'restricted_security',
      author: 'system',
      source: 'policy',
      confidence: 1.0,
      taskId: null,
      artifactId: null,
      metadata: {},
      expiresAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    // 1. Agent with 'business_knowledge' scope should NOT see 'restricted_security'
    const results = await retriever.retrieve({
      query: 'TypeScript',
      allowedScopes: ['business_knowledge']
    });

    expect(results.length).toBe(1);
    expect(results[0]?.item.id).toBe(mem1Id);
    expect(results[0]?.score).toBeGreaterThan(0.5);

    // 2. Query matching entity
    const gymResults = await retriever.retrieve({
      query: 'Celebrity Fitness gym',
      allowedScopes: ['approved_research']
    });

    expect(gymResults.length).toBe(1);
    expect(gymResults[0]?.item.id).toBe(mem2Id);
  });

  it('handles token budget limiting on retrieval', async () => {
    const store = new InMemoryMemoryStore();
    const retriever = new MemoryRetriever(store);

    // Add 10 items
    for (let i = 1; i <= 10; i++) {
      await store.save({
        id: crypto.randomUUID(),
        type: 'semantic',
        status: 'verified',
        content: `Long knowledge documentation paragraph number ${i} containing valuable facts about the system operations.`,
        scope: 'global',
        author: 'system',
        source: 'manual',
        confidence: 0.9,
        taskId: null,
        artifactId: null,
        metadata: {},
        expiresAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    }

    // Token budget restricted to ~25 tokens (approx 1-2 items)
    const results = await retriever.retrieve({
      query: 'knowledge documentation',
      tokenBudget: 30
    });

    expect(results.length).toBeLessThanOrEqual(2);
  });

  // The budget loop `break`s on the first item that does not fit, but the list is score-ordered, so
  // one large top-ranked item discarded every smaller item behind it — the retrieval context came
  // back empty even though a short, specific fact would have fit.
  it('keeps smaller items that fit when a larger ranked item does not', async () => {
    const store = new InMemoryMemoryStore();
    const retriever = new MemoryRetriever(store);

    await store.save({
      id: crypto.randomUUID(),
      type: 'semantic',
      status: 'verified',
      content: `huge report ${'x'.repeat(4000)}`,
      scope: 'global',
      author: 'system',
      source: 'manual',
      confidence: 1,
      taskId: null,
      artifactId: null,
      metadata: {},
      expiresAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    await store.save({
      id: crypto.randomUUID(),
      type: 'semantic',
      status: 'verified',
      content: 'huge report short fact',
      scope: 'global',
      author: 'system',
      source: 'manual',
      confidence: 0.5,
      taskId: null,
      artifactId: null,
      metadata: {},
      expiresAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    const results = await retriever.retrieve({ query: 'huge report', tokenBudget: 50 });

    expect(results.length).toBeGreaterThan(0);
    expect(results.some(r => r.item.content === 'huge report short fact')).toBe(true);
  });

  it('manages memory proposal, deduplication, verification, and deprecation lifecycle', async () => {
    const store = new InMemoryMemoryStore();
    const auditSink = { record: vi.fn().mockResolvedValue(undefined) };
    const proposalService = new MemoryProposalService(store, auditSink);

    // 1. Propose memory
    const proposed = await proposalService.propose({
      type: 'entity',
      content: 'Mega Gym Palembang has 500 active members',
      author: 'ned',
      scope: 'approved_research',
      confidence: 0.85
    });

    expect(proposed.item.status).toBe('unverified');
    expect(proposed.duplicate).toBe(false);

    // 2. Exact duplicate proposal returns existing item
    const duplicate = await proposalService.propose({
      type: 'entity',
      content: 'Mega Gym Palembang has 500 active members',
      author: 'layla',
      scope: 'approved_research'
    });

    // A duplicate is reported as one, and returns the item it matched.
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.item.id).toBe(proposed.item.id);

    // 3. Promote to verified
    const verified = await proposalService.verify(proposed.item.id);
    expect(verified?.status).toBe('verified');

    // 4. Deprecate
    const deprecated = await proposalService.deprecate(proposed.item.id);
    expect(deprecated?.status).toBe('deprecated');
    expect(auditSink.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'memory.verified',
        target: proposed.item.id
      })
    );
    expect(auditSink.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'memory.deprecated',
        target: proposed.item.id
      })
    );
  });

  it('does not retrieve or expose expired memory items', async () => {
    const store = new InMemoryMemoryStore();
    const retriever = new MemoryRetriever(store);
    const proposalService = new MemoryProposalService(store);
    const tools = new MemoryTools(retriever, proposalService, store);
    const expiredId = crypto.randomUUID();
    const activeId = crypto.randomUUID();
    const now = Date.now();

    await store.save({
      id: expiredId,
      type: 'semantic',
      status: 'verified',
      content: 'Expired CRM policy fact',
      scope: 'global',
      author: 'system',
      source: 'policy',
      confidence: 1,
      taskId: null,
      artifactId: null,
      metadata: {},
      expiresAt: new Date(now - 1_000).toISOString(),
      createdAt: new Date(now - 86_400_000).toISOString(),
      updatedAt: new Date(now - 86_400_000).toISOString()
    });
    await store.save({
      id: activeId,
      type: 'semantic',
      status: 'verified',
      content: 'Active CRM policy fact',
      scope: 'global',
      author: 'system',
      source: 'policy',
      confidence: 1,
      taskId: null,
      artifactId: null,
      metadata: {},
      expiresAt: new Date(now + 86_400_000).toISOString(),
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString()
    });

    const results = await retriever.retrieve({ query: 'CRM policy fact', status: 'verified' });
    expect(results.map(result => result.item.id)).toEqual([activeId]);

    expect(await store.findById(expiredId)).toBeNull();
    const expired = await tools.get({ id: expiredId });
    expect(expired.item).toBeNull();
  });

  it('enforces expiry in direct database lookups', async () => {
    const db = {
      query: vi.fn(async (sql: string) => {
        expect(sql).toContain('expires_at IS NULL OR expires_at > NOW()');
        return { rows: [] };
      })
    };
    const store = new DatabaseMemoryStore(db as any);

    expect(await store.findById(crypto.randomUUID())).toBeNull();
    expect(db.query).toHaveBeenCalledOnce();
  });

  it('lists expired database memory rows for maintenance', async () => {
    const now = new Date('2026-08-26T00:00:00.000Z');
    const db = {
      query: vi.fn().mockResolvedValue({ rows: [{ id: '123e4567-e89b-12d3-a456-426614174000' }] })
    };
    const store = new DatabaseMemoryStore(db as any);

    const expired = await store.listExpired({ now, limit: 25 });

    expect(expired).toHaveLength(1);
    expect(expired[0]?.id).toBe('123e4567-e89b-12d3-a456-426614174000');
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('expires_at IS NOT NULL'), [now, 25]);
  });

  it('allows a fresh proposal after an identical memory item expires', async () => {
    const store = new InMemoryMemoryStore();
    const proposalService = new MemoryProposalService(store);

    await store.save({
      id: crypto.randomUUID(),
      type: 'entity',
      status: 'verified',
      content: 'Temporary gym member count',
      scope: 'approved_research',
      author: 'ned',
      source: 'web.search',
      confidence: 0.8,
      taskId: null,
      artifactId: null,
      metadata: {},
      expiresAt: new Date(Date.now() - 1_000).toISOString(),
      createdAt: new Date(Date.now() - 86_400_000).toISOString(),
      updatedAt: new Date(Date.now() - 86_400_000).toISOString()
    });

    const proposal = await proposalService.propose({
      type: 'entity',
      content: 'Temporary gym member count',
      scope: 'approved_research',
      author: 'ned'
    });

    expect(proposal.item.status).toBe('unverified');
  });

  it('maintains expired memory and audits canonical lifecycle changes', async () => {
    const store = new InMemoryMemoryStore();
    const auditSink = { record: vi.fn().mockResolvedValue(undefined) };
    const maintenance = new MemoryMaintenanceService(store, auditSink);
    const now = new Date('2026-08-26T00:00:00.000Z');
    const expiredVerifiedId = crypto.randomUUID();
    const expiredDeprecatedId = crypto.randomUUID();
    const expiredAt = new Date('2026-08-25T00:00:00.000Z').toISOString();

    await store.save({
      id: expiredVerifiedId,
      type: 'semantic',
      status: 'verified',
      content: 'Expired verified fact',
      scope: 'global',
      author: 'system',
      source: 'policy',
      confidence: 1,
      taskId: null,
      artifactId: null,
      metadata: {},
      expiresAt: expiredAt,
      createdAt: new Date('2026-08-01T00:00:00.000Z').toISOString(),
      updatedAt: new Date('2026-08-01T00:00:00.000Z').toISOString()
    });
    await store.save({
      id: expiredDeprecatedId,
      type: 'semantic',
      status: 'deprecated',
      content: 'Expired deprecated fact',
      scope: 'global',
      author: 'system',
      source: 'policy',
      confidence: 1,
      taskId: null,
      artifactId: null,
      metadata: {},
      expiresAt: expiredAt,
      createdAt: new Date('2026-07-01T00:00:00.000Z').toISOString(),
      updatedAt: new Date('2026-07-01T00:00:00.000Z').toISOString()
    });

    const result = await maintenance.run({ now, deletionGraceDays: 7 });

    expect(result).toEqual({ inspected: 2, deprecated: 1, deleted: 1 });
    expect(await store.findById(expiredVerifiedId)).toBeNull();
    expect(await store.findById(expiredDeprecatedId)).toBeNull();
    expect(auditSink.record).toHaveBeenCalledTimes(2);
    expect(auditSink.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'memory.deprecated',
        target: expiredVerifiedId
      })
    );
    expect(auditSink.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'memory.deleted',
        target: expiredDeprecatedId
      })
    );
  });

  it('supports privacy deletion by scope', async () => {
    const store = new InMemoryMemoryStore();
    const privId = crypto.randomUUID();

    await store.save({
      id: privId,
      type: 'entity',
      status: 'verified',
      content: 'Client A confidential note',
      scope: 'client_a',
      author: 'user',
      source: 'chat',
      confidence: 1.0,
      taskId: null,
      artifactId: null,
      metadata: {},
      expiresAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    const deletedCount = await store.deleteByScope('client_a');
    expect(deletedCount).toBe(1);

    const found = await store.findById(privId);
    expect(found).toBeNull();
  });

  it('executes MemoryTools correctly', async () => {
    const store = new InMemoryMemoryStore();
    const retriever = new MemoryRetriever(store);
    const proposalService = new MemoryProposalService(store);
    const tools = new MemoryTools(retriever, proposalService, store);

    // Propose write
    const propResult = await tools.proposeWrite({
      type: 'semantic',
      content: 'CRM playbook rule #1: Always respond within 5 minutes',
      author: 'layla',
      scope: 'global'
    });

    expect(propResult.id).toBeDefined();
    expect(propResult.status).toBe('unverified');

    const hiddenBeforeVerification = await tools.search({
      query: 'playbook rule respond'
    });
    expect(hiddenBeforeVerification.results).toEqual([]);

    await proposalService.verify(propResult.id);

    // Search tool
    const searchResult = await tools.search({
      query: 'playbook rule respond'
    });

    expect(searchResult.results.length).toBe(1);
    expect(searchResult.results[0]?.content).toContain('CRM playbook rule #1');
  });

  it('does not expose unverified memory through the agent search tool', async () => {
    const store = new InMemoryMemoryStore();
    const tools = new MemoryTools(new MemoryRetriever(store), new MemoryProposalService(store), store);

    await store.save({
      id: crypto.randomUUID(),
      type: 'semantic',
      status: 'unverified',
      content: 'Unverified customer claim',
      scope: 'global',
      author: 'ned',
      source: 'research',
      confidence: 0.2,
      taskId: null,
      artifactId: null,
      metadata: {},
      expiresAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    const result = await tools.search({ query: 'customer claim' });

    expect(result.results).toEqual([]);
  });

  // The verified-only rule was enforced in search() but not in get(), and findById filters only on
  // expiry — so an agent that knew (or guessed) an id could read the non-canonical proposal text
  // that search had just refused to show it. An agent must not be able to reach unverified memory
  // by a second route.
  it('does not expose unverified memory through the agent direct-lookup tool either', async () => {
    const store = new InMemoryMemoryStore();
    const tools = new MemoryTools(new MemoryRetriever(store), new MemoryProposalService(store), store);
    const id = crypto.randomUUID();

    await store.save({
      id,
      type: 'semantic',
      status: 'unverified',
      content: 'UNVERIFIED CLAIM that must not surface',
      scope: 'global',
      author: 'ned',
      source: 'research',
      confidence: 0.2,
      taskId: null,
      artifactId: null,
      metadata: {},
      expiresAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    const direct = await tools.get({ id });

    expect(direct.item).toBeNull();
  });

  it('still returns verified memory through the direct-lookup tool', async () => {
    const store = new InMemoryMemoryStore();
    const tools = new MemoryTools(new MemoryRetriever(store), new MemoryProposalService(store), store);
    const id = crypto.randomUUID();

    await store.save({
      id,
      type: 'semantic',
      status: 'verified',
      content: 'Canonical fact',
      scope: 'global',
      author: 'chief',
      source: 'owner',
      confidence: 0.9,
      taskId: null,
      artifactId: null,
      metadata: {},
      expiresAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    const direct = await tools.get({ id });

    expect(direct.item).not.toBeNull();
    expect(direct.item.content).toBe('Canonical fact');
  });
});
