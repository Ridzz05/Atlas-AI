import { ModelProvider } from './types.js';
import { MockModelProvider } from './mock.js';
import { OpenAICompatibleProvider } from './openai.js';
import { OpenRouterProvider } from './openrouter.js';

export interface ProviderConfig {
  providerType?: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

export function createModelProvider(config: ProviderConfig = {}): ModelProvider {
  const type = (config.providerType || process.env.MODEL_PROVIDER || 'openrouter').toLowerCase();

  switch (type) {
    case 'openai':
      return new OpenAICompatibleProvider({
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        defaultModel: config.model
      });
    case 'openai-compatible':
      return new OpenAICompatibleProvider({
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        defaultModel: config.model
      });
    case 'openrouter':
      return new OpenRouterProvider({
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        defaultModel: config.model
      });
    case 'groq':
      return new OpenAICompatibleProvider({
        apiKey: config.apiKey,
        baseUrl: config.baseUrl || 'https://api.groq.com/openai/v1',
        defaultModel: config.model
      });
    case 'ollama':
      return new OpenAICompatibleProvider({
        apiKey: config.apiKey,
        baseUrl: config.baseUrl || 'http://localhost:11434/v1',
        defaultModel: config.model,
        requireApiKey: false
      });
    case 'deepseek':
      return new OpenAICompatibleProvider({
        apiKey: config.apiKey,
        baseUrl: config.baseUrl || 'https://api.deepseek.com/v1',
        defaultModel: config.model
      });
    case 'mock':
      return new MockModelProvider();
    default:
      throw new Error(`Unsupported model provider: ${type}`);
  }
}
