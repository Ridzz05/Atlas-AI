import { describe, expect, it } from 'vitest';
import { SecondBrainService, isScopeReadable, ScopeGrant } from '../src/index.js';

/**
 * Scope containment must hold on EVERY read path, and an empty grant must not mean "everything".
 *
 * The rule was enforced in two places with two different answers:
 *
 * - `SecondBrainRetriever.search` built `readableScopes` only when `allowedScopes` was non-empty, and
 *   `null` meant no filter at all — so `getAllChunks(undefined)` returned every chunk in the vault.
 * - `SecondBrainService.listDocuments` had the same shape: `if (!allowed || allowed.length === 0)
 *   return documents;`.
 * - `getDocument` / `getDocumentByPath` took no scope argument at all, so
 *   `second_brain.read_note` — which six agents list — could read any note in any scope.
 *
 * `dataScopes` defaults to `[]` (shared/src/schemas/agent.ts), so "no grant" is a reachable state, and
 * it has to mean "global only" for an agent. The operator's HTTP surface is a different principal: it
 * holds the vault, so it reads everything — but that is a decision, and it is now stated as one
 * instead of falling out of a missing filter.
 */
const AGENT: ScopeGrant = { kind: 'agent', scopes: ['approved_research'] };
const EMPTY_AGENT: ScopeGrant = { kind: 'agent', scopes: [] };
const OPERATOR: ScopeGrant = { kind: 'operator' };

async function buildService() {
  const service = new SecondBrainService();

  await service.ingestDocument({
    id: '11111111-1111-4111-8111-111111111111',
    title: 'Approved research',
    filePath: 'research/approved.md',
    scope: 'approved_research',
    content: 'Mega Gym Palembang has 500 active members.'
  });
  await service.ingestDocument({
    id: '22222222-2222-4222-8222-222222222222',
    title: 'Financials',
    filePath: 'finance/secret.md',
    scope: 'financials',
    content: 'Gross margin for the quarter is 42 percent.'
  });
  await service.ingestDocument({
    id: '33333333-3333-4333-8333-333333333333',
    title: 'Shared note',
    filePath: 'shared/global.md',
    scope: 'global',
    content: 'The brand voice is direct and practical.'
  });

  return service;
}

describe('second brain scope containment', () => {
  it('lets an agent read a note inside its grant', async () => {
    const service = await buildService();

    const doc = service.getDocument('11111111-1111-4111-8111-111111111111', AGENT);

    expect(doc?.title).toBe('Approved research');
  });

  it('refuses a note outside the agent grant, by id and by path', async () => {
    const service = await buildService();

    expect(service.getDocument('22222222-2222-4222-8222-222222222222', AGENT)).toBeNull();
    expect(service.getDocumentByPath('finance/secret.md', AGENT)).toBeNull();
  });

  // The fail-open case: an agent with `dataScopes: []` must see global and nothing else.
  it('treats an empty agent grant as global-only, not as everything', async () => {
    const service = await buildService();

    expect(service.getDocument('33333333-3333-4333-8333-333333333333', EMPTY_AGENT)?.title).toBe('Shared note');
    expect(service.getDocument('11111111-1111-4111-8111-111111111111', EMPTY_AGENT)).toBeNull();
    expect(service.getDocument('22222222-2222-4222-8222-222222222222', EMPTY_AGENT)).toBeNull();

    const listed = service.listDocuments({ allowedScopes: [], grant: EMPTY_AGENT });
    expect(listed.map(d => d.scope)).toEqual(['global']);
  });

  it('filters search results by the grant, including when the grant is empty', async () => {
    const service = await buildService();

    const granted = await service.search({ query: 'gross margin quarter', allowedScopes: [], grant: AGENT });
    expect(granted.map(r => r.chunk.scope)).not.toContain('financials');

    const empty = await service.search({ query: 'gross margin quarter', allowedScopes: [], grant: EMPTY_AGENT });
    expect(empty.map(r => r.chunk.scope)).not.toContain('financials');
    expect(empty.map(r => r.chunk.scope)).not.toContain('approved_research');
  });

  it('lets the operator read every scope', async () => {
    const service = await buildService();

    expect(service.getDocument('22222222-2222-4222-8222-222222222222', OPERATOR)?.title).toBe('Financials');
    const listed = service.listDocuments({ grant: OPERATOR });
    expect(listed.map(d => d.scope).sort()).toEqual(['approved_research', 'financials', 'global']);
  });

  it('states the rule in one place', () => {
    expect(isScopeReadable('global', EMPTY_AGENT)).toBe(true);
    expect(isScopeReadable('financials', EMPTY_AGENT)).toBe(false);
    expect(isScopeReadable('financials', AGENT)).toBe(false);
    expect(isScopeReadable('approved_research', AGENT)).toBe(true);
    expect(isScopeReadable('financials', OPERATOR)).toBe(true);
  });
});
