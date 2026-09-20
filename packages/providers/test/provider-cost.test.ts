import { describe, expect, it, vi } from 'vitest';
import { createModelProvider } from '../src/factory.js';

/**
 * A cost the provider cannot know must be reported as unknown, not as a number.
 *
 * `[OI]CompatibleProvider` defaulted `inputCostPerMillion`/`outputCostPerMillion` to 0.15/0.6 —
 * gpt-4o-mini's prices — for every provider that did not override them, so:
 *
 * - `ollama` is a local runtime and free, but its runs were billed at gpt-4o-mini rates. The daily
 *   cap and the per-run cap were consumed by runs that cost nothing, so a run could be stopped for
 *   exceeding a budget it never spent.
 * - `groq`, `deepseek` and any `openai-compatible` endpoint were priced as if they were
 *   gpt-4o-mini, which is wrong in both directions depending on the model.
 * - `openrouter` explicitly set both to 0, so a paid OpenRouter model made every run look free and
 *   the caps silently never fired.
 *
 * `costUsdKnown` distinguishes "measured, and it is zero" from "not known".
 */
function completionResponse(usage: Record<string, unknown> = {}) {
  return {
    ok: true,
    json: async () => ({
      choices: [{ message: { content: 'hello' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1000, completion_tokens: 1000, ...usage }
    })
  };
}

async function runWith(response: unknown, config: Parameters<typeof createModelProvider>[0]) {
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal('fetch', fetchMock);
  try {
    const provider = createModelProvider(config);
    const result = await provider.run({
      runId: '123e4567-e89b-12d3-a456-426614174000',
      agentId: 'chief',
      messages: [{ role: 'user', content: 'Hello' }]
    });
    return { result, fetchMock };
  } finally {
    vi.unstubAllGlobals();
  }
}

describe('provider cost reporting', () => {
  it('treats a local ollama runtime as declared free, not as gpt-4o-mini', async () => {
    const { result } = await runWith(completionResponse(), { providerType: 'ollama' });

    expect(result.costUsd).toBe(0);
    expect(result.costUsdKnown).toBe(true);
  });

  it('reports an unconfigured endpoint price as unknown instead of borrowing a model price', async () => {
    const { result } = await runWith(completionResponse(), {
      providerType: 'openai-compatible',
      apiKey: 'test-key',
      baseUrl: 'https://example.invalid/v1'
    });

    expect(result.costUsdKnown).toBe(false);
  });

  it('keeps zrouter on its declared rates', async () => {
    const { result } = await runWith(completionResponse(), { providerType: 'zrouter', apiKey: 'test-key' });

    // 1000 in x 0.0075/M + 1000 out x 0.03/M
    expect(result.costUsd).toBe(0.000038); // estimateCost rounds to 6 dp
    expect(result.costUsdKnown).toBe(true);
  });

  it('does not price an explicitly chosen openai model as gpt-4o-mini', async () => {
    const { result } = await runWith(completionResponse(), {
      providerType: 'openai',
      apiKey: 'test-key',
      model: 'gpt-4o'
    });

    expect(result.costUsdKnown).toBe(false);
  });

  it('keeps gpt-4o-mini pricing when that is the model actually in use', async () => {
    const { result } = await runWith(completionResponse(), { providerType: 'openai', apiKey: 'test-key' });

    // 1000 in x 0.15/M + 1000 out x 0.6/M
    expect(result.costUsd).toBeCloseTo(0.00075, 9);
    expect(result.costUsdKnown).toBe(true);
  });

  it('uses the cost OpenRouter reports for a paid model', async () => {
    const { result, fetchMock } = await runWith(completionResponse({ cost: 0.0042 }), {
      providerType: 'openrouter',
      apiKey: 'test-key',
      model: 'anthropic/claude-sonnet-4'
    });

    // The request must ask OpenRouter to report the cost, or it will not be in the response.
    const payload = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body));
    expect(payload.usage).toEqual({ include: true });

    expect(result.costUsd).toBe(0.0042);
    expect(result.costUsdKnown).toBe(true);
  });

  it('reports a paid OpenRouter model with no reported cost as unknown rather than free', async () => {
    const { result } = await runWith(completionResponse(), {
      providerType: 'openrouter',
      apiKey: 'test-key',
      model: 'anthropic/claude-sonnet-4'
    });

    expect(result.costUsdKnown).toBe(false);
  });

  it('knows the default OpenRouter free model costs nothing', async () => {
    const { result } = await runWith(completionResponse(), { providerType: 'openrouter', apiKey: 'test-key' });

    expect(result.costUsd).toBe(0);
    expect(result.costUsdKnown).toBe(true);
  });

  it('reports unknown when the provider API omits usage entirely', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'hi' }, finish_reason: 'stop' }] })
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const provider = createModelProvider({ providerType: 'openai-compatible', apiKey: 'test-key' });
      const result = await provider.run({
        runId: '123e4567-e89b-12d3-a456-426614174000',
        agentId: 'chief',
        messages: [{ role: 'user', content: 'Hello' }]
      });

      expect(result.inputTokens).toBe(0);
      expect(result.costUsdKnown).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
