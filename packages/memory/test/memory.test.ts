import { describe, it, expect } from 'vitest';
import {
  InMemoryMemoryStore,
  MemoryRetriever,
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

  it('manages memory proposal, deduplication, verification, and deprecation lifecycle', async () => {
    const store = new InMemoryMemoryStore();
    const proposalService = new MemoryProposalService(store);

    // 1. Propose memory
    const proposed = await proposalService.propose({
      type: 'entity',
      content: 'Mega Gym Palembang has 500 active members',
      author: 'ned',
      scope: 'approved_research',
      confidence: 0.85
    });

    expect(proposed.status).toBe('unverified');

    // 2. Exact duplicate proposal returns existing item
    const duplicate = await proposalService.propose({
      type: 'entity',
      content: 'Mega Gym Palembang has 500 active members',
      author: 'layla',
      scope: 'approved_research'
    });

    expect(duplicate.id).toBe(proposed.id);

    // 3. Promote to verified
    const verified = await proposalService.verify(proposed.id);
    expect(verified?.status).toBe('verified');

    // 4. Deprecate
    const deprecated = await proposalService.deprecate(proposed.id);
    expect(deprecated?.status).toBe('deprecated');
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

    // Search tool
    const searchResult = await tools.search({
      query: 'playbook rule respond'
    });

    expect(searchResult.results.length).toBe(1);
    expect(searchResult.results[0]?.content).toContain('CRM playbook rule #1');
  });
});
