import { z } from 'zod';

const DEFAULT_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const ModelProviderSchema = z.enum(['mock', 'openai', 'openai-compatible', 'openrouter', 'groq', 'ollama', 'deepseek', 'zrouter']);
const ResearchProviderSchema = z.enum(['none', 'brave', 'chromium']);

/**
 * A blank environment value means "unset", everywhere, so the declared default applies.
 *
 * This used to be answered three different ways in one schema — `EmptyStringAsUndefined` on two keys,
 * `value === ''` on three, `value.trim()` on two — and not at all on the rest, where `''` and `'   '`
 * were ordinary values. Two consequences were real: `.default(true)` could never apply to a blank
 * boolean, so one blank line in `.env` silently disabled every scheduled job; and a whitespace-only
 * MODEL_API_KEY passed the production truthiness guard, so every service booted in production with a
 * key that cannot authenticate, with the failure surfacing per-run at provider time.
 *
 * `.env.example` ships several of these keys with a value and documents the rest as optional. An
 * operator who empties one is saying "use the default", not "set it to the empty string".
 */
const BlankAsUndefined = z.preprocess(value => (typeof value === 'string' && value.trim() === '' ? undefined : value), z.unknown());

/** A number from the environment: blank falls back to the declared default, and the shape is enforced. */
const numberFromEnv = (fallback: number, opts: { integer?: boolean; positive?: boolean } = {}) => {
  let schema = z.coerce.number();
  if (opts.integer) schema = schema.int();
  if (opts.positive) schema = schema.positive();
  return BlankAsUndefined.pipe(schema.default(fallback));
};

/**
 * A boolean from the environment. Blank falls back to the declared default; anything that is neither
 * blank nor true/false is left alone, so a typo fails validation instead of being silently defaulted.
 */
const booleanFromEnv = (fallback: boolean) =>
  BlankAsUndefined.pipe(
    z.preprocess(value => {
      if (typeof value !== 'string') return value;
      const normalized = value.trim().toLowerCase();
      if (normalized === 'true') return true;
      if (normalized === 'false') return false;
      return value;
    }, z.boolean().default(fallback))
  );

/** A non-empty string from the environment: blank falls back to the declared default. */
const stringFromEnv = (fallback: string) => BlankAsUndefined.pipe(z.string().min(1).default(fallback));

export const EnvConfigSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    // PORT was the only port without .int().positive(), and z.coerce.number() turns '' into 0 — a value
    // the API then papered over with `config.PORT || 4000`, so it listened somewhere other than the
    // value the schema reported.
    PORT: numberFromEnv(4000, { integer: true, positive: true }),
    WORKER_HEALTH_PORT: numberFromEnv(8081, { integer: true, positive: true }),
    TELEGRAM_HEALTH_PORT: numberFromEnv(8082, { integer: true, positive: true }),
    APP_BASE_URL: BlankAsUndefined.pipe(z.string().url().default('http://localhost:3000')),
    API_AUTH_TOKEN: BlankAsUndefined.pipe(z.string().min(32).optional()),
    API_RATE_LIMIT_WINDOW_SECONDS: numberFromEnv(60, { integer: true, positive: true }),
    API_RATE_LIMIT_MAX_REQUESTS: numberFromEnv(120, { integer: true, positive: true }),
    CORS_ALLOWED_ORIGINS: stringFromEnv('http://localhost:3000'),
    DATABASE_URL: stringFromEnv('postgresql://atlas:***@localhost:5432/atlas'),
    REDIS_URL: stringFromEnv('redis://localhost:6379'),
    TELEGRAM_BOT_TOKEN: BlankAsUndefined.pipe(z.string().optional()),
    TELEGRAM_ALLOWED_USER_IDS: BlankAsUndefined.pipe(z.string().optional()),
    TELEGRAM_WEBHOOK_SECRET: BlankAsUndefined.pipe(z.string().optional()),
    MODEL_PROVIDER: ModelProviderSchema.default('openrouter'),
    MODEL_API_KEY: BlankAsUndefined.pipe(z.string().optional()),
    MODEL_BASE_URL: BlankAsUndefined.pipe(z.string().url().optional()),
    MODEL_NAME: BlankAsUndefined.pipe(z.string().trim().min(1).max(128).optional()),
    RESEARCH_PROVIDER: ResearchProviderSchema.default('none'),
    RESEARCH_API_KEY: BlankAsUndefined.pipe(z.string().trim().min(1).max(512).optional()),
    RESEARCH_COUNTRY: BlankAsUndefined.pipe(
      z.preprocess(
        value => (typeof value === 'string' ? value.trim().toUpperCase() : value),
        z
          .string()
          .regex(/^[A-Z]{2}$/)
          .default('ID')
      )
    ),
    RESEARCH_SEARCH_LANG: BlankAsUndefined.pipe(
      z.preprocess(
        value => (typeof value === 'string' ? value.trim().toLowerCase() : value),
        z
          .string()
          .regex(/^[a-z]{2,12}(?:-[a-z]{2,8})?$/)
          .default('id')
      )
    ),
    ENCRYPTION_KEY: BlankAsUndefined.pipe(z.string().min(32).default(DEFAULT_ENCRYPTION_KEY)),
    ARTIFACT_STORAGE_PATH: stringFromEnv('./data/artifacts'),
    MEMORY_MAINTENANCE_INTERVAL_SECONDS: numberFromEnv(3600, { integer: true, positive: true }),
    QUEUE_RECOVERY_INTERVAL_SECONDS: numberFromEnv(30, { integer: true, positive: true }),
    SCHEDULED_JOB_SYNC_INTERVAL_SECONDS: numberFromEnv(30, { integer: true, positive: true }),
    SCHEDULED_JOB_TICK_INTERVAL_SECONDS: numberFromEnv(60, { integer: true, positive: true }),
    WORKFLOW_RESUME_INTERVAL_SECONDS: numberFromEnv(30, { integer: true, positive: true }),
    AUTOMATION_ENABLED: booleanFromEnv(true),
    WORKFLOW_AUTOMATION_ENABLED: booleanFromEnv(true),
    MEMORY_DELETION_GRACE_DAYS: numberFromEnv(7, { integer: true }),
    GLOBAL_DAILY_BUDGET_USD: numberFromEnv(5.0, { positive: true }),
    MAX_CONCURRENT_AGENT_RUNS: numberFromEnv(3, { integer: true, positive: true }),
    MAX_DELEGATION_DEPTH: numberFromEnv(2, { integer: true, positive: true }),
    EXTERNAL_WRITES_ENABLED: booleanFromEnv(false)
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
        message: 'MODEL_NAME is required for non-[OI] providers in production.'
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
