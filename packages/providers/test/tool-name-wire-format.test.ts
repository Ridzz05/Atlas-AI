import { describe, it, expect, vi } from 'vitest';
import { createModelProvider } from '../src/index.js';

/**
 * The [OI] wire format allows `function.name` to contain only `[a-zA-Z0-9_-]`.
 *
 * ATLAS names its tools with a dot — `web.search`, `lead.score`, `memory.propose_write` — because
 * that is the namespace it addresses them by internally. The adapter forwarded those names
 * verbatim, so every request that declared even one tool was rejected before the model ever saw
 * it. zRouter answers a dotted name with HTTP 400 and an opaque body
 * (`{"error":{"message":"Invalid request. Check your request parameters."}}`), which is what every
 * tool-declaring agent run died on; a request with the same tool under an underscore name
 * succeeds. Nothing in the response says which field was wrong.
 *
 * The adapter is the boundary that speaks the wire protocol, so it owns the translation — and it
 * must translate back, because the name the runner hands to the Tool Gateway has to be the name
 * the registry is keyed by.
 */

function fetchMockReturning(body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => body });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function lastPayload(fetchMock: ReturnType<typeof vi.fn>) {
  const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
  return JSON.parse(String(request.body));
}

describe('tool names on the wire', () => {
  it('sends only names the wire format allows', async () => {
    const fetchMock = fetchMockReturning({
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1 }
    });

    try {
      const provider = createModelProvider({ providerType: 'zrouter', apiKey: 'zr-test', model: 'deepseek-v4.1-flash' });
      await provider.run({
        runId: '123e4567-e89b-12d3-a456-426614174000',
        agentId: 'ned',
        messages: [{ role: 'user', content: 'search the web' }],
        tools: [
          { name: 'web.search', description: 'Search the web', parameters: { type: 'object', properties: {} } },
          { name: 'second_brain.read_note', description: 'Read a note', parameters: { type: 'object', properties: {} } }
        ]
      });

      const payload = lastPayload(fetchMock);
      expect(payload.tools).toHaveLength(2);
      for (const tool of payload.tools) {
        expect(tool.function.name).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('hands the registry name back for a tool call the endpoint returns', async () => {
    // The model can only echo the name it was given, so this is what comes back for a tool the
    // adapter encoded.
    const fetchMock = fetchMockReturning({
      choices: [
        {
          message: {
            content: '',
            tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'web_search', arguments: '{"query":"gyms"}' } }]
          },
          finish_reason: 'tool_calls'
        }
      ],
      usage: { prompt_tokens: 5, completion_tokens: 5 }
    });

    try {
      const provider = createModelProvider({ providerType: 'zrouter', apiKey: 'zr-test', model: 'deepseek-v4.1-flash' });
      const result = await provider.run({
        runId: '123e4567-e89b-12d3-a456-426614174000',
        agentId: 'ned',
        messages: [{ role: 'user', content: 'search the web' }],
        tools: [{ name: 'web.search', description: 'Search the web', parameters: { type: 'object', properties: {} } }]
      });

      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0]?.name).toBe('web.search');
      expect(result.toolCalls[0]?.arguments).toEqual({ query: 'gyms' });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps two tools distinct even when their names encode to the same shape', async () => {
    const fetchMock = fetchMockReturning({
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1 }
    });

    try {
      const provider = createModelProvider({ providerType: 'zrouter', apiKey: 'zr-test', model: 'deepseek-v4.1-flash' });
      await provider.run({
        runId: '123e4567-e89b-12d3-a456-426614174000',
        agentId: 'ned',
        messages: [{ role: 'user', content: 'go' }],
        tools: [
          { name: 'web.search', description: 'dotted', parameters: { type: 'object', properties: {} } },
          { name: 'web_search', description: 'underscored', parameters: { type: 'object', properties: {} } }
        ]
      });

      const names = lastPayload(fetchMock).tools.map((t: any) => t.function.name);
      expect(new Set(names).size).toBe(2);
      expect(names).not.toContain('web.search');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('encodes tool names carried by earlier turns, not just the declarations', async () => {
    const fetchMock = fetchMockReturning({
      choices: [{ message: { content: 'done' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1 }
    });

    try {
      const provider = createModelProvider({ providerType: 'zrouter', apiKey: 'zr-test', model: 'deepseek-v4.1-flash' });
      await provider.run({
        runId: '123e4567-e89b-12d3-a456-426614174000',
        agentId: 'ned',
        messages: [
          { role: 'user', content: 'search the web' },
          {
            role: 'assistant',
            content: '',
            toolCalls: [{ id: 'call-1', name: 'web.search', arguments: { query: 'gyms' } }]
          },
          { role: 'tool', content: '{"results":[]}', name: 'web.search', toolCallId: 'call-1' }
        ],
        tools: [{ name: 'web.search', description: 'Search the web', parameters: { type: 'object', properties: {} } }]
      });

      const payload = lastPayload(fetchMock);
      const assistantTurn = payload.messages.find((m: any) => m.role === 'assistant');
      const toolTurn = payload.messages.find((m: any) => m.role === 'tool');

      expect(assistantTurn.tool_calls[0].function.name).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
      expect(toolTurn.name).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
      // The correlation id is the provider's own and must survive untouched.
      expect(toolTurn.tool_call_id).toBe('call-1');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
