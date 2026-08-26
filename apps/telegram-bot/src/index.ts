import { EnvConfigSchema } from '@atlas/shared';
import { rootLogger } from '@atlas/observability';
import { createAtlasRuntime, createServiceHealthServer } from '@atlas/runtime';
import { parseTelegramConfig } from './config.js';
import { AtlasTelegramBot } from './bot.js';

async function main() {
  const env = EnvConfigSchema.parse(process.env);
  const config = parseTelegramConfig(env);
  const runtime = await createAtlasRuntime(env);

  const bot = new AtlasTelegramBot({
    config,
    db: runtime.db,
    taskRepo: runtime.taskRepo,
    messageRepo: runtime.messageRepo,
    runRepo: runtime.runRepo,
    budgetRepo: runtime.budgetRepo,
    approvalRepo: runtime.approvalRepo,
    stateRepo: runtime.telegramStateRepo,
    registry: runtime.registry,
    taskQueue: runtime.taskQueue
  });
  await bot.start();
  const healthServer = createServiceHealthServer({
    service: 'telegram-bot',
    isRunning: () => bot.getStatus().isRunning,
    database: runtime.db,
    queue: runtime.taskQueue
  });
  await healthServer.start();

  const shutdown = async (signal: string) => {
    rootLogger.info(`Received ${signal}, shutting down Telegram bot...`);
    await healthServer.stop();
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
