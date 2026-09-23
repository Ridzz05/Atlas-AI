import { rootLogger } from '@atlas/observability';
import crypto from 'node:crypto';

export interface EmbeddingConfig {
  provider?: 'ollama' | 'openai' | 'openrouter' | 'mock' | 'auto';
  ollamaBaseUrl?: string;
  ollamaModel?: string;
  apiKey?: string;
  apiBaseUrl?: string;
  model?: string;
  dimension?: number;
}

export class VectorEmbeddingService {
  private provider: 'ollama' | 'openai' | 'openrouter' | 'mock';
  private ollamaBaseUrl: string;
  private ollamaModel: string;
  private apiKey: string;
  private apiBaseUrl: string;
  private model: string;
  private dimension: number;
  private cache = new Map<string, number[]>();
  /**
   * What actually happened, as opposed to what was configured.
   *
   * `embed()` never throws: a provider failure is caught and answered with a deterministic hash
   * vector, so an unreachable provider still produces an index. That is the right fallback, but it
   * made the failure invisible — the vault reported the configured provider's name while every vector
   * in it came from hashing. These counters are the missing half of that report.
   */
  private fallbackCount = 0;
  private lastFallbackReason: string | null = null;
  private lastAttemptUsedFallback = false;

  constructor(config: EmbeddingConfig = {}) {
    this.ollamaBaseUrl = config.ollamaBaseUrl || process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
    this.ollamaModel = config.ollamaModel || 'nomic-embed-text';
    this.apiKey = config.apiKey || process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY || '';
    this.apiBaseUrl = config.apiBaseUrl || (process.env.OPENROUTER_API_KEY ? 'https://openrouter.ai/api/v1' : 'https://api.openai.com/v1');
    this.model = config.model || 'text-embedding-3-small';
    this.dimension = config.dimension || 1536;

    if (config.provider && config.provider !== 'auto') {
      this.provider = config.provider;
    } else if (this.apiKey) {
      this.provider = process.env.OPENROUTER_API_KEY ? 'openrouter' : 'openai';
    } else {
      this.provider = 'ollama';
    }
  }

  public getProviderInfo(): {
    provider: string;
    model: string;
    dimension: number;
    degraded: boolean;
    fallbackCount: number;
    lastError: string | null;
  } {
    return {
      provider: this.provider,
      model: this.provider === 'ollama' ? this.ollamaModel : this.model,
      dimension: this.dimension,
      // "Degraded" describes the last attempt, not the whole history: a provider that came back
      // should stop being reported as broken, while `fallbackCount` keeps the record that it was.
      degraded: this.lastAttemptUsedFallback,
      fallbackCount: this.fallbackCount,
      lastError: this.lastFallbackReason
    };
  }

  /**
   * Embed a single text string.
   */
  public async embed(text: string): Promise<number[]> {
    const trimmed = text.trim();
    if (!trimmed) {
      return new Array(this.dimension).fill(0);
    }

    const hash = crypto.createHash('sha256').update(trimmed).digest('hex');
    const cached = this.cache.get(hash);
    if (cached) return cached;

    let vector: number[];

    try {
      if (this.provider === 'ollama') {
        vector = await this.embedOllama(trimmed);
      } else if (this.provider === 'openai' || this.provider === 'openrouter') {
        vector = await this.embedCloud(trimmed);
      } else {
        vector = this.generateDeterministicVector(trimmed, this.dimension);
      }
      // A provider that answered is not degraded, whatever the previous attempt did. The count keeps
      // the record that it once was.
      this.lastAttemptUsedFallback = false;
    } catch (err) {
      this.fallbackCount += 1;
      this.lastFallbackReason = err instanceof Error ? err.message : String(err);
      this.lastAttemptUsedFallback = true;
      rootLogger.warn('External embedding failed, using semantic fallback', {
        error: this.lastFallbackReason,
        text: trimmed.slice(0, 50)
      });
      vector = this.generateDeterministicVector(trimmed, this.dimension);
    }

    const normalized = this.normalize(vector);
    this.cache.set(hash, normalized);
    return normalized;
  }

  /**
   * Embed multiple text strings in batch.
   */
  public async embedBatch(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];
    for (const t of texts) {
      results.push(await this.embed(t));
    }
    return results;
  }

  /**
   * Compute Cosine Similarity between two vectors. Returns a value between -1.0 and 1.0 (normally 0.0 to 1.0).
   */
  public static cosineSimilarity(a: number[], b: number[]): number {
    if (!a || !b || a.length === 0 || b.length === 0) return 0;
    const len = Math.min(a.length, b.length);
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < len; i++) {
      const valA = a[i] ?? 0;
      const valB = b[i] ?? 0;
      dotProduct += valA * valB;
      normA += valA * valA;
      normB += valB * valB;
    }

    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  private normalize(vector: number[]): number[] {
    let norm = 0;
    for (const v of vector) norm += v * v;
    norm = Math.sqrt(norm);
    if (norm === 0) return vector;
    return vector.map(v => Number((v / norm).toFixed(6)));
  }

  private async embedOllama(text: string): Promise<number[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);

    try {
      const res = await fetch(`${this.ollamaBaseUrl}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.ollamaModel,
          prompt: text
        }),
        signal: controller.signal
      });

      if (!res.ok) {
        throw new Error(`Ollama embedding responded with ${res.status}`);
      }

      const data = (await res.json()) as { embedding?: number[] };
      if (!data.embedding || !Array.isArray(data.embedding)) {
        throw new Error('Invalid embedding format from Ollama');
      }

      return data.embedding;
    } finally {
      clearTimeout(timer);
    }
  }

  private async embedCloud(text: string): Promise<number[]> {
    if (!this.apiKey) {
      throw new Error('No API key configured for cloud embeddings');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);

    try {
      const res = await fetch(`${this.apiBaseUrl}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: this.model,
          input: text
        }),
        signal: controller.signal
      });

      if (!res.ok) {
        throw new Error(`Cloud embedding responded with ${res.status}`);
      }

      const data = (await res.json()) as { data?: Array<{ embedding: number[] }> };
      if (!data.data || !data.data[0]?.embedding) {
        throw new Error('Invalid embedding format from cloud provider');
      }

      return data.data[0].embedding;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Deterministic semantic vector generator based on token n-grams and hashing.
   * Ensures reliable testing and offline operation without external dependencies.
   */
  public generateDeterministicVector(text: string, dim: number): number[] {
    const vector = new Array(dim).fill(0);
    const tokens = text.toLowerCase().split(/\W+/).filter(Boolean);

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]!;
      // Unigram hash
      const h1 = Math.abs(this.hashCode(token)) % dim;
      vector[h1] = (vector[h1] || 0) + 1.0;

      // Bigram hash
      if (i > 0) {
        const bigram = `${tokens[i - 1]}_${token}`;
        const h2 = Math.abs(this.hashCode(bigram)) % dim;
        vector[h2] = (vector[h2] || 0) + 1.5;
      }
    }

    return vector;
  }

  private hashCode(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash |= 0;
    }
    return hash;
  }
}
