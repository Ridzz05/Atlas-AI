import { EnvConfigSchema } from '@atlas/shared';
import { rootLogger } from '@atlas/observability';
import { createAtlasRuntime } from '@atlas/runtime';
import { parseTelegramConfig } from './config.js';
import { AtlasTelegramBot } from './bot.js';

async function main() {
  const env = EnvConfigSchema.parse(process.env);
  const config = parseTelegramConfig(env);
  const runtime = await createAtlasRuntime(env);

  const bot = new AtlasTelegramBot({
    config,
    taskRepo: runtime.taskRepo,
    registry: runtime.registry,
    taskQueue: runtime.taskQueue
  });
  await bot.start();

  const shutdown = async (signal: string) => {
    rootLogger.info(`Received ${signal}, shutting down Telegram bot...`);
    await bot.stop();
    await runtime.close();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

if (process.env.NODE_ENV !== 'test') {
  main();
}
