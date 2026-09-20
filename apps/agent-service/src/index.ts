import { EnvConfigSchema } from '@atlas/shared';
import { rootLogger } from '@atlas/observability';
import { createAtlasRuntime } from '@atlas/runtime';
import { buildServer } from './server.js';

// ATLAS agent-service entrypoint
async function main() {
  const config = EnvConfigSchema.parse(process.env);
  const runtime = await createAtlasRuntime(config);
  try {
    const recovered = await runtime.runRepo.recoverStaleRuns();
    if (recovered > 0) {
      rootLogger.info(`Cleaned up ${recovered} stale runs/orphaned tasks on startup`);
    }
  } catch (err) {
    rootLogger.warn('Failed to recover stale runs on startup', { error: String(err) });
  }
  const server = buildServer({
    config,
    db: runtime.db,
    taskRepo: runtime.taskRepo,
    runRepo: runtime.runRepo,
    approvalRepo: runtime.approvalRepo,
    eventRepo: runtime.eventRepo,
    artifactRepo: runtime.artifactRepo,
    auditRepo: runtime.auditRepo,
    memoryStore: runtime.memoryStore,
    controlStateRepo: runtime.telegramStateRepo,
    messageRepo: runtime.messageRepo,
    toolCallRepo: runtime.toolCallRepo,
    budgetRepo: runtime.budgetRepo,
    rubricRepo: runtime.rubricRepo,
    modelProviderSettingsRepo: runtime.modelProviderSettingsRepo,
    scheduledJobRepo: runtime.scheduledJobRepo,
    workflowCheckpointRepo: runtime.workflowCheckpointRepo,
    sdlcRepo: runtime.sdlcRepo,
    sdlcEngine: runtime.sdlcEngine,
    eventBus: runtime.eventBus,
    provider: runtime.provider,
    registry: runtime.registry,
    taskQueue: runtime.taskQueue,
    redisUrl: config.REDIS_URL,
    processQueue: false
  });

  // The schema guarantees a whole positive number, so there is nothing to paper over. The old
  // `config.PORT || 4000` silently listened on 4000 for a PORT that coerced to 0, which is how a
  // blank PORT went unnoticed: the operator's value was reported by the schema and ignored by the server.
  const port = config.PORT;
  const host = '0.0.0.0';

  try {
    await server.listen({ port, host });
    rootLogger.info(`ATLAS agent-service listening at http://${host}:${port}`, {
      port,
      nodeEnv: config.NODE_ENV
    });
  } catch (err) {
    rootLogger.error('Failed to start ATLAS agent-service', { error: String(err) });
    process.exit(1);
  }

  const shutdown = async (signal: string) => {
    rootLogger.info(`Received ${signal}, closing agent-service gracefully...`);
    await server.close();
    await runtime.close();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

if (process.env.NODE_ENV !== 'test') {
  main();
}
