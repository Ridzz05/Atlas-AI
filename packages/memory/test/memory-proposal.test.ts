import { describe, it, expect, vi } from 'vitest';
import { InMemoryMemoryStore, MemoryProposalService, MemoryRetriever, MemoryTools } from '../src/index.js';

/**
 * A proposal's result must describe what actually happened to it.
 *
 * `memory.propose_write` is the only way an agent can contribute to canonical memory, and its output
 * schema declares `duplicate: z.boolean()` precisely so the agent can tell whether its proposal
 * created anything. The tool returned `duplicate: false` unconditionally, so a proposal that matched
 * an existing item was reported as a new write — and when the match was a `verified` item, the same
 * response carried `status: 'verified'`, which reads as "your fact is now canonical".
 *
 * The same call also resolved duplicates against items of ANY status, so a proposal whose content
 * had already been deprecated returned the deprecated record: the proposal vanished into a rejected
 * item, and nothing new appeared for a human to review.
 */
function buildTools() {
  const store = new InMemoryMemoryStore();
  const proposalService = new MemoryProposalService(store, { record: vi.fn() } as never);
  const retriever = new MemoryRetriever(store);
  return { store, proposalService, tools: new MemoryTools(retriever, proposalService, store) };
}

const content = 'Mega Gym Palembang has 500 active members';

describe('memory proposal reporting', () => {
  it('reports a first proposal as new', async () => {
    const { tools } = buildTools();

    const result = await tools.proposeWrite({ type: 'entity', content, author: 'ned', scope: 'approved_research' });

    expect(result.duplicate).toBe(false);
    expect(result.status).toBe('unverified');
  });

  it('reports an exact repeat as a duplicate instead of a new write', async () => {
    const { tools } = buildTools();
    await tools.proposeWrite({ type: 'entity', content, author: 'ned', scope: 'approved_research' });

    const repeat = await tools.proposeWrite({ type: 'entity', content, author: 'layla', scope: 'approved_research' });

    expect(repeat.duplicate).toBe(true);
  });

  it('reports a repeat of an already-verified fact as a duplicate, and keeps the id', async () => {
    const { tools, proposalService } = buildTools();
    const first = await tools.proposeWrite({ type: 'entity', content, author: 'ned', scope: 'approved_research' });
    await proposalService.verify(first.id);

    const repeat = await tools.proposeWrite({ type: 'entity', content, author: 'layla', scope: 'approved_research' });

    expect(repeat.duplicate).toBe(true);
    expect(repeat.id).toBe(first.id);
  });

  // A deprecation is a decision about one record, not about the content forever. Resolving a new
  // proposal to the deprecated record silently discards it.
  it('creates a new proposal when the matching content was deprecated', async () => {
    const { tools, proposalService } = buildTools();
    const first = await tools.proposeWrite({ type: 'entity', content, author: 'ned', scope: 'approved_research' });
    await proposalService.deprecate(first.id);

    const reproposed = await tools.proposeWrite({ type: 'entity', content, author: 'ned', scope: 'approved_research' });

    expect(reproposed.id).not.toBe(first.id);
    expect(reproposed.status).toBe('unverified');
    expect(reproposed.duplicate).toBe(false);
  });

  it('still refuses to create a second unverified proposal for the same content', async () => {
    const { tools, store } = buildTools();
    await tools.proposeWrite({ type: 'entity', content, author: 'ned', scope: 'approved_research' });
    await tools.proposeWrite({ type: 'entity', content, author: 'ned', scope: 'approved_research' });

    const items = await store.search({ scopes: ['approved_research'] });
    expect(items.filter(item => item.content === content)).toHaveLength(1);
  });
});
