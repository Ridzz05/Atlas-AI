import { MemoryRetriever } from '../pipeline/retriever.js';
import { MemoryProposalService } from '../pipeline/proposal-service.js';
import { MemoryStore } from '../store/memory-store.js';
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

  public async get(input: { id: string }): Promise<{ item: any | null }> {
    const item = await this.store.findById(input.id);
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
  }): Promise<{ id: string; status: string; duplicate: boolean }> {
    const saved = await this.proposalService.propose(input);
    return {
      id: saved.id,
      status: saved.status,
      duplicate: false
    };
  }
}
