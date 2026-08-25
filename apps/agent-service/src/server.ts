import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { rootLogger } from '@atlas/observability';
import { EnvConfig } from '@atlas/shared';
import { DatabaseClient, TaskRepository, RunRepository } from '@atlas/database';
import { EventBus, InMemoryEventBus } from '@atlas/events';
import { createModelProvider, ModelProvider } from '@atlas/providers';
import { defaultAgentRegistry, AgentRegistry } from '@atlas/agents';
import {
  AgentRunner,
  TaskDelegator,
  InMemoryTaskQueue,
  TaskQueue
} from '@atlas/orchestration';
import { registerTaskRoutes } from './routes/tasks.js';
import { registerRunRoutes } from './routes/runs.js';

export interface ServerOptions {
  config: EnvConfig;
  db?: DatabaseClient;
  taskRepo?: TaskRepository;
  runRepo?: RunRepository;
  provider?: ModelProvider;
  eventBus?: EventBus;
  registry?: AgentRegistry;
  taskQueue?: TaskQueue;
  processQueue?: boolean;
}

export function buildServer(options: ServerOptions): FastifyInstance {
  const app = Fastify({ logger: false });

  app.register(cors, { origin: true });

  const eventBus = options.eventBus || new InMemoryEventBus();
  const registry = options.registry || defaultAgentRegistry;
  const provider = options.provider || createModelProvider({
    providerType: options.config.MODEL_PROVIDER,
    apiKey: options.config.MODEL_API_KEY
  });

  const runner = new AgentRunner({
    provider,
    eventBus,
    taskRepo: options.taskRepo,
    runRepo: options.runRepo
  });

  const delegator = new TaskDelegator({
    provider,
    registry,
    eventBus,
    taskRepo: options.taskRepo,
    runRepo: options.runRepo,
    maxConcurrency: options.config.MAX_CONCURRENT_AGENT_RUNS
  });

  const taskQueue = options.taskQueue || new InMemoryTaskQueue();
  if (options.processQueue !== false) {
    taskQueue.process(options.config.MAX_CONCURRENT_AGENT_RUNS, async (job) => {
      if (job.agent.role === 'orchestrator') {
        return delegator.executePlan(job.task);
      }

      return runner.run({
        task: job.task,
        agent: job.agent,
        initialPrompt: job.prompt,
        runId: job.runId
      });
    });
  }

  // Health and readiness endpoints
  app.get('/health', async (_req, reply) => {
    return reply.status(200).send({
      status: 'ok',
      service: 'agent-service',
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    });
  });

  app.get('/ready', async (_req, reply) => {
    const dbHealthy = options.db ? await options.db.healthCheck() : true;
    return reply.status(dbHealthy ? 200 : 503).send({
      status: dbHealthy ? 'ready' : 'degraded',
      database: dbHealthy ? 'connected' : 'disconnected',
      timestamp: new Date().toISOString()
    });
  });

  app.get('/api/v1/info', async (_req, reply) => {
    return reply.status(200).send({
      name: 'ATLAS AI OS Agent Service',
      version: '0.1.0',
      agentsCount: registry.list().length,
      nodeEnv: options.config.NODE_ENV
    });
  });

  // Agent definitions endpoint
  app.get('/api/v1/agents', async (_req, reply) => {
    return reply.status(200).send({
      data: registry.list()
    });
  });

  // Register task and run routes if task repository is provided
  if (options.taskRepo) {
    registerTaskRoutes(app, {
      taskRepo: options.taskRepo,
      taskQueue,
      getAgentDefinition: (id: string) => registry.getOrThrow(id)
    });
  }

  registerRunRoutes(app, {
    runner,
    runRepo: options.runRepo
  });

  app.addHook('onRequest', async (req) => {
    rootLogger.debug('Incoming request', {
      method: req.method,
      url: req.url,
      ip: req.ip
    });
  });

  return app;
}
