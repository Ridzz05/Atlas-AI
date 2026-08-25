import { EnvConfigSchema } from '@atlas/shared';
import { rootLogger } from '@atlas/observability';
import { buildServer } from './server.js';

async function main() {
  const config = EnvConfigSchema.parse(process.env);
  const server = buildServer({ config });

  const port = config.PORT || 4000;
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
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

if (process.env.NODE_ENV !== 'test') {
  main();
}
