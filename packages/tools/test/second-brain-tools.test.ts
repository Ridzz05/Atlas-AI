import { describe, it, expect } from 'vitest';
import { SecondBrainService } from '@atlas/memory';
import { createSecondBrainTools } from '../src/tools/second-brain-tools.js';
import { ToolRegistry } from '../src/registry.js';
import { ToolContext } from '../src/types.js';

describe('Second Brain Tools Tests', () => {
  const service = new SecondBrainService({ provider: 'mock', dimension: 128 });
  const tools = createSecondBrainTools(service);
  const registry = new ToolRegistry();

  for (const tool of tools) {
    registry.registerLegacy(tool);
  }

  const mockContext: ToolContext = {
    agentId: 'chief',
    taskId: '123e4567-e89b-12d3-a456-426614174000',
    runId: '123e4567-e89b-12d3-a456-426614174001',
    allowedTools: [
      'second_brain.search',
      'second_brain.read_note',
      'second_brain.list_notes',
      'second_brain.query',
      'second_brain.sync_vault'
    ],
    grantedScopes: ['global', 'second_brain']
  };

  it('ingests note and searches via second_brain.search tool', async () => {
    await service.ingestDocument({
      title: 'Indonesian Gym Market',
      filePath: 'research/gyms-id.md',
      content: `---
title: "Indonesian Gym Market"
tags: [market, fitness, indonesia]
---

# Market Overview

Gym membership rates in Jakarta and Palembang average $30-$60 per month.
Celebrity Fitness and Fitness First are leading chains.`
    });

    const execRes = await registry.execute(
      'second_brain.search',
      { query: 'Jakarta gym membership rates', limit: 3 },
      mockContext
    );

    expect(execRes.success).toBe(true);
    const output = execRes.output as { results: any[] };
    expect(output.results.length).toBeGreaterThan(0);
    expect(output.results[0].documentTitle).toBe('Indonesian Gym Market');
    expect(output.results[0].citation.filePath).toBe('research/gyms-id.md');
  });

  it('reads note content and metadata via second_brain.read_note', async () => {
    const execRes = await registry.execute(
      'second_brain.read_note',
      { title: 'Indonesian Gym Market' },
      mockContext
    );

    expect(execRes.success).toBe(true);
    const output = execRes.output as { note: any };
    expect(output.note).not.toBeNull();
    expect(output.note.title).toBe('Indonesian Gym Market');
    expect(output.note.tags).toContain('fitness');
  });

  it('lists notes via second_brain.list_notes', async () => {
    const execRes = await registry.execute('second_brain.list_notes', { limit: 10 }, mockContext);

    expect(execRes.success).toBe(true);
    const output = execRes.output as { notes: any[]; totalCount: number };
    expect(output.totalCount).toBeGreaterThanOrEqual(1);
    expect(output.notes[0].title).toBe('Indonesian Gym Market');
  });

  it('synthesizes grounded response via second_brain.query', async () => {
    const execRes = await registry.execute(
      'second_brain.query',
      { query: 'How much are gym memberships in Jakarta?' },
      mockContext
    );

    expect(execRes.success).toBe(true);
    const output = execRes.output as { answer: string; citations: any[]; sources: any[] };
    expect(output.answer).toContain('Indonesian Gym Market');
    expect(output.citations.length).toBeGreaterThan(0);
  });
});
