import { EnvConfigSchema } from '@atlas/shared';
import { rootLogger } from '@atlas/observability';
import { parseTelegramConfig } from './config.js';
import { AtlasTelegramBot } from './bot.js';

async function main() {
  const env = EnvConfigSchema.parse(process.env);
  const config = parseTelegramConfig(env);

  const bot = new AtlasTelegramBot({ config });
  await bot.start();

  const shutdown = async (signal: string) => {
    rootLogger.info(`Received ${signal}, shutting down Telegram bot...`);
    await bot.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

if (process.env.NODE_ENV !== 'test') {
  main();
}
