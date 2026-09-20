import { describe, expect, it } from 'vitest';
import { EnvConfigSchema } from '@atlas/shared';
import { TelegramSecurityGuard } from '../src/security/guard.js';
import { parseTelegramConfig } from '../src/config.js';

/**
 * The allowlist must never fail open on its own.
 *
 * `isUserAllowed` returned true whenever the configured allowlist was empty, with only a warning.
 * `config.ts` refuses to boot in production without an allowlist, so the branch was unreachable
 * there — but any deployment whose NODE_ENV is not exactly 'production' (staging, a custom value,
 * or unset) booted the bot accepting EVERY Telegram user, and a Telegram user can create tasks,
 * approve side effects and trigger an emergency stop.
 *
 * The dev convenience is preserved, but it is now an explicit decision made in `config.ts` and
 * passed in — the guard fails closed unless it is told otherwise.
 */
describe('TelegramSecurityGuard allowlist', () => {
  it('denies every user when the allowlist is empty and no opt-in was given', () => {
    const guard = new TelegramSecurityGuard(new Set());

    expect(guard.isUserAllowed(12345678)).toBe(false);
    expect(guard.isUserAllowed('12345678')).toBe(false);
  });

  it('allows every user only when the opt-in is explicit', () => {
    const guard = new TelegramSecurityGuard(new Set(), undefined, { allowAllUsers: true });

    expect(guard.isUserAllowed(12345678)).toBe(true);
  });

  it('allows a listed user and denies everyone else', () => {
    const guard = new TelegramSecurityGuard(new Set(['12345678']));

    expect(guard.isUserAllowed(12345678)).toBe(true);
    expect(guard.isUserAllowed('12345678')).toBe(true);
    expect(guard.isUserAllowed(99999999)).toBe(false);
  });
});

describe('parseTelegramConfig allowlist decision', () => {
  /** Production requires several other vars before the allowlist is reached. */
  const productionEnv = {
    NODE_ENV: 'production',
    API_AUTH_TOKEN: 'a'.repeat(32),
    ENCRYPTION_KEY: 'b'.repeat(32),
    MODEL_PROVIDER: 'openai',
    MODEL_API_KEY: 'key',
    MODEL_NAME: 'gpt-4o-mini',
    TELEGRAM_BOT_TOKEN: 'token'
  };

  it('refuses to boot in production without an owner id', () => {
    expect(() => parseTelegramConfig(EnvConfigSchema.parse({ ...productionEnv, TELEGRAM_ALLOWED_USER_IDS: '' }))).toThrow(
      /TELEGRAM_ALLOWED_USER_IDS/
    );
  });

  it('does not opt in to accepting everyone outside development', () => {
    // NODE_ENV is an enum of development | test | production, so `test` is the non-production value
    // that is not the dev convenience — a CI or staging-style run must still fail closed.
    const config = parseTelegramConfig(
      EnvConfigSchema.parse({ NODE_ENV: 'test', TELEGRAM_BOT_TOKEN: 'token', TELEGRAM_ALLOWED_USER_IDS: '' })
    );

    expect(config.allowAllUsers).toBe(false);
    expect(config.allowedUserIds.size).toBe(0);
  });

  it('opts in explicitly in development so local runs stay usable', () => {
    const config = parseTelegramConfig(
      EnvConfigSchema.parse({ NODE_ENV: 'development', TELEGRAM_BOT_TOKEN: 'token', TELEGRAM_ALLOWED_USER_IDS: '' })
    );

    expect(config.allowAllUsers).toBe(true);
  });

  it('never opts in when an owner id is configured', () => {
    const config = parseTelegramConfig(
      EnvConfigSchema.parse({ NODE_ENV: 'development', TELEGRAM_BOT_TOKEN: 'token', TELEGRAM_ALLOWED_USER_IDS: '42' })
    );

    expect(config.allowAllUsers).toBe(false);
    expect(config.allowedUserIds.has('42')).toBe(true);
  });
});
