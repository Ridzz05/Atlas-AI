import { EnvConfig } from '@atlas/shared';

export interface TelegramBotConfig {
  botToken: string;
  allowedUserIds: Set<string>;
  /**
   * Explicit opt-in to accept every Telegram user, granted only in development with no allowlist.
   *
   * The guard used to fail open by itself whenever the allowlist was empty, which meant any
   * deployment whose NODE_ENV was not exactly 'production' accepted every Telegram user — and a
   * Telegram user can create tasks, approve side effects and trigger an emergency stop. The
   * decision lives here now, where the environment is interpreted, and the guard only enforces it.
   */
  allowAllUsers: boolean;
  webhookSecret?: string;
  isPolling: boolean;
}

export function parseTelegramConfig(env: EnvConfig): TelegramBotConfig {
  const allowed = (env.TELEGRAM_ALLOWED_USER_IDS || '')
    .split(',')
    .map(id => id.trim())
    .filter(Boolean);

  const botToken = env.TELEGRAM_BOT_TOKEN || '';
  if (env.NODE_ENV === 'production' && !botToken) {
    throw new Error('TELEGRAM_BOT_TOKEN is required in production.');
  }
  if (env.NODE_ENV === 'production' && allowed.length === 0) {
    throw new Error('TELEGRAM_ALLOWED_USER_IDS must contain at least one owner ID in production.');
  }

  return {
    botToken,
    allowedUserIds: new Set(allowed),
    allowAllUsers: allowed.length === 0 && env.NODE_ENV === 'development',
    webhookSecret: env.TELEGRAM_WEBHOOK_SECRET,
    isPolling: !env.TELEGRAM_WEBHOOK_SECRET
  };
}
