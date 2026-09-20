import { MemoryRetriever } from '../pipeline/retriever.js';
import { MemoryProposalService } from '../pipeline/proposal-service.js';
import { isMemoryExpired, MemoryStore } from '../store/memory-store.js';
import { MemoryType } from '@atlas/shared';

export class MemoryTools {
  constructor(
    private retriever: MemoryRetriever,
    private proposalService: MemoryProposalService,
    private store: MemoryStore
  ) {}

  public async search(input: {
    query: string;
    allowedScopes?: string[];
    types?: MemoryType[];
    limit?: number;
  }): Promise<{ results: Array<{ id: string; content: string; source: string; confidence: number; score: number }> }> {
    const ranked = await this.retriever.retrieve({
      query: input.query,
      allowedScopes: input.allowedScopes,
      types: input.types,
      status: 'verified',
      limit: input.limit || 5
    });

    return {
      results: ranked.map(r => ({
        id: r.item.id,
        content: r.item.content,
        source: r.item.source,
        confidence: r.item.confidence,
        score: r.score
      }))
    };
  }

  public async get(input: { id: string; allowedScopes?: string[] }): Promise<{ item: any | null }> {
    const item = await this.store.findById(input.id);
    if (item && isMemoryExpired(item)) {
      return { item: null };
    }
    // search() filters to verified memory, but get() did not, and findById filters only on expiry.
    // An agent that knew an id could therefore read the non-canonical proposal text that search had
    // just refused to show it. The verified-only rule has to hold on every agent-facing route.
    if (item && item.status !== 'verified') {
      return { item: null };
    }
    if (item && input.allowedScopes && item.scope !== 'global' && !input.allowedScopes.includes(item.scope)) {
      return { item: null };
    }
    return { item };
  }

  public async proposeWrite(input: {
    type: MemoryType;
    content: string;
    author: string;
    scope?: string;
    source?: string;
    confidence?: number;
    taskId?: string;
    allowedScopes?: string[];
  }): Promise<{ id: string; status: string; duplicate: boolean }> {
    const scope = input.scope || 'global';
    if (input.allowedScopes && scope !== 'global' && !input.allowedScopes.includes(scope)) {
      throw new Error(`Memory scope '${scope}' is not granted to this agent.`);
    }

    const saved = await this.proposalService.propose(input);
    return {
      id: saved.item.id,
      status: saved.item.status,
      duplicate: saved.duplicate
    };
  }
}
