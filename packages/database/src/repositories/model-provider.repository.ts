import * as crypto from 'node:crypto';
import { DatabaseClient } from '../client.js';

export interface ModelProviderPublicSettings {
  provider: string;
  modelName: string;
  hasApiKey: boolean;
  apiKeyFingerprint: string | null;
  updatedBy: string;
  updatedAt: Date | string;
}

export interface PersistedModelProviderConfig {
  providerType: string;
  model?: string;
  apiKey?: string;
}

export interface SaveModelProviderSettingsInput {
  provider: string;
  modelName: string;
  apiKey?: string;
  clearApiKey?: boolean;
  updatedBy: string;
}

export class ModelProviderSettingsRepository {
  constructor(
    private readonly db: DatabaseClient,
    private readonly encryptionKey: string
  ) {}

  public async getPublic(): Promise<ModelProviderPublicSettings | null> {
    const result = await this.db.query(
      `SELECT provider, model_name, encrypted_api_key, api_key_fingerprint, updated_by, updated_at
       FROM model_provider_settings
       WHERE id = 'singleton'`
    );
    const row = result.rows[0];
    if (!row) return null;

    return {
      provider: String(row.provider),
      modelName: String(row.model_name),
      hasApiKey: Boolean(row.encrypted_api_key),
      apiKeyFingerprint: row.api_key_fingerprint ? String(row.api_key_fingerprint) : null,
      updatedBy: String(row.updated_by),
      updatedAt: row.updated_at
    };
  }

  public async getRuntimeConfig(): Promise<PersistedModelProviderConfig | undefined> {
    const result = await this.db.query(
      `SELECT provider, model_name, encrypted_api_key
       FROM model_provider_settings
       WHERE id = 'singleton'`
    );
    const row = result.rows[0];
    if (!row) return undefined;

    return {
      providerType: String(row.provider),
      model: String(row.model_name),
      // An explicit empty key prevents the process environment from silently
      // reactivating a credential after the owner clears the persisted key.
      apiKey: row.encrypted_api_key ? this.decrypt(String(row.encrypted_api_key)) : ''
    };
  }

  public async save(input: SaveModelProviderSettingsInput): Promise<ModelProviderPublicSettings> {
    const encryptedApiKey = input.apiKey ? this.encrypt(input.apiKey) : null;
    const fingerprint = input.apiKey ? fingerprintApiKey(input.apiKey) : null;
    const result = await this.db.query(
      `INSERT INTO model_provider_settings
         (id, provider, model_name, encrypted_api_key, api_key_fingerprint, updated_by, updated_at)
       VALUES ('singleton', $1, $2, $3, $4, $5, NOW())
       ON CONFLICT (id) DO UPDATE SET
         provider = EXCLUDED.provider,
         model_name = EXCLUDED.model_name,
         encrypted_api_key = CASE
           WHEN $6::boolean THEN NULL
           WHEN $3::text IS NOT NULL THEN EXCLUDED.encrypted_api_key
           ELSE model_provider_settings.encrypted_api_key
         END,
         api_key_fingerprint = CASE
           WHEN $6::boolean THEN NULL
           WHEN $3::text IS NOT NULL THEN EXCLUDED.api_key_fingerprint
           ELSE model_provider_settings.api_key_fingerprint
         END,
         updated_by = EXCLUDED.updated_by,
         updated_at = NOW()
       RETURNING provider, model_name, encrypted_api_key, api_key_fingerprint, updated_by, updated_at`,
      [input.provider, input.modelName, encryptedApiKey, fingerprint, input.updatedBy, Boolean(input.clearApiKey)]
    );
    const row = result.rows[0];
    if (!row) throw new Error('Model provider settings were not persisted.');

    return mapPublicSettings(row);
  }

  public async clear(updatedBy: string): Promise<boolean> {
    const result = await this.db.query(
      `UPDATE model_provider_settings
       SET encrypted_api_key = NULL,
           api_key_fingerprint = NULL,
           updated_by = $1,
           updated_at = NOW()
       WHERE id = 'singleton'`,
      [updatedBy]
    );
    return (result.rowCount || 0) > 0;
  }

  private encrypt(value: string): string {
    const key = deriveKey(this.encryptionKey);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return ['v1', iv.toString('base64url'), authTag.toString('base64url'), ciphertext.toString('base64url')].join(':');
  }

  private decrypt(value: string): string {
    const [version, ivValue, tagValue, ciphertextValue] = value.split(':');
    if (version !== 'v1' || !ivValue || !tagValue || !ciphertextValue) {
      throw new Error('Stored model provider credential has an unsupported format.');
    }

    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(this.encryptionKey), Buffer.from(ivValue, 'base64url'));
      decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
      return Buffer.concat([decipher.update(Buffer.from(ciphertextValue, 'base64url')), decipher.final()]).toString('utf8');
    } catch {
      throw new Error('Stored model provider credential could not be decrypted.');
    }
  }
}

function deriveKey(encryptionKey: string): Buffer {
  return crypto.createHash('sha256').update(encryptionKey, 'utf8').digest();
}

function fingerprintApiKey(apiKey: string): string {
  return crypto.createHash('sha256').update(apiKey, 'utf8').digest('hex').slice(0, 12);
}

function mapPublicSettings(row: any): ModelProviderPublicSettings {
  return {
    provider: String(row.provider),
    modelName: String(row.model_name),
    hasApiKey: Boolean(row.encrypted_api_key),
    apiKeyFingerprint: row.api_key_fingerprint ? String(row.api_key_fingerprint) : null,
    updatedBy: String(row.updated_by),
    updatedAt: row.updated_at
  };
}
