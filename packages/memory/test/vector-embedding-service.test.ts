import { afterEach, describe, expect, it, vi } from 'vitest';
import { VectorEmbeddingService } from '../src/second-brain/vector-embedding-service.js';

describe('VectorEmbeddingService configuration', () => {
  const original = {
    embeddingProvider: process.env.EMBEDDING_PROVIDER,
    embeddingApiKey: process.env.EMBEDDING_API_KEY,
    embeddingBaseUrl: process.env.EMBEDDING_BASE_URL,
    embeddingModel: process.env.EMBEDDING_MODEL,
    openAiKey: process.env.OPENAI_API_KEY,
    openRouterKey: process.env.OPENROUTER_API_KEY
  };

  afterEach(() => {
    for (const [key, value] of Object.entries({
      EMBEDDING_PROVIDER: original.embeddingProvider,
      EMBEDDING_API_KEY: original.embeddingApiKey,
      EMBEDDING_BASE_URL: original.embeddingBaseUrl,
      EMBEDDING_MODEL: original.embeddingModel,
      OPENAI_API_KEY: original.openAiKey,
      OPENROUTER_API_KEY: original.openRouterKey
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    vi.restoreAllMocks();
  });

  it('does not infer a cloud embedding provider from chat provider keys', () => {
    delete process.env.EMBEDDING_PROVIDER;
    delete process.env.EMBEDDING_API_KEY;
    delete process.env.EMBEDDING_BASE_URL;
    delete process.env.EMBEDDING_MODEL;
    process.env.OPENAI_API_KEY = 'chat-key-that-must-not-enable-embeddings';
    process.env.OPENROUTER_API_KEY = 'chat-key-that-must-not-enable-embeddings';

    const service = new VectorEmbeddingService();

    expect(service.getProviderInfo().provider).toBe('ollama');
  });

  it('uses explicit embedding credentials and endpoint only', () => {
    process.env.EMBEDDING_PROVIDER = 'openrouter';
    process.env.EMBEDDING_API_KEY = 'embedding-key';
    process.env.EMBEDDING_BASE_URL = 'https://embedding.example/v1';
    process.env.EMBEDDING_MODEL = 'embedding-model';

    const service = new VectorEmbeddingService();

    expect(service.getProviderInfo()).toMatchObject({
      provider: 'openrouter',
      model: 'embedding-model'
    });
  });

  it('falls back locally without making a cloud request when no embedding key exists', async () => {
    delete process.env.EMBEDDING_PROVIDER;
    delete process.env.EMBEDDING_API_KEY;
    delete process.env.EMBEDDING_BASE_URL;
    delete process.env.EMBEDDING_MODEL;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    const service = new VectorEmbeddingService({ provider: 'mock', dimension: 8 });
    const vector = await service.embed('local test');

    expect(vector).toHaveLength(8);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
