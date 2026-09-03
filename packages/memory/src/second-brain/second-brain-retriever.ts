import { SecondBrainSearchResult, SecondBrainCitation } from '@atlas/shared';
import { VaultIngestionService } from './vault-ingestion-service.js';
import { VectorEmbeddingService } from './vector-embedding-service.js';
import { rootLogger } from '@atlas/observability';

export interface SecondBrainQueryOptions {
  query: string;
  scope?: string;
  allowedScopes?: string[];
  tag?: string;
  limit?: number;
  minScore?: number;
  tokenBudget?: number;
}

export class SecondBrainRetriever {
  constructor(
    private vault: VaultIngestionService,
    private embeddingService: VectorEmbeddingService
  ) {}

  /**
   * Perform hybrid search (dense vector cosine similarity + lexical matching) across the vault.
   */
  public async search(options: SecondBrainQueryOptions): Promise<SecondBrainSearchResult[]> {
    const { query, scope, tag, limit = 5, minScore = 0.1 } = options;
    const trimmedQuery = query.trim();
    if (!trimmedQuery) return [];

    // 1. Get candidate chunks
    const chunks = this.vault.getAllChunks(scope);
    if (chunks.length === 0) return [];

    // Filter by tag if specified
    const filteredChunks = tag ? chunks.filter(c => c.tags.some(t => t.toLowerCase() === tag.toLowerCase())) : chunks;

    if (filteredChunks.length === 0) return [];

    // 2. Generate Query Vector Embedding
    const queryVector = await this.embeddingService.embed(trimmedQuery);
    const queryTokens = trimmedQuery.toLowerCase().split(/\s+/).filter(Boolean);

    // 3. Score candidates with hybrid approach
    const scoredResults: SecondBrainSearchResult[] = [];

    for (const chunk of filteredChunks) {
      // Vector Cosine Similarity
      let vectorScore = 0;
      if (chunk.embedding && chunk.embedding.length > 0) {
        vectorScore = Math.max(0, VectorEmbeddingService.cosineSimilarity(queryVector, chunk.embedding));
      }

      // Lexical & Keyword Matching
      const contentLower = chunk.content.toLowerCase();
      const titleLower = chunk.documentTitle.toLowerCase();
      const headingLower = (chunk.sectionHeading || '').toLowerCase();

      let matchCount = 0;
      let titleBonus = 0;

      for (const token of queryTokens) {
        if (contentLower.includes(token)) matchCount++;
        if (titleLower.includes(token)) titleBonus += 0.2;
        if (headingLower.includes(token)) titleBonus += 0.1;
      }

      const lexicalScore = queryTokens.length > 0 ? Math.min(1.0, matchCount / queryTokens.length) : 0.5;

      // Hybrid combined score: 60% Vector + 30% Lexical + 10% Title/Heading Bonus
      const hybridScore = Number((0.6 * vectorScore + 0.3 * lexicalScore + Math.min(0.1, titleBonus)).toFixed(4));

      if (hybridScore >= minScore || lexicalScore > 0.5 || vectorScore > 0.5) {
        const citation: SecondBrainCitation = {
          documentId: chunk.documentId,
          noteTitle: chunk.documentTitle,
          filePath: chunk.filePath,
          sectionHeading: chunk.sectionHeading,
          chunkIndex: chunk.chunkIndex,
          relevanceScore: hybridScore,
          excerpt: this.generateExcerpt(chunk.content, queryTokens)
        };

        scoredResults.push({
          chunk,
          score: hybridScore,
          relevanceScore: Number(lexicalScore.toFixed(4)),
          vectorScore: Number(vectorScore.toFixed(4)),
          citation
        });
      }
    }

    // 4. Sort descending by score
    scoredResults.sort((a, b) => b.score - a.score);

    // 5. Apply Token Budgeting & Limits
    let selected = scoredResults.slice(0, limit);

    if (options.tokenBudget) {
      let accumulatedTokens = 0;
      const budgeted: SecondBrainSearchResult[] = [];
      for (const res of selected) {
        const tokens = res.chunk.tokensCount || Math.ceil(res.chunk.content.length / 4);
        if (accumulatedTokens + tokens <= options.tokenBudget) {
          accumulatedTokens += tokens;
          budgeted.push(res);
        } else {
          break;
        }
      }
      selected = budgeted;
    }

    rootLogger.debug('Second Brain hybrid retrieval executed', { query: trimmedQuery, resultsCount: selected.length });
    return selected;
  }

  private generateExcerpt(content: string, tokens: string[], maxLen = 220): string {
    const clean = content.replace(/^#+\s+/gm, '').trim();
    if (tokens.length === 0 || clean.length <= maxLen) {
      return clean.slice(0, maxLen);
    }

    const cleanLower = clean.toLowerCase();
    let bestIdx = 0;

    for (const token of tokens) {
      const idx = cleanLower.indexOf(token);
      if (idx !== -1) {
        bestIdx = Math.max(0, idx - 40);
        break;
      }
    }

    let excerpt = clean.slice(bestIdx, bestIdx + maxLen);
    if (bestIdx > 0) excerpt = '…' + excerpt;
    if (bestIdx + maxLen < clean.length) excerpt = excerpt + '…';
    return excerpt;
  }
}
