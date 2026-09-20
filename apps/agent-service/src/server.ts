import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';
import { rootLogger, AuditService } from '@atlas/observability';
import { EnvConfig } from '@atlas/shared';
import {
  ApprovalRepository,
  ArtifactRepository,
  AuditRepository,
  BudgetRepository,
  DatabaseClient,
  LeadRubricRepository,
  SystemEventRepository,
  TaskRepository,
  RunRepository,
  TelegramStateRepository,
  MessageRepository,
  ToolCallRepository,
  ModelProviderSettingsRepository
} from '@atlas/database';
import { MemoryStore, SecondBrainService } from '@atlas/memory';
import { EventBus, InMemoryEventBus } from '@atlas/events';
import { createModelProvider, ModelProvider } from '@atlas/providers';
import { defaultAgentRegistry, AgentRegistry } from '@atlas/agents';
import { AgentRunner, TaskDelegator, InMemoryTaskQueue, TaskQueue } from '@atlas/orchestration';
import { registerTaskRoutes } from './routes/tasks.js';
import { registerRunRoutes } from './routes/runs.js';
import { registerApprovalRoutes } from './routes/approvals.js';
import { registerEventRoutes } from './routes/events.js';
import { registerMetadataRoutes } from './routes/metadata.js';
import { registerControlRoutes } from './routes/control.js';
import { registerRubricRoutes } from './routes/rubrics.js';
import { registerModelProviderRoutes } from './routes/model-provider.js';
import { registerSecondBrainRoutes, findVaultPath } from './routes/second-brain.js';
import { registerAutomationRoutes } from './routes/automations.js';
import { registerSDLCRoutes } from './routes/sdlc.js';
import { SDLCEngine } from '@atlas/orchestration';
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
  secondBrainService?: SecondBrainService;
  controlStateRepo?: TelegramStateRepository;
  messageRepo?: MessageRepository;

  toolCallRepo?: ToolCallRepository;
  budgetRepo?: BudgetRepository;
  rubricRepo?: LeadRubricRepository;
  modelProviderSettingsRepo?: ModelProviderSettingsRepository;
  scheduledJobRepo?: import('@atlas/database').ScheduledJobRepository;
  workflowCheckpointRepo?: import('@atlas/database').WorkflowCheckpointRepository;
  sdlcRepo?: import('@atlas/database').SDLCRepository;
  sdlcEngine?: import('@atlas/orchestration').SDLCEngine;
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
  const rateLimiter =
    options.rateLimiter ||
    (options.redisUrl
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

  /**
   * One place where an unhandled route error becomes a response.
   *
   * Without this, Fastify's default handler serialised `error.message` straight into the 500 body
   * and, because the server runs with `logger: false`, wrote no server-side log line at all. A
   * failing repository therefore handed the caller the table name, the database host and port, or
   * an absolute filesystem path, while the operator had nothing to correlate with the response's
   * `x-request-id`.
   *
   * A deliberate 4xx (a validation rejection, a 404 from a route) keeps its status and its message:
   * those are the caller's to act on. Anything else is logged in full, server-side, and answered
   * generically.
   */
  app.setErrorHandler((error: unknown, req, reply) => {
    const failure = error as { statusCode?: number; message?: string; stack?: string };
    const statusCode = failure.statusCode && failure.statusCode >= 400 && failure.statusCode < 500 ? failure.statusCode : 500;
    const requestId = reply.getHeader('x-request-id');
    const message = failure.message || 'Unexpected error';

    if (statusCode < 500) {
      return reply.status(statusCode).send({ error: message });
    }

    rootLogger.error('Unhandled API error', {
      requestId,
      method: req.method,
      url: req.url,
      error: message,
      stack: failure.stack
    });

    return reply.status(500).send({ error: 'Internal server error. Use the x-request-id header to correlate with server logs.' });
  });

  app.addHook('onClose', async () => {
    if (ownsRateLimiter) {
      await rateLimiter.close();
    }
  });

  const allowedOrigins = options.config.CORS_ALLOWED_ORIGINS.split(',')
    .map(origin => origin.trim())
    .filter(Boolean);
  app.register(cors, { origin: allowedOrigins });

  app.addHook('onRequest', async (req, reply) => {
    const requestPath = req.url.split('?')[0] || '';
    const isPublicHealthEndpoint = requestPath === '/health' || requestPath === '/ready';
    const incomingRequestId = req.headers['x-request-id'];
    const requestId =
      typeof incomingRequestId === 'string' && /^[A-Za-z0-9._-]{1,128}$/.test(incomingRequestId) ? incomingRequestId : crypto.randomUUID();
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
      const providedToken = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : '';
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
  const provider =
    options.provider ||
    createModelProvider({
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
    taskQueue.process(options.config.MAX_CONCURRENT_AGENT_RUNS, async job => {
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
      eventBus,
      db: options.db,
      messageRepo: options.messageRepo,
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

  registerRubricRoutes(app, {
    rubricRepo: options.rubricRepo,
    auditRepo: options.auditRepo
  });

  registerModelProviderRoutes(app, {
    modelProviderSettingsRepo: options.modelProviderSettingsRepo,
    auditRepo: options.auditRepo
  });

  // The SDLC engine coordinates phases as ordinary tasks, so it needs the same task
  // repository and queue the rest of the control plane uses. The composition root already
  // builds one; it is reused here so the API and the worker share the same coordinator.
  if (options.sdlcRepo) {
    const sdlcEngine =
      options.sdlcEngine ||
      (options.taskRepo ? new SDLCEngine({ sdlcRepo: options.sdlcRepo, taskRepo: options.taskRepo, taskQueue, registry }) : undefined);

    if (sdlcEngine) {
      registerSDLCRoutes(app, {
        sdlcRepo: options.sdlcRepo,
        sdlcEngine,
        controlStateRepo: options.controlStateRepo
      });
    }
  }

  const secondBrainService =
    options.secondBrainService ||
    new SecondBrainService(
      undefined,
      options.provider
        ? async ({ systemPrompt, userPrompt }) => {
            const res = await options.provider!.run({
              runId: crypto.randomUUID(),
              agentId: 'chief',
              systemPrompt,
              messages: [{ role: 'user', content: userPrompt }]
            });
            return res.content;
          }
        : undefined
    );
  registerSecondBrainRoutes(app, {
    secondBrainService
  });

  // Auto-ingest local Obsidian vault on startup so Second Brain is immediately populated
  const defaultVaultPath = findVaultPath();
  if (defaultVaultPath) {
    rootLogger.info(`Auto-ingesting Second Brain vault from: ${defaultVaultPath}`);
    void secondBrainService
      .ingestVaultDirectory(defaultVaultPath)
      .then(res => {
        rootLogger.info(`Second Brain vault auto-ingest completed: ${res.ingested} notes indexed.`);
      })
      .catch(err => {
        rootLogger.warn('Second Brain vault auto-ingest failed', { error: String(err) });
      });
  }

  registerAutomationRoutes(app, {
    taskRepo: options.taskRepo,
    taskQueue,
    registry,
    scheduledJobRepo: options.scheduledJobRepo,
    workflowCheckpointRepo: options.workflowCheckpointRepo,
    controlStateRepo: options.controlStateRepo
  });

  app.get('/api/v1/settings', async (_req, reply) => {
    let persistedModelSettings = null;
    if (options.modelProviderSettingsRepo) {
      try {
        persistedModelSettings = await options.modelProviderSettingsRepo.getPublic();
      } catch {
        return reply.status(503).send({ error: 'Model provider settings are unavailable.' });
      }
    }

    const effectiveModelProvider = persistedModelSettings?.provider || options.config.MODEL_PROVIDER;
    return reply.status(200).send({
      data: {
        nodeEnv: options.config.NODE_ENV,
        modelProvider: effectiveModelProvider,
        modelName: persistedModelSettings?.modelName || options.config.MODEL_NAME || null,
        modelConfigured: persistedModelSettings?.hasApiKey ?? Boolean(options.config.MODEL_API_KEY),
        modelKeyFingerprint: persistedModelSettings?.apiKeyFingerprint || null,
        modelConfigSource: persistedModelSettings ? 'database' : 'environment',
        globalDailyBudgetUsd: options.config.GLOBAL_DAILY_BUDGET_USD,
        maxConcurrentAgentRuns: options.config.MAX_CONCURRENT_AGENT_RUNS,
        maxDelegationDepth: options.config.MAX_DELEGATION_DEPTH,
        externalWritesEnabled: options.config.EXTERNAL_WRITES_ENABLED,
        apiAuthRequired: Boolean(options.config.API_AUTH_TOKEN),
        corsAllowedOrigins: options.config.CORS_ALLOWED_ORIGINS.split(',')
          .map(origin => origin.trim())
          .filter(Boolean),
        source: persistedModelSettings ? 'database' : 'environment',
        mutable: Boolean(options.modelProviderSettingsRepo),
        telegramConfigured: Boolean(options.config.TELEGRAM_BOT_TOKEN),
        telegramAllowedUserIds: options.config.TELEGRAM_ALLOWED_USER_IDS || '',
        telegramTokenMasked: options.config.TELEGRAM_BOT_TOKEN
          ? options.config.TELEGRAM_BOT_TOKEN.slice(0, 4) + '••••••••' + options.config.TELEGRAM_BOT_TOKEN.slice(-4)
          : null
      }
    });
  });

  // Update Telegram Bot Configuration
  app.put('/api/v1/settings/telegram', async (req, reply) => {
    // Values written here go straight into the .env file, so a line break in the payload
    // would inject arbitrary environment lines (e.g. "API_AUTH_TOKEN=" to disable API
    // authentication on the next boot). Reject line breaks outright.
    const EnvValueSchema = z
      .string()
      .trim()
      .max(512)
      .refine(value => !/[\r\n]/.test(value), { message: 'must not contain line breaks' });

    const TelegramSettingsSchema = z.object({
      botToken: EnvValueSchema.optional(),
      allowedUserIds: EnvValueSchema.optional()
    });
    const parse = TelegramSettingsSchema.safeParse(req.body);
    if (!parse.success) {
      return reply.status(400).send({ error: 'Invalid telegram settings payload', details: parse.error.format() });
    }
    const { botToken, allowedUserIds } = parse.data;

    if (botToken !== undefined) {
      process.env.TELEGRAM_BOT_TOKEN = botToken;
      options.config.TELEGRAM_BOT_TOKEN = botToken;
    }
    if (allowedUserIds !== undefined) {
      process.env.TELEGRAM_ALLOWED_USER_IDS = allowedUserIds;
      options.config.TELEGRAM_ALLOWED_USER_IDS = allowedUserIds;
    }

    const envPath = path.resolve(process.cwd(), '.env');
    try {
      if (fs.existsSync(envPath)) {
        let content = fs.readFileSync(envPath, 'utf8');
        if (botToken !== undefined) {
          if (content.includes('TELEGRAM_BOT_TOKEN=')) {
            content = content.replace(/TELEGRAM_BOT_TOKEN=.*(\r?\n|$)/, `TELEGRAM_BOT_TOKEN=${botToken}\n`);
          } else {
            content += `\nTELEGRAM_BOT_TOKEN=${botToken}\n`;
          }
        }
        if (allowedUserIds !== undefined) {
          if (content.includes('TELEGRAM_ALLOWED_USER_IDS=')) {
            content = content.replace(/TELEGRAM_ALLOWED_USER_IDS=.*(\r?\n|$)/, `TELEGRAM_ALLOWED_USER_IDS=${allowedUserIds}\n`);
          } else {
            content += `\nTELEGRAM_ALLOWED_USER_IDS=${allowedUserIds}\n`;
          }
        }
        fs.writeFileSync(envPath, content, 'utf8');
      }
    } catch (err) {
      rootLogger.warn('Failed to update .env file for Telegram settings', { error: String(err) });
    }

    if (options.auditRepo) {
      await options.auditRepo.create(
        AuditService.format({
          actor: 'owner-api',
          action: 'telegram.settings_updated',
          target: 'telegram',
          ipAddress: req.ip,
          details: {
            tokenUpdated: Boolean(botToken),
            allowedUserIds
          }
        })
      );
    }

    return reply.status(200).send({
      success: true,
      data: {
        telegramConfigured: Boolean(options.config.TELEGRAM_BOT_TOKEN),
        telegramAllowedUserIds: options.config.TELEGRAM_ALLOWED_USER_IDS || '',
        telegramTokenMasked: options.config.TELEGRAM_BOT_TOKEN
          ? options.config.TELEGRAM_BOT_TOKEN.slice(0, 4) + '••••••••' + options.config.TELEGRAM_BOT_TOKEN.slice(-4)
          : null
      }
    });
  });

  return app;
}
