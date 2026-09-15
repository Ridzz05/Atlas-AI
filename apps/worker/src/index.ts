import { EnvConfigSchema } from '@atlas/shared';
import { rootLogger } from '@atlas/observability';
import { createAtlasRuntime, createServiceHealthServer } from '@atlas/runtime';
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
    budgetRepo: runtime.budgetRepo,
    scheduledJobRepo: runtime.scheduledJobRepo,
    workflowCheckpointRepo: runtime.workflowCheckpointRepo,
    eventBus: runtime.eventBus,
    provider: runtime.provider,
    researchProvider: runtime.researchProvider,
    registry: runtime.registry,
    taskQueue: runtime.taskQueue
  });

  await runner.start();
  const healthServer = createServiceHealthServer(
    {
      service: 'worker',
      isRunning: () => runner.getStatus().isRunning,
      database: runtime.db,
      queue: runtime.taskQueue
    },
    { port: config.WORKER_HEALTH_PORT }
  );
  await healthServer.start();

  const shutdown = async (signal: string) => {
    rootLogger.info(`Received ${signal}, shutting down worker...`);
    await healthServer.stop();
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
