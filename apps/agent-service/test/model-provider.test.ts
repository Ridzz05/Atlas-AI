import { describe, expect, it, vi } from 'vitest';
import { EnvConfigSchema, OPENROUTER_DEFAULT_MODEL } from '@atlas/shared';
import { buildServer } from '../src/server.js';

describe('OpenRouter model settings API', () => {
  const config = EnvConfigSchema.parse({ NODE_ENV: 'test', MODEL_PROVIDER: 'openrouter' });

  function createServer() {
    const settingsRepo = {
      getPublic: vi.fn().mockResolvedValue({
        provider: 'openrouter',
        modelName: OPENROUTER_DEFAULT_MODEL,
        hasApiKey: true,
        apiKeyFingerprint: 'abc123def456',
        updatedBy: 'owner-api',
        updatedAt: '2026-08-27T00:00:00.000Z'
      }),
      save: vi.fn().mockResolvedValue({
        provider: 'openrouter',
        modelName: OPENROUTER_DEFAULT_MODEL,
        hasApiKey: true,
        apiKeyFingerprint: 'abc123def456',
        updatedBy: 'owner-api',
        updatedAt: '2026-08-27T00:00:00.000Z'
      }),
      clear: vi.fn().mockResolvedValue(true)
    };

    const auditRepo = { create: vi.fn().mockResolvedValue(undefined) };
    return {
      server: buildServer({ config, modelProviderSettingsRepo: settingsRepo as any, auditRepo: auditRepo as any }),
      settingsRepo,
      auditRepo
    };
  }

  it('stores an API key through the authenticated API without echoing it', async () => {
    const { server, settingsRepo, auditRepo } = createServer();
    const apiKey = 'sk-or-v1-this-secret-must-not-be-returned';

    const response = await server.inject({
      method: 'PUT',
      url: '/api/v1/settings/model-provider',
      payload: { apiKey }
    });

    expect(response.statusCode).toBe(200);
    expect(settingsRepo.save).toHaveBeenCalledWith({
      provider: 'openrouter',
      modelName: OPENROUTER_DEFAULT_MODEL,
      apiKey,
      clearApiKey: false,
      updatedBy: 'owner-api'
    });
    expect(response.body).not.toContain(apiKey);
    expect(auditRepo.create).toHaveBeenCalledOnce();
    expect(JSON.stringify(auditRepo.create.mock.calls[0]?.[0])).not.toContain(apiKey);
  });

  it('rejects an invalid key before persistence', async () => {
    const { server, settingsRepo } = createServer();

    const response = await server.inject({
      method: 'PUT',
      url: '/api/v1/settings/model-provider',
      payload: { apiKey: 'too-short' }
    });

    expect(response.statusCode).toBe(400);
    expect(settingsRepo.save).not.toHaveBeenCalled();
  });

  it('exposes status and fingerprint but not the credential', async () => {
    const { server } = createServer();
    const response = await server.inject({ method: 'GET', url: '/api/v1/settings' });
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(200);
    expect(body.data).toMatchObject({
      modelProvider: 'openrouter',
      modelName: OPENROUTER_DEFAULT_MODEL,
      modelConfigured: true,
      modelKeyFingerprint: 'abc123def456',
      modelConfigSource: 'database',
      mutable: true
    });
  });

  it('clears the persisted credential and audits the mutation', async () => {
    const { server, settingsRepo, auditRepo } = createServer();
    const response = await server.inject({ method: 'DELETE', url: '/api/v1/settings/model-provider' });

    expect(response.statusCode).toBe(200);
    expect(settingsRepo.clear).toHaveBeenCalledWith('owner-api');
    expect(auditRepo.create).toHaveBeenCalledOnce();
    expect(response.body).not.toContain('sk-or-v1');
  });
});
