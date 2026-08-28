import { describe, expect, it, vi } from 'vitest';
import { ModelProviderSettingsRepository } from '../src/repositories/model-provider.repository.js';

describe('ModelProviderSettingsRepository', () => {
  it('encrypts credentials and only exposes public metadata', async () => {
    let stored: Record<string, unknown> | undefined;
    const db = {
      query: vi.fn(async (sql: string, params: unknown[] = []) => {
        if (sql.includes('INSERT INTO model_provider_settings')) {
          stored = {
            provider: params[0],
            model_name: params[1],
            encrypted_api_key: params[2],
            api_key_fingerprint: params[3],
            updated_by: params[4],
            updated_at: '2026-08-27T00:00:00.000Z'
          };
          return { rows: [stored], rowCount: 1 };
        }
        if (sql.includes('SELECT provider, model_name, encrypted_api_key')) {
          return { rows: stored ? [stored] : [], rowCount: stored ? 1 : 0 };
        }
        if (sql.includes('SELECT provider, model_name, encrypted_api_key, api_key_fingerprint')) {
          return { rows: stored ? [stored] : [], rowCount: stored ? 1 : 0 };
        }
        throw new Error(`Unexpected query: ${sql}`);
      })
    } as any;

    const repository = new ModelProviderSettingsRepository(db, 'test-encryption-key-with-at-least-32-characters');
    const apiKey = 'sk-or-v1-test-key-that-must-never-be-returned';
    const saved = await repository.save({
      provider: 'openrouter',
      modelName: 'z-ai/glm-5.2:free',
      apiKey,
      updatedBy: 'owner-api'
    });

    expect(saved).toMatchObject({
      provider: 'openrouter',
      modelName: 'z-ai/glm-5.2:free',
      hasApiKey: true,
      updatedBy: 'owner-api'
    });
    expect(JSON.stringify(saved)).not.toContain(apiKey);
    expect(String(stored?.encrypted_api_key)).not.toBe(apiKey);
    expect(await repository.getRuntimeConfig()).toEqual({
      providerType: 'openrouter',
      model: 'z-ai/glm-5.2:free',
      apiKey
    });
  });
});
