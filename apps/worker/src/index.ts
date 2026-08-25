import { EnvConfigSchema } from '@atlas/shared';
import { rootLogger } from '@atlas/observability';
import { AgentWorkerRunner } from './worker.js';

async function main() {
  const config = EnvConfigSchema.parse(process.env);
  const runner = new AgentWorkerRunner({ config });

  await runner.start();

  const shutdown = async (signal: string) => {
    rootLogger.info(`Received ${signal}, shutting down worker...`);
    await runner.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

if (process.env.NODE_ENV !== 'test') {
  main();
}
