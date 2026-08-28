import { describe, it, expect } from 'vitest';
import {
  MarkdownParser,
  VectorEmbeddingService,
  VaultIngestionService,
  SecondBrainRetriever,
  SecondBrainService
} from '../src/index.js';

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

      // Retrieve campaign note
      const searchResults = await retriever.search({
        query: 'fitness outreach celebrity gyms'
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

      const result = await service.queryGrounded('What is the maximum delegation depth for Chief?');

      expect(result.answer).toContain('Chief Orchestrator Blueprint');
      expect(result.answer).toContain('delegation depth of 2');
      expect(result.citations.length).toBeGreaterThan(0);
      expect(result.citations[0]?.noteTitle).toBe('Chief Orchestrator Blueprint');
      expect(result.sources[0]?.filePath).toBe('docs/chief.md');
    });
  });
});
