export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
export const OPENROUTER_DEFAULT_MODEL = 'minimax/minimax-m3:free';

export const ZROUTER_BASE_URL = 'https://api.zrouter.dev/v1';
export const ZROUTER_DEFAULT_MODEL = 'deepseek-v4.1-flash';

/**
 * The providers this system can actually build.
 *
 * The list lives here because three layers need the same answer — the environment schema, the
 * operator API that persists a choice, and the factory that constructs it — and a provider id that
 * one of them accepts and another does not is a setting that saves cleanly and then kills every run
 * with `Unsupported model provider`. `zrouter` was accepted by the factory while the settings API
 * stored whatever string it was given.
 */
export const MODEL_PROVIDER_IDS = ['mock', 'openai', 'openai-compatible', 'openrouter', 'groq', 'ollama', 'deepseek', 'zrouter'] as const;

export type ModelProviderId = (typeof MODEL_PROVIDER_IDS)[number];

/**
 * The model each provider runs when the operator names none.
 *
 * Only declared where this codebase already owns the answer: OpenRouter's and zRouter's defaults are
 * named here, and `openai` is the one endpoint whose default model the adapter also prices
 * (`gpt-4o-mini`). For every other provider the default is a decision nobody has made, so a blank
 * model name is refused rather than filled in with another provider's model — which is what used to
 * happen: the settings API fell back to OpenRouter's model for any provider, so choosing zRouter and
 * leaving the field empty stored `minimax/minimax-m3:free` under it.
 */
export const DEFAULT_MODEL_BY_PROVIDER: Partial<Record<ModelProviderId, string>> = {
  openai: 'gpt-4o-mini',
  openrouter: OPENROUTER_DEFAULT_MODEL,
  zrouter: ZROUTER_DEFAULT_MODEL
};

export function defaultModelForProvider(provider: string): string | undefined {
  return DEFAULT_MODEL_BY_PROVIDER[provider as ModelProviderId];
}

export function isModelProviderId(value: string): value is ModelProviderId {
  return (MODEL_PROVIDER_IDS as readonly string[]).includes(value);
}

/**
 * The mock provider fabricates responses, so it is a test double rather than a configuration.
 *
 * One rule, one owner: the environment schema refuses it in production, and so must the operator API
 * that persists a provider choice — otherwise the setting saves cleanly and the system answers every
 * task with canned text.
 */
export const MOCK_MODEL_PROVIDER = 'mock';

export function isModelProviderAllowedInEnvironment(provider: string, nodeEnv: string): boolean {
  return nodeEnv !== 'production' || provider !== MOCK_MODEL_PROVIDER;
}
