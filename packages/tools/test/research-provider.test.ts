import { describe, expect, it, vi } from 'vitest';
import { BraveResearchProvider, createResearchProvider, isPublicIpAddress } from '../src/index.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

describe('BraveResearchProvider', () => {
  it('recognizes private, reserved, and public IPv4/IPv6 DNS results', () => {
    expect(isPublicIpAddress('10.0.0.1')).toBe(false);
    expect(isPublicIpAddress('169.254.169.254')).toBe(false);
    expect(isPublicIpAddress('::1')).toBe(false);
    expect(isPublicIpAddress('fc00::1')).toBe(false);
    expect(isPublicIpAddress('::ffff:127.0.0.1')).toBe(false);
    expect(isPublicIpAddress('93.184.216.34')).toBe(true);
    expect(isPublicIpAddress('2001:4860:4860::8888')).toBe(true);
  });

  it('creates only explicitly configured research providers and fails closed otherwise', () => {
    expect(createResearchProvider({ providerType: 'none' })).toBeUndefined();
    expect(createResearchProvider({ providerType: 'brave', apiKey: 'test-brave-key' })).toBeInstanceOf(BraveResearchProvider);
    expect(() => createResearchProvider({ providerType: 'unsupported' })).toThrow('Unsupported research provider');
  });

  it('maps web search results into source-backed evidence and filters unsafe result URLs', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        web: {
          results: [
            {
              title: 'Palembang Fitness Center',
              url: 'https://fitness.example.com/palembang',
              description: 'Fitness center profile'
            },
            {
              title: 'Internal result',
              url: 'http://192.168.1.10/admin',
              description: 'Should never enter the evidence set'
            }
          ]
        }
      })
    );
    const provider = new BraveResearchProvider({
      apiKey: 'test-brave-key',
      fetchImpl,
      now: () => new Date('2026-08-26T00:00:00.000Z')
    });

    const results = await provider.search('gym Palembang', 5);

    expect(results).toEqual([
      {
        title: 'Palembang Fitness Center',
        url: 'https://fitness.example.com/palembang',
        snippet: 'Fitness center profile',
        confidence: 0.5,
        extractedAt: '2026-08-26T00:00:00.000Z',
        freshness: 'fresh',
        sensitivity: 'public',
        unresolvedQuestions: ['Search result content is not independently verified.']
      }
    ]);

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [request, init] = fetchImpl.mock.calls[0];
    expect(String(request)).toContain('/web/search?q=gym+Palembang&count=5');
    expect((init?.headers as Record<string, string>)['x-subscription-token']).toBe('test-brave-key');
  });

  it('derives company lookup and lead enrichment from the same source-aware search contract', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () =>
      jsonResponse({
        web: {
          results: [
            {
              title: 'Fit Palembang',
              url: 'https://fit.example.com',
              description: 'A public fitness profile'
            }
          ]
        }
      })
    );
    const provider = new BraveResearchProvider({
      apiKey: 'test-brave-key',
      fetchImpl,
      now: () => new Date('2026-08-26T00:00:00.000Z')
    });

    await expect(provider.lookupCompany('Fit Palembang', 'Palembang')).resolves.toMatchObject({
      found: true,
      companyName: 'Fit Palembang',
      address: '',
      sourceUrl: 'https://fit.example.com',
      confidence: 0.5,
      unresolvedQuestions: ['Address and contact details require independent verification.']
    });
    await expect(provider.enrichLead('Fit Palembang', 'Palembang')).resolves.toMatchObject({
      found: true,
      companyName: 'Fit Palembang',
      location: 'Palembang',
      category: 'fitness',
      sourceUrl: 'https://fit.example.com',
      confidence: 0.5,
      unresolvedQuestions: ['Contact and qualification details require independent verification.']
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(String(fetchImpl.mock.calls[0][0])).toContain('q=Fit+Palembang+Palembang');
  });

  it('propagates cancellation and surfaces bounded provider failures', async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error('This operation was aborted'));
    const provider = new BraveResearchProvider({ apiKey: 'test-brave-key', fetchImpl });

    controller.abort('stop');
    await expect(provider.search('gym', 1, controller.signal)).rejects.toThrow('aborted');

    fetchImpl.mockResolvedValue(jsonResponse({ error: 'provider unavailable' }, 503));
    await expect(provider.search('gym', 1)).rejects.toThrow('Brave Search API HTTP 503');
  });

  it('rejects non-official API endpoints and overlong queries before sending the API key', async () => {
    expect(
      () =>
        new BraveResearchProvider({
          apiKey: 'test-brave-key',
          baseUrl: 'https://proxy.example.com/res/v1'
        })
    ).toThrow('official Brave Search API host');
    expect(
      () =>
        new BraveResearchProvider({
          apiKey: 'test-brave-key',
          baseUrl: 'https://user:secret@api.search.brave.com:8443/res/v1'
        })
    ).toThrow('official Brave Search API host');

    const fetchImpl = vi.fn<typeof fetch>();
    const provider = new BraveResearchProvider({ apiKey: 'test-brave-key', fetchImpl });

    await expect(provider.search('x'.repeat(401), 1)).rejects.toThrow('query must be between 1 and 400 characters');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fetches bounded untrusted content only after public DNS validation and safe redirect checks', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async input => {
      if (String(input).endsWith('/start')) {
        return new Response(null, {
          status: 302,
          headers: { location: 'https://example.com/final' }
        });
      }
      return new Response('<html>Public but untrusted content</html>', {
        status: 200,
        headers: { 'content-type': 'text/html' }
      });
    });
    const dnsLookup = vi.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    const provider = new BraveResearchProvider({
      apiKey: 'test-brave-key',
      fetchImpl,
      dnsLookup,
      now: () => new Date('2026-08-26T00:00:00.000Z')
    });

    const result = await provider.fetchSafe?.('https://example.com/start');

    expect(result).toEqual({
      content: '<html>Public but untrusted content</html>',
      sourceUrl: 'https://example.com/final',
      extractedAt: '2026-08-26T00:00:00.000Z',
      freshness: 'fresh',
      sensitivity: 'public',
      unresolvedQuestions: ['Fetched content is untrusted and requires source verification.'],
      confidence: 0.5
    });
    expect(dnsLookup).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls.every(([, init]) => init?.redirect === 'manual')).toBe(true);
  });

  it('rejects private DNS results and oversized responses before exposing content', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response('should not be read'));
    const dnsLookup = vi.fn().mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
    const privateProvider = new BraveResearchProvider({ apiKey: 'test-brave-key', fetchImpl, dnsLookup });

    await expect(privateProvider.fetchSafe?.('https://public.example.com')).rejects.toThrow('private or non-public');
    expect(fetchImpl).not.toHaveBeenCalled();

    const publicDnsLookup = vi.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    const oversizedProvider = new BraveResearchProvider({
      apiKey: 'test-brave-key',
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response('x'.repeat(33))),
      dnsLookup: publicDnsLookup,
      maxResponseBytes: 32
    });

    await expect(oversizedProvider.fetchSafe?.('https://public.example.com')).rejects.toThrow('response exceeds 32 bytes');
  });

  it('rejects unsafe redirect targets and translates provider aborts caused by its timeout', async () => {
    const redirectFetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: 'http://127.0.0.1/admin' }
      })
    );
    const redirectProvider = new BraveResearchProvider({
      apiKey: 'test-brave-key',
      fetchImpl: redirectFetch,
      dnsLookup: vi.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
    });

    await expect(redirectProvider.fetchSafe?.('https://public.example.com/start')).rejects.toThrow('credential-free HTTP(S) URL');
    expect(redirectFetch).toHaveBeenCalledOnce();

    const timeoutFetch = vi.fn<typeof fetch>().mockImplementation(
      async (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('This operation was aborted')), { once: true });
        })
    );
    const timeoutProvider = new BraveResearchProvider({
      apiKey: 'test-brave-key',
      fetchImpl: timeoutFetch,
      dnsLookup: vi.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]),
      fetchTimeoutMs: 10
    });

    await expect(timeoutProvider.fetchSafe?.('https://public.example.com/slow')).rejects.toThrow('timed out after 10ms');

    const bodyTimeoutFetch = vi.fn<typeof fetch>().mockImplementation(async (_input, init) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          init?.signal?.addEventListener('abort', () => controller.error(new Error('This operation was aborted')), { once: true });
        }
      });
      return new Response(body, { headers: { 'content-type': 'text/plain' } });
    });
    const bodyTimeoutProvider = new BraveResearchProvider({
      apiKey: 'test-brave-key',
      fetchImpl: bodyTimeoutFetch,
      dnsLookup: vi.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]),
      fetchTimeoutMs: 10
    });

    await expect(bodyTimeoutProvider.fetchSafe?.('https://public.example.com/body-slow')).rejects.toThrow('timed out after 10ms');

    const hangingDnsProvider = new BraveResearchProvider({
      apiKey: 'test-brave-key',
      fetchImpl: vi.fn<typeof fetch>(),
      dnsLookup: vi.fn().mockImplementation(() => new Promise(() => {})),
      fetchTimeoutMs: 10
    });

    await expect(hangingDnsProvider.fetchSafe?.('https://public.example.com/dns-slow')).rejects.toThrow('timed out after 10ms');
  });
});
