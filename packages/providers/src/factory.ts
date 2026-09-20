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
      // gpt-4o-mini is this provider's default model, so its prices are known for that case. Any
      // other model is a price this codebase does not have, and guessing one would be inventing a
      // fact the budget cap is then enforced against.
      return new OpenAICompatibleProvider({
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        defaultModel: config.model,
        ...(config.model ? {} : { inputCostPerMillion: 0.15, outputCostPerMillion: 0.6 })
      });
    case 'openai-compatible':
      // The model behind an arbitrary compatible endpoint is unknown, so its price is too.
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
        requireApiKey: false,
        // A local runtime has no per-token price. Without this it inherited gpt-4o-mini's rates, so
        // free local runs consumed the paid daily cap and a run could be stopped for exceeding a
        // budget it never spent.
        inputCostPerMillion: 0,
        outputCostPerMillion: 0
      });
    case 'deepseek':
      return new OpenAICompatibleProvider({
        apiKey: config.apiKey,
        baseUrl: config.baseUrl || 'https://api.deepseek.com/v1',
        defaultModel: config.model
      });
    case 'zrouter':
      return new OpenAICompatibleProvider({
        providerId: 'zrouter',
        providerName: 'zRouter Provider',
        apiKey: config.apiKey,
        baseUrl: config.baseUrl || process.env.MODEL_BASE_URL || 'https://api.zrouter.dev/v1',
        defaultModel: config.model || process.env.MODEL_NAME || 'deepseek-v4.1-flash',
        inputCostPerMillion: 0.0075,
        outputCostPerMillion: 0.03
      });
    case 'mock':
      return new MockModelProvider();
    default:
      throw new Error(`Unsupported model provider: ${type}`);
  }
}
