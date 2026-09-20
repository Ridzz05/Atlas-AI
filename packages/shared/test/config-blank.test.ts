import { describe, expect, it } from 'vitest';
import { EnvConfigSchema } from '../src/schemas/config.js';

/**
 * One convention for a blank environment value.
 *
 * The schema answered "what does a blank mean?" three different ways — `EmptyStringAsUndefined` on two
 * keys, `value === ''` on three, `value.trim()` on two — and left the rest with no rule at all, so `''`
 * and `'   '` were ordinary values for them. That made several declared defaults unreachable and let a
 * key that cannot authenticate satisfy a production guard.
 */
const productionEnv = {
  NODE_ENV: 'production',
  API_AUTH_TOKEN: 'a'.repeat(32),
  ENCRYPTION_KEY: 'b'.repeat(64),
  DATABASE_URL: 'postgresql://atlas:pw@localhost:5432/atlas',
  REDIS_URL: 'redis://localhost:6379',
  MODEL_PROVIDER: 'groq',
  MODEL_NAME: 'llama-3.3-70b',
  MODEL_API_KEY: 'a-real-key'
};

describe('blank environment values', () => {
  it('treats a whitespace-only secret as missing in production', () => {
    // It used to parse to '   ' and pass the truthiness guard, so every service booted in production
    // with a key that cannot authenticate and the failure surfaced per-run at provider time.
    expect(() => EnvConfigSchema.parse({ ...productionEnv, MODEL_API_KEY: '   ' })).toThrow(/MODEL_API_KEY/);
    expect(() => EnvConfigSchema.parse({ ...productionEnv, MODEL_API_KEY: '' })).toThrow(/MODEL_API_KEY/);
  });

  it('treats a whitespace-only telegram token as missing', () => {
    expect(EnvConfigSchema.parse({ ...productionEnv, TELEGRAM_BOT_TOKEN: '   ' }).TELEGRAM_BOT_TOKEN).toBeUndefined();
    expect(EnvConfigSchema.parse({ ...productionEnv, TELEGRAM_ALLOWED_USER_IDS: '  ' }).TELEGRAM_ALLOWED_USER_IDS).toBeUndefined();
  });

  it('lets a blank PORT fall back to its default instead of 0', () => {
    // z.coerce.number() maps '' to 0, and a present-but-blank key never reaches .default().
    expect(EnvConfigSchema.parse({ PORT: '' }).PORT).toBe(4000);
    expect(EnvConfigSchema.parse({ PORT: '  ' }).PORT).toBe(4000);
  });

  it('rejects a PORT that is not a whole positive number', () => {
    expect(() => EnvConfigSchema.parse({ PORT: '4000.5' })).toThrow();
    expect(() => EnvConfigSchema.parse({ PORT: '-1' })).toThrow();
    expect(EnvConfigSchema.parse({ PORT: '8080' }).PORT).toBe(8080);
  });

  it('lets a blank boolean fall back to its declared default', () => {
    // StrictBooleanFromEnvSchema returned false for '', so `.default(true)` could never apply and one
    // blank line in .env turned off every scheduled job with no warning.
    expect(EnvConfigSchema.parse({ AUTOMATION_ENABLED: '' }).AUTOMATION_ENABLED).toBe(true);
    expect(EnvConfigSchema.parse({ WORKFLOW_AUTOMATION_ENABLED: '   ' }).WORKFLOW_AUTOMATION_ENABLED).toBe(true);
    // The safety flag keeps its fail-closed default, because that default is false.
    expect(EnvConfigSchema.parse({ EXTERNAL_WRITES_ENABLED: '' }).EXTERNAL_WRITES_ENABLED).toBe(false);
  });

  it('still honours an explicit boolean value', () => {
    expect(EnvConfigSchema.parse({ AUTOMATION_ENABLED: 'false' }).AUTOMATION_ENABLED).toBe(false);
    expect(EnvConfigSchema.parse({ EXTERNAL_WRITES_ENABLED: 'true' }).EXTERNAL_WRITES_ENABLED).toBe(true);
  });

  it('lets a blank research country and language fall back to their defaults', () => {
    // Both threw 'Invalid' for a blank value, refusing to boot every service over a variable
    // .env.example documents as optional.
    expect(EnvConfigSchema.parse({ RESEARCH_COUNTRY: '' }).RESEARCH_COUNTRY).toBe('ID');
    expect(EnvConfigSchema.parse({ RESEARCH_SEARCH_LANG: '  ' }).RESEARCH_SEARCH_LANG).toBe('id');
    expect(EnvConfigSchema.parse({ RESEARCH_COUNTRY: 'us' }).RESEARCH_COUNTRY).toBe('US');
  });

  it('applies the same rule to the plain string defaults', () => {
    expect(EnvConfigSchema.parse({ CORS_ALLOWED_ORIGINS: '' }).CORS_ALLOWED_ORIGINS).toBe('http://localhost:3000');
    expect(EnvConfigSchema.parse({ ARTIFACT_STORAGE_PATH: '   ' }).ARTIFACT_STORAGE_PATH).toBe('./data/artifacts');
    expect(EnvConfigSchema.parse({ DATABASE_URL: '' }).DATABASE_URL).toBe('postgresql://atlas:***@localhost:5432/atlas');
  });
});
