import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import * as crypto from 'node:crypto';
import { rootLogger } from '@atlas/observability';
import { EnvConfig } from '@atlas/shared';
import { ApprovalRepository, ArtifactRepository, AuditRepository, BudgetRepository, DatabaseClient, SystemEventRepository, TaskRepository, RunRepository, TelegramStateRepository, MessageRepository, ToolCallRepository } from '@atlas/database';
import { MemoryStore } from '@atlas/memory';
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
import { registerApprovalRoutes } from './routes/approvals.js';
import { registerEventRoutes } from './routes/events.js';
import { registerMetadataRoutes } from './routes/metadata.js';
import { registerControlRoutes } from './routes/control.js';
import { InMemoryRateLimiter, RateLimiter, RedisRateLimiter } from './rate-limit.js';

export interface ServerOptions {
  config: EnvConfig;
  db?: DatabaseClient;
  taskRepo?: TaskRepository;
  runRepo?: RunRepository;
  approvalRepo?: ApprovalRepository;
  eventRepo?: SystemEventRepository;
  artifactRepo?: ArtifactRepository;
  auditRepo?: AuditRepository;
  memoryStore?: MemoryStore;
  controlStateRepo?: TelegramStateRepository;
  messageRepo?: MessageRepository;
  toolCallRepo?: ToolCallRepository;
  budgetRepo?: BudgetRepository;
  provider?: ModelProvider;
  eventBus?: EventBus;
  registry?: AgentRegistry;
  taskQueue?: TaskQueue;
  redisUrl?: string;
  rateLimiter?: RateLimiter;
  processQueue?: boolean;
}

export function buildServer(options: ServerOptions): FastifyInstance {
  const app = Fastify({ logger: false });
  const rateLimitWindowMs = options.config.API_RATE_LIMIT_WINDOW_SECONDS * 1000;
  const rateLimitMax = options.config.API_RATE_LIMIT_MAX_REQUESTS;
  const rateLimiter = options.rateLimiter || (options.redisUrl
    ? new RedisRateLimiter({
      redisUrl: options.redisUrl,
      windowMs: rateLimitWindowMs,
      maxRequests: rateLimitMax
    })
    : new InMemoryRateLimiter({
      windowMs: rateLimitWindowMs,
      maxRequests: rateLimitMax
    }));
  const ownsRateLimiter = !options.rateLimiter;

  app.addHook('onClose', async () => {
    if (ownsRateLimiter) {
      await rateLimiter.close();
    }
  });

  const allowedOrigins = options.config.CORS_ALLOWED_ORIGINS
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);
  app.register(cors, { origin: allowedOrigins });

  app.addHook('onRequest', async (req, reply) => {
    const requestPath = req.url.split('?')[0] || '';
    const isPublicHealthEndpoint = requestPath === '/health' || requestPath === '/ready';
    const incomingRequestId = req.headers['x-request-id'];
    const requestId = typeof incomingRequestId === 'string' && /^[A-Za-z0-9._-]{1,128}$/.test(incomingRequestId)
      ? incomingRequestId
      : crypto.randomUUID();
    reply.header('x-request-id', requestId);

    if (!isPublicHealthEndpoint && requestPath.startsWith('/api/')) {
      const key = req.ip || 'unknown';
      try {
        const decision = await rateLimiter.check(key);
        if (!decision.allowed) {
          return reply
            .header('retry-after', String(decision.retryAfterSeconds || 1))
            .status(429)
            .send({ error: 'Too many API requests. Please retry later.' });
        }
      } catch (err) {
        rootLogger.error('Distributed rate limiter unavailable', { error: String(err) });
        return reply.status(503).send({ error: 'Rate limiter unavailable. Please retry later.' });
      }
    }

    const expectedToken = options.config.API_AUTH_TOKEN;

    if (expectedToken && !isPublicHealthEndpoint) {
      const authorization = req.headers.authorization || '';
      const providedToken = authorization.startsWith('Bearer ')
        ? authorization.slice('Bearer '.length)
        : '';
      const provided = Buffer.from(providedToken);
      const expected = Buffer.from(expectedToken);
      const valid = provided.length === expected.length && crypto.timingSafeEqual(provided, expected);

      if (!valid) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }
    }

    rootLogger.debug('Incoming request', {
      method: req.method,
      url: req.url,
      ip: req.ip,
      requestId
    });
  });

  const eventBus = options.eventBus || new InMemoryEventBus();
  const registry = options.registry || defaultAgentRegistry;
  const provider = options.provider || createModelProvider({
    providerType: options.config.MODEL_PROVIDER,
    apiKey: options.config.MODEL_API_KEY,
    baseUrl: options.config.MODEL_BASE_URL,
    model: options.config.MODEL_NAME
  });

  const runner = new AgentRunner({
    provider,
    eventBus,
    taskRepo: options.taskRepo,
    runRepo: options.runRepo,
    messageRepo: options.messageRepo,
    toolCallRepo: options.toolCallRepo,
    budgetRepo: options.budgetRepo,
    globalDailyBudgetUsd: options.config.GLOBAL_DAILY_BUDGET_USD,
    cancellationStore: options.runRepo
  });

  const delegator = new TaskDelegator({
    provider,
    registry,
    eventBus,
    taskRepo: options.taskRepo,
    runRepo: options.runRepo,
    messageRepo: options.messageRepo,
    toolCallRepo: options.toolCallRepo,
    budgetRepo: options.budgetRepo,
    globalDailyBudgetUsd: options.config.GLOBAL_DAILY_BUDGET_USD,
    maxConcurrency: options.config.MAX_CONCURRENT_AGENT_RUNS,
    maxDelegationDepth: options.config.MAX_DELEGATION_DEPTH,
    cancellationStore: options.runRepo
  });

  const taskQueue = options.taskQueue || new InMemoryTaskQueue();
  if (options.processQueue !== false) {
    taskQueue.process(options.config.MAX_CONCURRENT_AGENT_RUNS, async (job) => {
      if (options.controlStateRepo) {
        try {
          const controlState = await options.controlStateRepo.getControlState();
          if (controlState.paused || controlState.emergencyStop) {
            if (taskQueue.defer) {
              await taskQueue.defer(job, 5000);
            }
            rootLogger.warn('Deferring task while execution control state is locked', {
              taskId: job.task.id,
              state: controlState.emergencyStop ? 'emergency_stop' : 'paused'
            });
            return { status: 'deferred' };
          }
        } catch (err) {
          if (taskQueue.defer) {
            await taskQueue.defer(job, 5000);
          }
          rootLogger.error('Execution control state unavailable; task deferred', {
            taskId: job.task.id,
            error: String(err)
          });
          return { status: 'deferred' };
        }
      }

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
    let queueHealthy = false;
    try {
      queueHealthy = await taskQueue.healthCheck();
    } catch {
      queueHealthy = false;
    }
    const ready = dbHealthy && queueHealthy;
    return reply.status(ready ? 200 : 503).send({
      status: ready ? 'ready' : 'degraded',
      database: dbHealthy ? 'connected' : 'disconnected',
      queue: queueHealthy ? 'connected' : 'disconnected',
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
      getAgentDefinition: (id: string) => registry.getOrThrow(id),
      controlStateRepo: options.controlStateRepo
    });
  }

  registerRunRoutes(app, {
    runner,
    runRepo: options.runRepo
  });

  if (options.approvalRepo) {
    registerApprovalRoutes(app, {
      approvalRepo: options.approvalRepo,
      taskRepo: options.taskRepo,
      taskQueue,
      getAgentDefinition: (id: string) => registry.getOrThrow(id)
    });
  }

  registerEventRoutes(app, {
    eventBus,
    eventRepo: options.eventRepo
  });

  registerMetadataRoutes(app, {
    artifactRepo: options.artifactRepo,
    auditRepo: options.auditRepo,
    messageRepo: options.messageRepo,
    toolCallRepo: options.toolCallRepo,
    memoryStore: options.memoryStore,
    runRepo: options.runRepo,
    budgetRepo: options.budgetRepo
  });

  registerControlRoutes(app, {
    controlStateRepo: options.controlStateRepo,
    runRepo: options.runRepo
  });

  app.get('/api/v1/settings', async (_req, reply) => {
    return reply.status(200).send({
      data: {
        nodeEnv: options.config.NODE_ENV,
        modelProvider: options.config.MODEL_PROVIDER,
        globalDailyBudgetUsd: options.config.GLOBAL_DAILY_BUDGET_USD,
        maxConcurrentAgentRuns: options.config.MAX_CONCURRENT_AGENT_RUNS,
        maxDelegationDepth: options.config.MAX_DELEGATION_DEPTH,
        externalWritesEnabled: options.config.EXTERNAL_WRITES_ENABLED,
        apiAuthRequired: Boolean(options.config.API_AUTH_TOKEN),
        corsAllowedOrigins: options.config.CORS_ALLOWED_ORIGINS.split(',').map(origin => origin.trim()).filter(Boolean),
        source: 'environment',
        mutable: false
      }
    });
  });

  return app;
}
