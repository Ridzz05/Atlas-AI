import { z } from 'zod';

const DEFAULT_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const ModelProviderSchema = z.enum(['mock', 'openai', 'openai-compatible', 'openrouter', 'groq', 'ollama', 'deepseek', 'zrouter']);
const ResearchProviderSchema = z.enum(['none', 'brave', 'chromium']);
const EmptyStringAsUndefined = z.preprocess(value => (typeof value === 'string' && value.trim() === '' ? undefined : value), z.unknown());
const StrictBooleanFromEnvSchema = z.preprocess(value => {
  if (typeof value !== 'string') return value;

  const normalized = value.trim().toLowerCase();
  if (normalized === '') return false;
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return value;
}, z.boolean());

export const EnvConfigSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().default(4000),
    WORKER_HEALTH_PORT: z.coerce.number().int().positive().default(8081),
    TELEGRAM_HEALTH_PORT: z.coerce.number().int().positive().default(8082),
    APP_BASE_URL: z.string().url().default('http://localhost:3000'),
    API_AUTH_TOKEN: EmptyStringAsUndefined.pipe(z.string().min(32).optional()),
    API_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
    API_RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(120),
    CORS_ALLOWED_ORIGINS: z.string().default('http://localhost:3000'),
    DATABASE_URL: z.string().min(1).default('postgresql://atlas:atlas@localhost:5432/atlas'),
    REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
    TELEGRAM_BOT_TOKEN: z.string().optional(),
    TELEGRAM_ALLOWED_USER_IDS: z.string().optional(),
    TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
    MODEL_PROVIDER: ModelProviderSchema.default('openrouter'),
    MODEL_API_KEY: z.string().optional(),
    MODEL_BASE_URL: z.preprocess(value => (value === '' ? undefined : value), z.string().url().optional()),
    MODEL_NAME: z.preprocess(value => (value === '' ? undefined : value), z.string().trim().min(1).max(128).optional()),
    RESEARCH_PROVIDER: ResearchProviderSchema.default('none'),
    RESEARCH_API_KEY: z.preprocess(value => (value === '' ? undefined : value), z.string().trim().min(1).max(512).optional()),
    RESEARCH_COUNTRY: z.preprocess(
      value => (typeof value === 'string' && value.trim() ? value.trim().toUpperCase() : value),
      z
        .string()
        .regex(/^[A-Z]{2}$/)
        .default('ID')
    ),
    RESEARCH_SEARCH_LANG: z.preprocess(
      value => (typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : value),
      z
        .string()
        .regex(/^[a-z]{2,12}(?:-[a-z]{2,8})?$/)
        .default('id')
    ),
    ENCRYPTION_KEY: EmptyStringAsUndefined.pipe(z.string().min(32).default(DEFAULT_ENCRYPTION_KEY)),
    ARTIFACT_STORAGE_PATH: z.string().default('./data/artifacts'),
    MEMORY_MAINTENANCE_INTERVAL_SECONDS: z.coerce.number().int().positive().default(3600),
    QUEUE_RECOVERY_INTERVAL_SECONDS: z.coerce.number().int().positive().default(30),
    SCHEDULED_JOB_SYNC_INTERVAL_SECONDS: z.coerce.number().int().positive().default(30),
    SCHEDULED_JOB_TICK_INTERVAL_SECONDS: z.coerce.number().int().positive().default(60),
    WORKFLOW_RESUME_INTERVAL_SECONDS: z.coerce.number().int().positive().default(30),
    AUTOMATION_ENABLED: StrictBooleanFromEnvSchema.default(true),
    WORKFLOW_AUTOMATION_ENABLED: StrictBooleanFromEnvSchema.default(true),
    MEMORY_DELETION_GRACE_DAYS: z.coerce.number().int().nonnegative().default(7),
    GLOBAL_DAILY_BUDGET_USD: z.coerce.number().positive().default(5.0),
    MAX_CONCURRENT_AGENT_RUNS: z.coerce.number().int().positive().default(3),
    MAX_DELEGATION_DEPTH: z.coerce.number().int().positive().default(2),
    EXTERNAL_WRITES_ENABLED: StrictBooleanFromEnvSchema.default(false)
  })
  .superRefine((config, ctx) => {
    if (config.NODE_ENV === 'production' && !config.API_AUTH_TOKEN) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['API_AUTH_TOKEN'],
        message: 'API_AUTH_TOKEN is required in production.'
      });
    }
    if (config.NODE_ENV === 'production' && config.ENCRYPTION_KEY === DEFAULT_ENCRYPTION_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ENCRYPTION_KEY'],
        message: 'ENCRYPTION_KEY must be explicitly configured in production.'
      });
    }
    if (config.NODE_ENV === 'production' && config.MODEL_PROVIDER.toLowerCase() === 'mock') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['MODEL_PROVIDER'],
        message: 'MODEL_PROVIDER=mock is not allowed in production.'
      });
    }
    if (config.NODE_ENV === 'production' && config.MODEL_PROVIDER !== 'openai' && !config.MODEL_NAME) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['MODEL_NAME'],
        message: 'MODEL_NAME is required for non-OpenAI providers in production.'
      });
    }
    if (config.NODE_ENV === 'production' && config.MODEL_PROVIDER === 'ollama' && !config.MODEL_BASE_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['MODEL_BASE_URL'],
        message: 'MODEL_BASE_URL is required for Ollama in production.'
      });
    }
    if (
      config.NODE_ENV === 'production' &&
      config.MODEL_PROVIDER !== 'ollama' &&
      config.MODEL_PROVIDER !== 'openrouter' &&
      !config.MODEL_API_KEY
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['MODEL_API_KEY'],
        message: 'MODEL_API_KEY is required for this provider in production.'
      });
    }
    if (config.RESEARCH_PROVIDER === 'brave' && !config.RESEARCH_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['RESEARCH_API_KEY'],
        message: 'RESEARCH_API_KEY is required when RESEARCH_PROVIDER=brave.'
      });
    }
  });
export type EnvConfig = z.infer<typeof EnvConfigSchema>;
