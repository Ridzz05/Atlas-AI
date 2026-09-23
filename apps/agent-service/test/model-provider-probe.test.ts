import { afterEach, describe, expect, it, vi } from 'vitest';
import { EnvConfigSchema } from '@atlas/shared';
import { buildServer } from '../src/server.js';

/**
 * "Saved" and "working" are two different facts, and only the first one was ever visible.
 *
 * The settings card could write a credential and then read KEY CONFIGURED, but whether the endpoint
 * accepts that credential was discoverable only by watching an agent run fail — which is how the
 * zRouter integration was found broken: the key was stored, the card was green, and every run that
 * declared a tool died before the model was reached. The probe answers the second question on demand,
 * and it uses the same credential the runtime would use, so a green result is evidence about the next
 * run rather than about the form.
 */

function stubFetch(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    headers: { get: () => null }
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function completion(content: string) {
  return {
    choices: [{ message: { content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 9, completion_tokens: 2 }
  };
}

const testConfig = EnvConfigSchema.parse({ NODE_ENV: 'test' });

const productionConfig = EnvConfigSchema.parse({
  NODE_ENV: 'production',
  API_AUTH_TOKEN: 'a'.repeat(32),
  ENCRYPTION_KEY: 'b'.repeat(64),
  MODEL_PROVIDER: 'zrouter',
  MODEL_NAME: 'deepseek-v4.1-flash',
  MODEL_API_KEY: 'env-only-key',
  DATABASE_URL: 'postgres://localhost:5432/atlas',
  REDIS_URL: 'redis://localhost:6379'
});

function createServer(options: { settingsRepo?: unknown; config?: unknown } = {}) {
  const auditRepo = { create: vi.fn().mockResolvedValue(undefined) };
  const server = buildServer({
    config: (options.config ?? testConfig) as never,
    modelProviderSettingsRepo: options.settingsRepo as never,
    auditRepo: auditRepo as never,
    processQueue: false
  });
  return { server, auditRepo };
}

function probe(server: ReturnType<typeof createServer>['server'], payload: unknown, headers: Record<string, string> = {}) {
  return server.inject({
    method: 'POST',
    url: '/api/v1/settings/model-provider/test',
    headers,
    payload: payload as never
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('model provider connection probe', () => {
  it('asks the provider to answer and reports what came back', async () => {
    const fetchMock = stubFetch(200, completion('pong'));
    const { server } = createServer();

    const response = await probe(server, { provider: 'zrouter', apiKey: 'zr-probe-key' });
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(200);
    expect(body.data).toMatchObject({
      ok: true,
      provider: 'zrouter',
      model: 'deepseek-v4.1-flash',
      credentialSource: 'request',
      reply: 'pong',
      inputTokens: 9,
      outputTokens: 2,
      error: null
    });
    expect(typeof body.data.latencyMs).toBe('number');
    // The credential the operator typed is what the endpoint is asked with, not the stored one.
    expect(fetchMock.mock.calls[0]?.[1]?.headers?.Authorization).toBe('Bearer zr-probe-key');
  });

  it('probes with the stored credential when the request carries none', async () => {
    const fetchMock = stubFetch(200, completion('pong'));
    const settingsRepo = {
      getRuntimeConfig: vi.fn().mockResolvedValue({
        providerType: 'zrouter',
        model: 'deepseek-v4.1-flash',
        apiKey: 'zr-stored-key'
      })
    };
    const { server } = createServer({ settingsRepo });

    const response = await probe(server, {});
    const body = JSON.parse(response.body);

    expect(body.data).toMatchObject({ ok: true, credentialSource: 'database', model: 'deepseek-v4.1-flash' });
    expect(fetchMock.mock.calls[0]?.[1]?.headers?.Authorization).toBe('Bearer zr-stored-key');
  });

  it('reports the real failure instead of a green card', async () => {
    const fetchMock = stubFetch(200, completion('this must never be reached'));
    // A cleared credential: the repository answers with an explicit empty key so the process
    // environment cannot silently reactivate the one the operator removed.
    const settingsRepo = {
      getRuntimeConfig: vi.fn().mockResolvedValue({ providerType: 'zrouter', model: 'deepseek-v4.1-flash', apiKey: '' })
    };
    const { server } = createServer({
      settingsRepo,
      config: EnvConfigSchema.parse({ NODE_ENV: 'test', MODEL_API_KEY: 'env-key-that-must-not-be-used' })
    });

    const response = await probe(server, {});
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(200);
    expect(body.data.ok).toBe(false);
    expect(body.data.credentialSource).toBe('none');
    expect(body.data.error).toContain('MODEL_API_KEY_MISSING');
    expect(body.data.reply).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a provider this system cannot build', async () => {
    const { server } = createServer();

    const response = await probe(server, { provider: 'some-other-gateway' });
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(400);
    expect(body.error).toContain('some-other-gateway');
    expect(body.supportedProviders).toContain('zrouter');
  });

  it('refuses the mock provider where the runtime would refuse it', async () => {
    const { server } = createServer({ config: productionConfig });

    const response = await probe(server, { provider: 'mock' }, { authorization: `Bearer ${'a'.repeat(32)}` });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toContain('NODE_ENV=production');
  });

  it('does not echo a credential an endpoint reflects back', async () => {
    stubFetch(401, '{"error":{"message":"invalid api key zr-secret-probe-key"}}');
    const { server } = createServer();

    const response = await probe(server, { provider: 'zrouter', apiKey: 'zr-secret-probe-key' });
    const body = JSON.parse(response.body);

    expect(body.data.ok).toBe(false);
    expect(response.body).not.toContain('zr-secret-probe-key');
    expect(body.data.error).toContain('[REDACTED]');
  });
});

describe('clearing the model provider credential', () => {
  it('reports the provider that is still configured, not OpenRouter', async () => {
    const settingsRepo = {
      clear: vi.fn().mockResolvedValue(true),
      getPublic: vi.fn().mockResolvedValue({
        provider: 'zrouter',
        modelName: 'deepseek-v4.1-flash',
        hasApiKey: false,
        apiKeyFingerprint: null,
        updatedBy: 'owner-api',
        updatedAt: '2026-09-23T00:00:00.000Z'
      })
    };
    const { server, auditRepo } = createServer({ settingsRepo });

    const response = await server.inject({ method: 'DELETE', url: '/api/v1/settings/model-provider' });
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(200);
    expect(body.data).toMatchObject({ provider: 'zrouter', modelName: 'deepseek-v4.1-flash' });
    // The audit trail described a decision nobody made: it named OpenRouter's model whatever was
    // configured, so "who changed the model provider to what" could not be answered from it.
    expect(auditRepo.create.mock.calls[0]?.[0]).toMatchObject({ target: 'zrouter' });
  });
});
