import { describe, it, expect, vi } from 'vitest';
import { MockModelProvider, createModelProvider } from '../src/index.js';

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
