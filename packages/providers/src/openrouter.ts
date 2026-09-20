import { OPENROUTER_BASE_URL, OPENROUTER_DEFAULT_MODEL } from '@atlas/shared';
import { OpenAICompatibleOptions, OpenAICompatibleProvider } from './openai.js';

export type OpenRouterOptions = Omit<
  OpenAICompatibleOptions,
  'baseUrl' | 'defaultModel' | 'inputCostPerMillion' | 'outputCostPerMillion' | 'extraPayload'
> & {
  baseUrl?: string;
  defaultModel?: string;
};

/**
 * OpenRouter, which reports what each request cost.
 *
 * This provider used to declare `inputCostPerMillion: 0` and `outputCostPerMillion: 0`, so every
 * OpenRouter run looked free and the daily cap and the per-run cap never fired for a paid model.
 * The price is not something this codebase knows — it depends on the model, which is configurable —
 * so instead of declaring a number it asks OpenRouter for the cost (`usage: { include: true }`) and
 * reports what comes back.
 *
 * The one price that IS known is a `:free` model: the suffix is OpenRouter's own convention and the
 * default model uses it, so that case declares zero honestly rather than by accident.
 */
export class OpenRouterProvider extends OpenAICompatibleProvider {
  constructor(options: OpenRouterOptions = {}) {
    const defaultModel = options.defaultModel || OPENROUTER_DEFAULT_MODEL;
    const isFreeModel = defaultModel.endsWith(':free');

    super({
      ...options,
      baseUrl: options.baseUrl || OPENROUTER_BASE_URL,
      defaultModel,
      // A declared zero for a `:free` model, and no declaration at all otherwise — an undeclared
      // price must stay unknown so the budget layer can report that it cannot enforce the cap.
      ...(isFreeModel ? { inputCostPerMillion: 0, outputCostPerMillion: 0 } : {}),
      extraPayload: { usage: { include: true } },
      providerId: 'openrouter',
      providerName: 'OpenRouter',
      defaultHeaders: {
        'X-OpenRouter-Title': 'ATLAS AI OS',
        ...(options.defaultHeaders || {})
      }
    });
  }
}
