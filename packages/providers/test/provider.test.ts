import { describe, it, expect, vi } from 'vitest';
import { MockModelProvider, ReloadableModelProvider, createModelProvider } from '../src/index.js';

describe('@atlas/providers tests', () => {
  it('creates default mock provider correctly', () => {
    const provider = createModelProvider({ providerType: 'mock' });
    expect(provider.id).toBe('mock');
  });

  it('rejects unsupported provider types instead of silently using mock', () => {
    expect(() => createModelProvider({ providerType: 'typo-provider' })).toThrow('Unsupported model provider');
  });

  it('uses a provider-specific endpoint for Groq', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'provider response' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1 }
      })
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      const provider = createModelProvider({ providerType: 'groq', apiKey: 'test-key' });
      await provider.run({
        runId: '123e4567-e89b-12d3-a456-426614174000',
        agentId: 'chief',
        messages: [{ role: 'user', content: 'Hello' }]
      });

      expect(fetchMock).toHaveBeenCalledWith('https://api.groq.com/openai/v1/chat/completions', expect.any(Object));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('uses OpenRouter defaults and the requested free model', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'openrouter response' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 2, completion_tokens: 3 }
      })
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      const provider = createModelProvider({ providerType: 'openrouter', apiKey: 'sk-or-v1-test-key' });
      const result = await provider.run({
        runId: '123e4567-e89b-12d3-a456-426614174000',
        agentId: 'chief',
        messages: [{ role: 'user', content: 'Hello' }]
      });

      expect(fetchMock).toHaveBeenCalledWith('https://openrouter.ai/api/v1/chat/completions', expect.any(Object));
      const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
      const payload = JSON.parse(String(request.body));
      expect(payload.model).toBe('z-ai/glm-5.2:free');
      expect((request.headers as Record<string, string>).Authorization).toBe('Bearer sk-or-v1-test-key');
      expect(result.costUsd).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('fails closed when a network provider has no API key', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    try {
      const provider = createModelProvider({ providerType: 'openrouter' });
      await expect(
        provider.run({
          runId: '123e4567-e89b-12d3-a456-426614174000',
          agentId: 'chief',
          messages: [{ role: 'user', content: 'Hello' }]
        })
      ).rejects.toThrow('MODEL_API_KEY_MISSING');
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('reloads persisted provider configuration for each model call', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'reloaded response' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1 }
      })
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      let apiKey = 'sk-or-v1-first-test-key';
      const provider = new ReloadableModelProvider(new MockModelProvider(), async () => ({
        providerType: 'openrouter',
        model: 'z-ai/glm-5.2:free',
        apiKey
      }));
      const request = {
        runId: '123e4567-e89b-12d3-a456-426614174000',
        agentId: 'chief',
        messages: [{ role: 'user' as const, content: 'Hello' }]
      };

      await provider.run(request);
      apiKey = 'sk-or-v1-second-test-key';
      await provider.run(request);

      expect((fetchMock.mock.calls[0]?.[1] as RequestInit).headers).toMatchObject({
        Authorization: 'Bearer sk-or-v1-first-test-key'
      });
      expect((fetchMock.mock.calls[1]?.[1] as RequestInit).headers).toMatchObject({
        Authorization: 'Bearer sk-or-v1-second-test-key'
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('forwards maxTokens and preserves a length finish reason', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'truncated response' }, finish_reason: 'length' }],
        usage: { prompt_tokens: 1, completion_tokens: 2 }
      })
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      const provider = createModelProvider({
        providerType: 'openai',
        apiKey: 'test-key',
        baseUrl: 'https://api.example.test/v1',
        model: 'test-model'
      });
      const result = await provider.run({
        runId: '123e4567-e89b-12d3-a456-426614174000',
        agentId: 'chief',
        messages: [{ role: 'user', content: 'Hello' }],
        maxTokens: 256
      });

      const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
      const payload = JSON.parse(String(request.body));
      expect(payload.max_tokens).toBe(256);
      expect(result.finishReason).toBe('length');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('runs mock completion with canned responses', async () => {
    const mock = new MockModelProvider({
      cannedResponses: [{ content: 'Canned step 1 response' }, { content: 'Canned step 2 response' }]
    });

    const res1 = await mock.run({
      runId: '123e4567-e89b-12d3-a456-426614174000',
      agentId: 'chief',
      messages: [{ role: 'user', content: 'Hello Chief' }]
    });

    expect(res1.content).toBe('Canned step 1 response');
    expect(res1.inputTokens).toBeGreaterThan(0);
    expect(res1.outputTokens).toBeGreaterThan(0);
    expect(res1.finishReason).toBe('stop');

    const res2 = await mock.run({
      runId: '123e4567-e89b-12d3-a456-426614174000',
      agentId: 'chief',
      messages: [{ role: 'user', content: 'Next step' }]
    });

    expect(res2.content).toBe('Canned step 2 response');
  });

  it('supports mock tool calling', async () => {
    const mock = new MockModelProvider({
      cannedResponses: [
        {
          content: 'Delegating to Ned',
          toolCalls: [
            {
              id: 'tc-1',
              name: 'tasks.create_child',
              arguments: { agent: 'ned', objective: 'Collect gyms' }
            }
          ]
        }
      ]
    });

    const res = await mock.run({
      runId: '123e4567-e89b-12d3-a456-426614174000',
      agentId: 'chief',
      messages: [{ role: 'user', content: 'Plan tasks' }]
    });

    expect(res.finishReason).toBe('tool_calls');
    expect(res.toolCalls.length).toBe(1);
    expect(res.toolCalls[0]?.name).toBe('tasks.create_child');
  });

  it('aborts cleanly on signal abort', async () => {
    const mock = new MockModelProvider({
      cannedResponses: [{ content: 'Delayed response', delayMs: 100 }]
    });

    const controller = new AbortController();
    setTimeout(() => controller.abort(), 10);

    await expect(
      mock.run({
        runId: '123e4567-e89b-12d3-a456-426614174000',
        agentId: 'chief',
        messages: [{ role: 'user', content: 'Wait for me' }],
        signal: controller.signal
      })
    ).rejects.toThrow('aborted');
  });
});
