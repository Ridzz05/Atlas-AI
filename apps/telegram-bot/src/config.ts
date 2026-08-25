import { EnvConfig } from '@atlas/shared';

export interface TelegramBotConfig {
  botToken: string;
  allowedUserIds: Set<string>;
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
    webhookSecret: env.TELEGRAM_WEBHOOK_SECRET,
    isPolling: !env.TELEGRAM_WEBHOOK_SECRET
  };
}
