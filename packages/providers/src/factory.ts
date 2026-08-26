import { ModelProvider } from './types.js';
import { MockModelProvider } from './mock.js';
import { OpenAICompatibleProvider } from './openai.js';

export interface ProviderConfig {
  providerType?: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

export function createModelProvider(config: ProviderConfig = {}): ModelProvider {
  const type = (config.providerType || process.env.MODEL_PROVIDER || 'mock').toLowerCase();

  switch (type) {
    case 'openai':
    case 'openai-compatible':
    case 'groq':
    case 'ollama':
    case 'deepseek':
      return new OpenAICompatibleProvider({
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        defaultModel: config.model
      });
    case 'mock':
      return new MockModelProvider();
    default:
      throw new Error(`Unsupported model provider: ${type}`);
  }
}
