import { describe, it, expect } from 'vitest';
import { MarkdownParser, VectorEmbeddingService, VaultIngestionService, SecondBrainRetriever, SecondBrainService } from '../src/index.js';

describe('Second Brain Subsystem Tests', () => {
  describe('MarkdownParser', () => {
    it('parses frontmatter, tags, links, and headers accurately', () => {
      const markdown = `---
title: "ATLAS Personal AI Architecture"
tags: [ai, os, personal-assistant]
author: "Chief"
---

# Architecture Overview

ATLAS AI OS is a multi-agent system powered by [[Chief]] and [[Ned]].

## Memory Subsystem

The memory system integrates #vector-search and #knowledge-graphs with [[Obsidian Vaults]].
`;

      const parsed = MarkdownParser.parse(markdown);

      expect(parsed.title).toBe('ATLAS Personal AI Architecture');
      expect(parsed.frontmatter.author).toBe('Chief');
      expect(parsed.tags).toContain('ai');
      expect(parsed.tags).toContain('os');
      expect(parsed.tags).toContain('vector-search');
      expect(parsed.tags).toContain('knowledge-graphs');
      expect(parsed.links).toContain('Chief');
      expect(parsed.links).toContain('Ned');
      expect(parsed.links).toContain('Obsidian Vaults');
      expect(parsed.sections.length).toBeGreaterThanOrEqual(2);
    });

    it('chunks documents preserving section headers and token boundaries', () => {
      const markdown = `---
title: "Lead Generation Playbook"
---

# Section 1: Inbound
Inbound leads are qualified through website forms and lead scoring rubrics.

# Section 2: Outbound Research
Ned executes safe search queries to discover gyms and fitness studios across Indonesia.
`;

      const parsed = MarkdownParser.parse(markdown);
      const chunks = MarkdownParser.chunkDocument(parsed, { maxTokensPerChunk: 50 });

      expect(chunks.length).toBeGreaterThanOrEqual(2);
      expect(chunks[0]?.content).toContain('Section 1');
      expect(chunks[1]?.content).toContain('Section 2');
    });
  });

  describe('VectorEmbeddingService', () => {
    it('computes accurate cosine similarity between vectors', () => {
      const vecA = [1, 0, 0];
      const vecB = [1, 0, 0];
      const vecC = [0, 1, 0];

      expect(VectorEmbeddingService.cosineSimilarity(vecA, vecB)).toBeCloseTo(1.0);
      expect(VectorEmbeddingService.cosineSimilarity(vecA, vecC)).toBeCloseTo(0.0);
    });

    it('generates deterministic semantic vectors in mock mode and caches results', async () => {
      const service = new VectorEmbeddingService({ provider: 'mock', dimension: 128 });
      const vec1 = await service.embed('Personal AI Assistant');
      const vec2 = await service.embed('Personal AI Assistant');
      const vec3 = await service.embed('Completely Unrelated Cooking Recipe');

      expect(vec1.length).toBe(128);
      expect(vec1).toEqual(vec2);

      const simSimilar = VectorEmbeddingService.cosineSimilarity(vec1, vec2);
      const simDifferent = VectorEmbeddingService.cosineSimilarity(vec1, vec3);

      expect(simSimilar).toBeCloseTo(1.0);
      expect(simSimilar).toBeGreaterThan(simDifferent);
    });
  });

  describe('VaultIngestionService & SecondBrainRetriever', () => {
    it('ingests documents, hashes content, and retrieves with traceable citations', async () => {
      const embeddingService = new VectorEmbeddingService({ provider: 'mock', dimension: 128 });
      const vault = new VaultIngestionService(embeddingService);
      const retriever = new SecondBrainRetriever(vault, embeddingService);

      // Ingest note 1
      const doc1 = await vault.ingestDocument({
        title: 'Gym Outreach Campaign',
        filePath: 'campaigns/gyms.md',
        content: `---
title: "Gym Outreach Campaign"
tags: [sales, leads, fitness]
---

# Fitness Outreach

Target celebrity fitness and local gyms with custom WhatsApp and email pitches.
Always verify gym member count with [[Ned]] before generating copy with [[Hermes]].`
      });

      // Ingest note 2
      const doc2 = await vault.ingestDocument({
        title: 'Risk & Compliance Policy',
        filePath: 'policies/risk.md',
        content: `---
title: "Risk & Compliance Policy"
tags: [compliance, security]
---

# External Writes Gate

All outbound messages require explicit human approval token before sending.`
      });

      expect(doc1.id).toBeDefined();
      expect(doc2.id).toBeDefined();

      const stats = vault.getStats();
      expect(stats.totalDocuments).toBe(2);
      expect(stats.totalChunks).toBeGreaterThanOrEqual(2);

      // Retrieve campaign note.
      //
      // The principal is stated because containment is now enforced on every path: these notes are in
      // the `second_brain` scope, and a search with no grant reads global notes only. This test is
      // about retrieval and citation tracing, so it reads as the vault owner.
      const searchResults = await retriever.search({
        query: 'fitness outreach celebrity gyms',
        grant: { kind: 'operator' }
      });

      expect(searchResults.length).toBeGreaterThanOrEqual(1);
      const topHit = searchResults[0]!;
      expect(topHit.chunk.documentTitle).toBe('Gym Outreach Campaign');
      expect(topHit.citation.noteTitle).toBe('Gym Outreach Campaign');
      expect(topHit.citation.filePath).toBe('campaigns/gyms.md');
      expect(topHit.citation.relevanceScore).toBeGreaterThan(0.2);
    });

    it('skips re-indexing when content hash has not changed', async () => {
      const embeddingService = new VectorEmbeddingService({ provider: 'mock', dimension: 128 });
      const vault = new VaultIngestionService(embeddingService);

      const content = '# Static Note\nThis note does not change.';
      const doc1 = await vault.ingestDocument({
        id: 'static-note',
        filePath: 'notes/static.md',
        content
      });

      const doc2 = await vault.ingestDocument({
        id: 'static-note',
        filePath: 'notes/static.md',
        content
      });

      expect(doc1.contentHash).toBe(doc2.contentHash);
      expect(doc1.createdAt).toBe(doc2.createdAt);
    });

    // A `#` line inside a fenced code block is a shell comment. extractSections matched it as a
    // heading, so a code block was split across chunks and the tail carried a heading the note does
    // not contain — citations then showed half a block under a fabricated title.
    it('does not treat a comment inside a fenced code block as a heading', () => {
      const parsed = MarkdownParser.parse('# Note\n\n```bash\n# install deps\nnpm install\n```\n\nDone.');

      const headings = parsed.sections.map(section => section.heading);
      expect(headings).toEqual(['Note']);
      expect(parsed.sections[0]?.content).toContain('npm install');
      expect(headings).not.toContain('install deps');
    });

    // `allowedScopes` was declared on SecondBrainQueryOptions but never read, and search() passed
    // the caller-supplied `scope` straight to getAllChunks — which returns EVERY chunk when the
    // scope is omitted. So an agent could read notes outside its granted data scopes either by
    // omitting the scope or by naming one it was never granted. The memory tools pass
    // ctx.grantedScopes; the second-brain path passed nothing.
    it('never returns chunks outside the caller granted scopes', async () => {
      const embeddingService = new VectorEmbeddingService({ provider: 'mock', dimension: 128 });
      const vault = new VaultIngestionService(embeddingService);
      const retriever = new SecondBrainRetriever(vault, embeddingService);

      await vault.ingestDocument({
        id: 'client-a-note',
        filePath: 'clients/client_a.md',
        content: '# Client A\nRestricted security finding about client A credentials.',
        scope: 'restricted_security'
      });
      await vault.ingestDocument({
        id: 'shared-note',
        filePath: 'notes/shared.md',
        content: '# Shared\nGeneral shared knowledge about credentials handling.',
        scope: 'second_brain'
      });

      const granted = ['second_brain'];

      // Omitting the scope must not widen the result set.
      const withoutScope = await retriever.search({ query: 'credentials', allowedScopes: granted });
      expect(withoutScope.every(hit => hit.chunk.scope === 'second_brain' || hit.chunk.scope === 'global')).toBe(true);
      expect(withoutScope.some(hit => hit.chunk.documentId === 'client-a-note')).toBe(false);

      // Naming a scope that was never granted must not be honoured either.
      const foreignScope = await retriever.search({ query: 'credentials', scope: 'restricted_security', allowedScopes: granted });
      expect(foreignScope).toEqual([]);

      // A granted scope still works.
      const ownScope = await retriever.search({ query: 'credentials', scope: 'second_brain', allowedScopes: granted });
      expect(ownScope.some(hit => hit.chunk.documentId === 'shared-note')).toBe(true);
    });
  });

  describe('SecondBrainService', () => {
    it('executes full grounded RAG query synthesis with citations', async () => {
      const service = new SecondBrainService({ provider: 'mock', dimension: 128 });

      await service.ingestDocument({
        title: 'Chief Orchestrator Blueprint',
        filePath: 'docs/chief.md',
        content: `---
title: "Chief Orchestrator Blueprint"
tags: [architecture, chief]
---

# Delegation Depth Limit

Chief enforces a hard maximum delegation depth of 2 turns to prevent infinite recursive subtask spawning.
Specialists include Ned (Research), Layla (Scoring), Hermes (Content), and Argus (QA).`
      });

      // Same reason as above: the note is scoped, so the query states who is asking.
      const result = await service.queryGrounded('What is the maximum delegation depth for Chief?', {
        grant: { kind: 'operator' }
      });

      expect(result.answer).toContain('Chief Orchestrator Blueprint');
      expect(result.answer).toContain('delegation depth of 2');
      expect(result.citations.length).toBeGreaterThan(0);
      expect(result.citations[0]?.noteTitle).toBe('Chief Orchestrator Blueprint');
      expect(result.sources[0]?.filePath).toBe('docs/chief.md');
    });
  });
});
