import { FastifyInstance } from 'fastify';
import { AuditRepository, ModelProviderSettingsRepository, PersistedModelProviderConfig } from '@atlas/database';
import { AuditService } from '@atlas/observability';
import { createModelProvider } from '@atlas/providers';
import {
  EnvConfig,
  MODEL_PROVIDER_IDS,
  defaultModelForProvider,
  isModelProviderAllowedInEnvironment,
  isModelProviderId
} from '@atlas/shared';
import { z } from 'zod';

const ModelProviderMutationSchema = z
  .object({
    provider: z.string().trim().default('openrouter'),
    modelName: z.string().trim().optional(),
    apiKey: z.string().trim().min(10).max(512).optional(),
    clearApiKey: z.boolean().default(false)
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.apiKey && value.clearApiKey) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['clearApiKey'],
        message: 'Choose either a new API key or clear the current key.'
      });
    }
  });

const ModelProviderProbeSchema = z
  .object({
    provider: z.string().trim().optional(),
    modelName: z.string().trim().max(128).optional(),
    apiKey: z.string().trim().max(512).optional()
  })
  .strict();

export interface ModelProviderRouteOptions {
  modelProviderSettingsRepo?: ModelProviderSettingsRepository;
  auditRepo?: AuditRepository;
  config?: EnvConfig;
}

export function registerModelProviderRoutes(app: FastifyInstance, options: ModelProviderRouteOptions): void {
  const nodeEnv = options.config?.NODE_ENV || 'development';

  /**
   * The provider and model a mutation is actually about.
   *
   * This route used to answer `openrouter` and OpenRouter's default model in its audit record and
   * its clear response no matter which provider was saved, and it filled a blank model name with
   * OpenRouter's model for every provider — so choosing zRouter and leaving the field empty stored
   * `minimax/minimax-m3:free` under `zrouter`, and the audit trail recorded a decision nobody made.
   */
  const resolveTarget = (input: { provider?: string; modelName?: string }, fallbackProvider: string) => {
    const provider = input.provider || fallbackProvider;
    return { provider, modelName: input.modelName || defaultModelForProvider(provider) };
  };

  app.put('/api/v1/settings/model-provider', async (req, reply) => {
    if (!options.modelProviderSettingsRepo) {
      return reply.status(503).send({ error: 'Model provider settings storage is unavailable.' });
    }
    if (!options.auditRepo) {
      return reply.status(503).send({ error: 'Audit storage is unavailable for model provider mutation.' });
    }

    const parsed = ModelProviderMutationSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Invalid model provider settings.',
        details: parsed.error.flatten()
      });
    }

    // Fail closed on a provider this system cannot build. The column accepts any string, so an
    // unknown value used to persist cleanly and then fail every run with
    // `Unsupported model provider` — a setting that reports success and takes the system down.
    const requestedProvider = parsed.data.provider || 'openrouter';
    if (!isModelProviderId(requestedProvider)) {
      return reply.status(400).send({
        error: `Unsupported model provider '${requestedProvider}'.`,
        supportedProviders: MODEL_PROVIDER_IDS
      });
    }
    if (!isModelProviderAllowedInEnvironment(requestedProvider, nodeEnv)) {
      return reply.status(400).send({
        error: `Model provider '${requestedProvider}' is not allowed when NODE_ENV=${nodeEnv}.`
      });
    }

    const { provider: targetProvider, modelName: targetModel } = resolveTarget(parsed.data, requestedProvider);
    if (!targetModel) {
      return reply.status(400).send({
        error: `No default model is declared for provider '${targetProvider}'. Name the model explicitly.`
      });
    }

    try {
      const data = await options.modelProviderSettingsRepo.save({
        provider: targetProvider,
        modelName: targetModel,
        apiKey: parsed.data.apiKey,
        clearApiKey: parsed.data.clearApiKey,
        updatedBy: 'owner-api'
      });
      await options.auditRepo.create(
        AuditService.format({
          actor: 'owner-api',
          action: 'model_provider.updated',
          target: targetProvider,
          ipAddress: req.ip,
          details: {
            provider: targetProvider,
            model: targetModel,
            apiKeyChanged: Boolean(parsed.data.apiKey),
            apiKeyCleared: parsed.data.clearApiKey
          }
        })
      );
      return reply.status(200).send({ data, durable: true });
    } catch {
      return reply.status(503).send({ error: 'Model provider settings could not be persisted.' });
    }
  });

  app.delete('/api/v1/settings/model-provider', async (req, reply) => {
    if (!options.modelProviderSettingsRepo) {
      return reply.status(503).send({ error: 'Model provider settings storage is unavailable.' });
    }
    if (!options.auditRepo) {
      return reply.status(503).send({ error: 'Audit storage is unavailable for model provider mutation.' });
    }

    try {
      const cleared = await options.modelProviderSettingsRepo.clear('owner-api');
      // Read the row back after the write. Clearing removes the credential only — the provider and
      // model the operator chose stay in place — so answering with OpenRouter's model described a
      // state this row was not in and recorded a decision nobody made.
      const persisted = await options.modelProviderSettingsRepo.getPublic();
      await options.auditRepo.create(
        AuditService.format({
          actor: 'owner-api',
          action: 'model_provider.cleared',
          target: persisted?.provider || 'unknown',
          ipAddress: req.ip,
          details: {
            provider: persisted?.provider || null,
            model: persisted?.modelName || null,
            credentialCleared: cleared
          }
        })
      );
      return reply.status(200).send({ data: persisted, durable: true, credentialCleared: cleared });
    } catch {
      return reply.status(503).send({ error: 'Model provider credential could not be cleared.' });
    }
  });

  /**
   * Ask the configured provider to answer, and report what actually happened.
   *
   * "Saved" and "working" are different facts, and the dashboard could only ever show the first: the
   * credential was written, the card read KEY CONFIGURED, and whether the endpoint accepts it was
   * discoverable only by watching an agent run fail. The probe uses the credential the runtime would
   * use — the one in the request, else the persisted one, else the environment — so a green result is
   * evidence about the next run, and a red one names the reason instead of leaving the operator to
   * guess why nothing happened.
   */
  app.post('/api/v1/settings/model-provider/test', async (req, reply) => {
    const parsed = ModelProviderProbeSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid model provider probe.', details: parsed.error.flatten() });
    }

    let persisted: PersistedModelProviderConfig | undefined;
    if (options.modelProviderSettingsRepo) {
      try {
        persisted = await options.modelProviderSettingsRepo.getRuntimeConfig();
      } catch (err) {
        // A stored credential that cannot be decrypted is the answer, not an obstacle to it.
        const message = err instanceof Error ? err.message : String(err);
        return reply.status(503).send({ error: 'Stored model provider credential could not be read.', details: message });
      }
    }

    const provider = parsed.data.provider || persisted?.providerType || options.config?.MODEL_PROVIDER || 'openrouter';
    if (!isModelProviderId(provider)) {
      return reply.status(400).send({
        error: `Unsupported model provider '${provider}'.`,
        supportedProviders: MODEL_PROVIDER_IDS
      });
    }
    if (!isModelProviderAllowedInEnvironment(provider, nodeEnv)) {
      return reply.status(400).send({ error: `Model provider '${provider}' is not allowed when NODE_ENV=${nodeEnv}.` });
    }

    const modelName = parsed.data.modelName || persisted?.model || options.config?.MODEL_NAME || defaultModelForProvider(provider);
    if (!modelName) {
      return reply.status(400).send({
        error: `No default model is declared for provider '${provider}'. Name the model explicitly.`
      });
    }

    // An empty persisted key is a decision ("cleared"), not a gap to fill from the environment: the
    // repository answers with '' for exactly that case, and the runtime honours it the same way. The
    // probe must not report a working provider the next run would not have.
    const persistedKey = persisted ? persisted.apiKey || '' : undefined;
    const apiKey = parsed.data.apiKey ?? persistedKey ?? options.config?.MODEL_API_KEY;
    const credentialSource = parsed.data.apiKey
      ? 'request'
      : persisted
        ? persistedKey
          ? 'database'
          : 'none'
        : options.config?.MODEL_API_KEY
          ? 'environment'
          : 'none';

    const startedAt = Date.now();
    try {
      const providerInstance = createModelProvider({
        providerType: provider,
        apiKey,
        baseUrl: options.config?.MODEL_BASE_URL,
        model: modelName
      });
      const result = await providerInstance.run({
        runId: 'settings-probe',
        agentId: 'operator',
        messages: [{ role: 'user', content: 'Reply with the single word: pong' }],
        maxTokens: 16,
        signal: AbortSignal.timeout(30_000)
      });

      return reply.status(200).send({
        data: {
          ok: true,
          provider,
          model: modelName,
          credentialSource,
          latencyMs: Date.now() - startedAt,
          reply: result.content.trim().slice(0, 200),
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          costUsd: result.costUsd,
          costUsdKnown: result.costUsdKnown,
          error: null
        }
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // The adapter redacts the credential it was handed; this is the same guard for a key that
      // arrived in this request and could be echoed back by an endpoint that reflects its input.
      const safeMessage = apiKey ? message.split(apiKey).join('[REDACTED]') : message;
      return reply.status(200).send({
        data: {
          ok: false,
          provider,
          model: modelName,
          credentialSource,
          latencyMs: Date.now() - startedAt,
          reply: null,
          error: safeMessage.slice(0, 500)
        }
      });
    }
  });
}
