import { EnvConfigSchema } from '@atlas/shared';
import { rootLogger } from '@atlas/observability';
import { createAtlasRuntime } from '@atlas/runtime';
import { AgentWorkerRunner } from './worker.js';

async function main() {
  const config = EnvConfigSchema.parse(process.env);
  const runtime = await createAtlasRuntime(config);
  const runner = new AgentWorkerRunner({
    config,
    db: runtime.db,
    taskRepo: runtime.taskRepo,
    runRepo: runtime.runRepo,
    approvalRepo: runtime.approvalRepo,
    artifactRepo: runtime.artifactRepo,
    auditRepo: runtime.auditRepo,
    controlStateRepo: runtime.telegramStateRepo,
    memoryStore: runtime.memoryStore,
    messageRepo: runtime.messageRepo,
    toolCallRepo: runtime.toolCallRepo,
    eventBus: runtime.eventBus,
    provider: runtime.provider,
    registry: runtime.registry,
    taskQueue: runtime.taskQueue
  });

  await runner.start();

  const shutdown = async (signal: string) => {
    rootLogger.info(`Received ${signal}, shutting down worker...`);
    await runner.stop();
    await runtime.close();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

if (process.env.NODE_ENV !== 'test') {
  main();
}
