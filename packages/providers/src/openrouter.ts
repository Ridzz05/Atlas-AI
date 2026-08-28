import { OPENROUTER_BASE_URL, OPENROUTER_DEFAULT_MODEL } from '@atlas/shared';
import { OpenAICompatibleOptions, OpenAICompatibleProvider } from './openai.js';

export type OpenRouterOptions = Omit<
  OpenAICompatibleOptions,
  'baseUrl' | 'defaultModel' | 'inputCostPerMillion' | 'outputCostPerMillion'
> & {
  baseUrl?: string;
  defaultModel?: string;
};

export class OpenRouterProvider extends OpenAICompatibleProvider {
  constructor(options: OpenRouterOptions = {}) {
    super({
      ...options,
      baseUrl: options.baseUrl || OPENROUTER_BASE_URL,
      defaultModel: options.defaultModel || OPENROUTER_DEFAULT_MODEL,
      inputCostPerMillion: 0,
      outputCostPerMillion: 0,
      providerId: 'openrouter',
      providerName: 'OpenRouter',
      defaultHeaders: {
        'X-OpenRouter-Title': 'ATLAS AI OS',
        ...(options.defaultHeaders || {})
      }
    });
  }
}
