import {
  SecondBrainDocument,
  SecondBrainSearchResult,
  SecondBrainCitation,
  SecondBrainStats
} from '@atlas/shared';
import { VaultIngestionService, IngestDocumentInput, IngestVaultResult } from './vault-ingestion-service.js';
import { SecondBrainRetriever, SecondBrainQueryOptions } from './second-brain-retriever.js';
import { VectorEmbeddingService, EmbeddingConfig } from './vector-embedding-service.js';
import { rootLogger } from '@atlas/observability';

export interface GroundedRAGResponse {
  query: string;
  answer: string;
  citations: SecondBrainCitation[];
  sources: Array<{
    title: string;
    filePath: string;
    sectionHeading: string | null;
    score: number;
  }>;
}

export type SecondBrainLLMSynthesizer = (prompt: { systemPrompt: string; userPrompt: string }) => Promise<string>;

export class SecondBrainService {
  private embeddingService: VectorEmbeddingService;
  private vault: VaultIngestionService;
  private retriever: SecondBrainRetriever;
  private llmSynthesizer?: SecondBrainLLMSynthesizer;

  constructor(embeddingConfig?: EmbeddingConfig, llmSynthesizer?: SecondBrainLLMSynthesizer) {
    this.embeddingService = new VectorEmbeddingService(embeddingConfig);
    this.vault = new VaultIngestionService(this.embeddingService);
    this.retriever = new SecondBrainRetriever(this.vault, this.embeddingService);
    this.llmSynthesizer = llmSynthesizer;
  }

  public async ingestDocument(input: IngestDocumentInput): Promise<SecondBrainDocument> {
    return this.vault.ingestDocument(input);
  }

  public async ingestVaultDirectory(
    dirPath: string,
    options?: { extensions?: string[]; excludePatterns?: string[]; scope?: string }
  ): Promise<IngestVaultResult> {
    return this.vault.ingestVaultDirectory(dirPath, options);
  }

  public async search(options: SecondBrainQueryOptions): Promise<SecondBrainSearchResult[]> {
    return this.retriever.search(options);
  }

  public getDocument(id: string): SecondBrainDocument | null {
    return this.vault.getDocument(id);
  }

  public getDocumentByPath(filePath: string): SecondBrainDocument | null {
    return this.vault.getDocumentByPath(filePath);
  }

  public listDocuments(options?: { scope?: string; tag?: string; limit?: number }): SecondBrainDocument[] {
    return this.vault.listDocuments(options);
  }

  public deleteDocument(id: string): boolean {
    return this.vault.deleteDocument(id);
  }

  public getStats(): SecondBrainStats {
    return this.vault.getStats();
  }

  /**
   * Grounded RAG Query: searches the vault, synthesizes context, and formats traceable wiki-link citations.
   */
  public async query(
    query: string,
    options: { scope?: string; limit?: number; minScore?: number } = {}
  ): Promise<GroundedRAGResponse> {
    return this.queryGrounded(query, options);
  }

  public async queryGrounded(
    query: string,
    options: { scope?: string; limit?: number; minScore?: number } = {}
  ): Promise<GroundedRAGResponse> {
    const results = await this.retriever.search({
      query,
      scope: options.scope,
      limit: options.limit || 4,
      minScore: options.minScore || 0.15
    });

    const citations = results.map(r => r.citation);
    const sources = results.map(r => ({
      title: r.chunk.documentTitle,
      filePath: r.chunk.filePath,
      sectionHeading: r.chunk.sectionHeading,
      score: r.score
    }));

    // If no matching knowledge found in notes
    if (results.length === 0) {
      return {
        query,
        answer: `I could not find any relevant notes in your Second Brain for "${query}". You can add or sync notes in the Vault to expand your knowledge base.`,
        citations: [],
        sources: []
      };
    }

    // Synthesize grounded response using LLM if available
    const contextBlocks = results
      .map((r, idx) => {
        const heading = r.chunk.sectionHeading ? ` > ${r.chunk.sectionHeading}` : '';
        return `[Source ${idx + 1}: [[${r.chunk.documentTitle}${heading}]] (${r.chunk.filePath})]\n${r.chunk.content}`;
      })
      .join('\n\n---\n\n');

    let answer: string | null = null;

    if (this.llmSynthesizer) {
      try {
        const systemPrompt = `You are the Second Brain AI Knowledge Assistant for ATLAS AI OS.
Your goal is to answer the user's question clearly, thoroughly, and factually based on the provided context notes.
GUIDELINES:
1. Always cite relevant source notes using Obsidian Wiki-Link syntax like [[Note Title]] or [[Note Title#Section Name]] directly in your explanation.
2. Synthesize key insights across the sources instead of just copying verbatim.
3. If the context does not fully answer the question, state what is known from the notes and identify missing details.`;

        const userPrompt = `User Query: "${query}"

Retrieved Knowledge Notes:
${contextBlocks}

Provide a comprehensive, grounded answer citing the source notes using [[Note#Section]]:`;

        const synthesized = await this.llmSynthesizer({ systemPrompt, userPrompt });
        if (synthesized && synthesized.trim()) {
          answer = synthesized.trim();
        }
      } catch (err) {
        rootLogger.warn('LLM RAG synthesis failed, using extractive fallback', {
          error: err instanceof Error ? err.message : String(err)
        });
      }
    }

    // Fallback: structured extractive summary
    if (!answer) {
      const firstMatch = results[0]!;
      const headingRef = firstMatch.chunk.sectionHeading ? `#${firstMatch.chunk.sectionHeading}` : '';
      const primaryLink = `[[${firstMatch.chunk.documentTitle}${headingRef}]]`;

      const answerLines: string[] = [];
      answerLines.push(`Based on your Second Brain notes (${primaryLink}):\n`);

      for (const r of results) {
        const hRef = r.chunk.sectionHeading ? `#${r.chunk.sectionHeading}` : '';
        const ref = `[[${r.chunk.documentTitle}${hRef}]]`;
        const cleanSnippet = r.chunk.content.replace(/^#+\s+/gm, '').trim();
        answerLines.push(`- **From ${ref}**: ${cleanSnippet.slice(0, 300)}${cleanSnippet.length > 300 ? '…' : ''}`);
      }

      answer = answerLines.join('\n');
    }

    rootLogger.info('Second Brain grounded RAG query synthesized', { query, sourcesCount: sources.length });

    return {
      query,
      answer,
      citations,
      sources
    };
  }
}
