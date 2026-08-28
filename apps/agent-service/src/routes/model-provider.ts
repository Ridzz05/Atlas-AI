import { FastifyInstance } from 'fastify';
import { AuditRepository, ModelProviderSettingsRepository } from '@atlas/database';
import { AuditService } from '@atlas/observability';
import { OPENROUTER_DEFAULT_MODEL } from '@atlas/shared';
import { z } from 'zod';

const OpenRouterSettingsMutationSchema = z
  .object({
    apiKey: z.string().trim().min(20).max(512).optional(),
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

export interface ModelProviderRouteOptions {
  modelProviderSettingsRepo?: ModelProviderSettingsRepository;
  auditRepo?: AuditRepository;
}

export function registerModelProviderRoutes(app: FastifyInstance, options: ModelProviderRouteOptions): void {
  app.put('/api/v1/settings/model-provider', async (req, reply) => {
    if (!options.modelProviderSettingsRepo) {
      return reply.status(503).send({ error: 'Model provider settings storage is unavailable.' });
    }
    if (!options.auditRepo) {
      return reply.status(503).send({ error: 'Audit storage is unavailable for model provider mutation.' });
    }

    const parsed = OpenRouterSettingsMutationSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Invalid OpenRouter settings.',
        details: parsed.error.flatten()
      });
    }

    try {
      const data = await options.modelProviderSettingsRepo.save({
        provider: 'openrouter',
        modelName: OPENROUTER_DEFAULT_MODEL,
        apiKey: parsed.data.apiKey,
        clearApiKey: parsed.data.clearApiKey,
        updatedBy: 'owner-api'
      });
      await options.auditRepo.create(
        AuditService.format({
          actor: 'owner-api',
          action: 'model_provider.updated',
          target: 'openrouter',
          ipAddress: req.ip,
          details: {
            provider: 'openrouter',
            model: OPENROUTER_DEFAULT_MODEL,
            apiKeyChanged: Boolean(parsed.data.apiKey),
            apiKeyCleared: parsed.data.clearApiKey
          }
        })
      );
      return reply.status(200).send({ data, durable: true });
    } catch {
      return reply.status(503).send({ error: 'OpenRouter settings could not be persisted.' });
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
      await options.modelProviderSettingsRepo.clear('owner-api');
      await options.auditRepo.create(
        AuditService.format({
          actor: 'owner-api',
          action: 'model_provider.cleared',
          target: 'openrouter',
          ipAddress: req.ip,
          details: { provider: 'openrouter', model: OPENROUTER_DEFAULT_MODEL }
        })
      );
      return reply.status(200).send({
        data: {
          provider: 'openrouter',
          modelName: OPENROUTER_DEFAULT_MODEL,
          hasApiKey: false,
          apiKeyFingerprint: null,
          updatedBy: 'owner-api'
        },
        durable: true
      });
    } catch {
      return reply.status(503).send({ error: 'OpenRouter API key could not be cleared.' });
    }
  });
}
