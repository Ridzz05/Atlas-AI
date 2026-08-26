import { isMemoryExpired, MemoryStore } from '../store/memory-store.js';
import { MemoryQuery, RankedMemoryResult } from '../types.js';
import { MemoryItem } from '@atlas/shared';
import { rootLogger } from '@atlas/observability';

export class MemoryRetriever {
  constructor(private store: MemoryStore) {}

  public async retrieve(query: MemoryQuery): Promise<RankedMemoryResult[]> {
    // 1. Fetch items filtered by allowed scopes & types
    const allowedScopes = query.allowedScopes && query.allowedScopes.length > 0
      ? query.allowedScopes
      : ['global'];
    const candidates = await this.store.search({
      scopes: allowedScopes,
      types: query.types,
      status: query.status
    });

    const queryTokens = query.query.toLowerCase().split(/\s+/).filter(Boolean);
    const now = Date.now();

    // 2. Score & Rank candidates
    const ranked: RankedMemoryResult[] = [];

    for (const item of candidates) {
      if (isMemoryExpired(item, now)) {
        continue;
      }

      if (query.minConfidence && item.confidence < query.minConfidence) {
        continue;
      }

      // Relevance score based on token overlap
      const contentLower = item.content.toLowerCase();
      let matchCount = 0;
      for (const token of queryTokens) {
        if (contentLower.includes(token)) {
          matchCount++;
        }
      }
      const relevanceScore = queryTokens.length > 0 ? matchCount / queryTokens.length : 0.5;

      // Confidence score directly from item
      const confidenceScore = item.confidence;

      // Freshness score (decay over 30 days)
      const ageMs = now - new Date(item.createdAt).getTime();
      const ageDays = Math.max(0, ageMs / (1000 * 60 * 60 * 24));
      const freshnessScore = Math.max(0.1, 1 - ageDays / 30);

      // Weighted total score
      const totalScore = (0.5 * relevanceScore) + (0.3 * confidenceScore) + (0.2 * freshnessScore);

      if (relevanceScore > 0 || queryTokens.length === 0) {
        ranked.push({
          item,
          score: Number(totalScore.toFixed(4)),
          relevanceScore: Number(relevanceScore.toFixed(4)),
          confidenceScore: Number(confidenceScore.toFixed(4)),
          freshnessScore: Number(freshnessScore.toFixed(4))
        });
      }
    }

    // 3. Sort by total score descending
    ranked.sort((a, b) => b.score - a.score);

    // 4. Apply Token Budgeting if specified
    const limit = query.limit || 10;
    let selected = ranked.slice(0, limit);

    if (query.tokenBudget) {
      let accumulatedTokens = 0;
      const withinBudget: RankedMemoryResult[] = [];

      for (const res of selected) {
        const estTokens = Math.ceil(res.item.content.length / 4);
        if (accumulatedTokens + estTokens <= query.tokenBudget) {
          accumulatedTokens += estTokens;
          withinBudget.push(res);
        } else {
          break;
        }
      }
      selected = withinBudget;
    }

    rootLogger.debug(`Retrieved ${selected.length} memory items for query "${query.query}"`);
    return selected;
  }
}
