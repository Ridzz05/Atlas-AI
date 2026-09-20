import { describe, it, expect } from 'vitest';
import { SecondBrainService } from '@atlas/memory';
import { createSecondBrainTools } from '../src/tools/second-brain-tools.js';
import { ToolRegistry } from '../src/registry.js';
import { ToolContext } from '../src/types.js';

describe('Second Brain tool containment', () => {
  /**
   * `second_brain.read_note` used to ignore its context entirely and call
   * `getDocument`/`getDocumentByPath`, neither of which took a scope — so an agent granted
   * `approved_research` could read a `financials` note while `second_brain.search` refused the same
   * note. Six agents list this tool.
   */
  async function build() {
    const service = new SecondBrainService({ provider: 'mock', dimension: 128 });
    await service.ingestDocument({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      title: 'Approved research',
      filePath: 'research/approved.md',
      scope: 'approved_research',
      content: 'Mega Gym Palembang has 500 active members.'
    });
    await service.ingestDocument({
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      title: 'Financials',
      filePath: 'finance/secret.md',
      scope: 'financials',
      content: 'Gross margin for the quarter is 42 percent.'
    });

    const registry = new ToolRegistry();
    for (const tool of createSecondBrainTools(service)) registry.registerLegacy(tool);
    return registry;
  }

  function context(scopes: string[]): ToolContext {
    return {
      agentId: 'ned',
      taskId: '123e4567-e89b-12d3-a456-426614174000',
      runId: '123e4567-e89b-12d3-a456-426614174001',
      allowedTools: ['second_brain.read_note', 'second_brain.list_notes', 'second_brain.sync_vault'],
      grantedScopes: scopes
    };
  }

  it('refuses a note outside the agent grant', async () => {
    const registry = await build();

    const result = await registry.execute(
      'second_brain.read_note',
      { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
      context(['approved_research'])
    );

    expect(result.success).toBe(true);
    expect((result.output as { note: unknown }).note).toBeNull();
  });

  it('reads a note inside the agent grant', async () => {
    const registry = await build();

    const result = await registry.execute(
      'second_brain.read_note',
      { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
      context(['approved_research'])
    );

    expect((result.output as { note: { title: string } | null }).note?.title).toBe('Approved research');
  });

  it('refuses to index vault content into a scope the agent was not granted', async () => {
    const registry = await build();

    const result = await registry.execute(
      'second_brain.sync_vault',
      { vaultPath: process.cwd(), scope: 'financials' },
      context(['approved_research'])
    );

    // The scope check runs before the path guard, so the refusal is about the scope.
    expect(result.success).toBe(false);
    expect(String(result.error)).toMatch(/not granted/i);
  });
});

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

    const execRes = await registry.execute('second_brain.search', { query: 'Jakarta gym membership rates', limit: 3 }, mockContext);

    expect(execRes.success).toBe(true);
    const output = execRes.output as { results: any[] };
    expect(output.results.length).toBeGreaterThan(0);
    expect(output.results[0].documentTitle).toBe('Indonesian Gym Market');
    expect(output.results[0].citation.filePath).toBe('research/gyms-id.md');
  });

  it('reads note content and metadata via second_brain.read_note', async () => {
    const execRes = await registry.execute('second_brain.read_note', { title: 'Indonesian Gym Market' }, mockContext);

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
    const execRes = await registry.execute('second_brain.query', { query: 'How much are gym memberships in Jakarta?' }, mockContext);

    expect(execRes.success).toBe(true);
    const output = execRes.output as { answer: string; citations: any[]; sources: any[] };
    expect(output.answer).toContain('Indonesian Gym Market');
    expect(output.citations.length).toBeGreaterThan(0);
  });

  // sync_vault passed the model-supplied vaultPath straight to a recursive directory walk and read
  // every .md/.markdown/.txt it found, with no root confinement — an arbitrary local file-read
  // primitive that also fed whatever it read into the retrievable knowledge base. Only the
  // configured vault root is accepted now.
  it('refuses a vaultPath outside the configured vault root', async () => {
    const outside = process.platform === 'win32' ? 'C:/Windows' : '/etc';

    const execRes = await registry.execute('second_brain.sync_vault', { vaultPath: outside }, mockContext);

    expect(execRes.success).toBe(false);
    expect(String(execRes.error)).toMatch(/vault root/i);
  });

  it('refuses a vaultPath that escapes the root via traversal', async () => {
    const execRes = await registry.execute('second_brain.sync_vault', { vaultPath: '../../..' }, mockContext);

    expect(execRes.success).toBe(false);
    expect(String(execRes.error)).toMatch(/vault root/i);
  });
});
