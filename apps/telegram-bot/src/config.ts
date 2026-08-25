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

  return {
    botToken: env.TELEGRAM_BOT_TOKEN || '',
    allowedUserIds: new Set(allowed),
    webhookSecret: env.TELEGRAM_WEBHOOK_SECRET,
    isPolling: !env.TELEGRAM_WEBHOOK_SECRET
  };
}
