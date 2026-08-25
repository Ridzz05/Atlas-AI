import { z } from 'zod';

export const EnvConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  APP_BASE_URL: z.string().url().default('http://localhost:3000'),
  API_AUTH_TOKEN: z.string().min(32).optional(),
  CORS_ALLOWED_ORIGINS: z.string().default('http://localhost:3000'),
  DATABASE_URL: z.string().min(1).default('postgresql://atlas:atlas@localhost:5432/atlas'),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_ALLOWED_USER_IDS: z.string().optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
  MODEL_PROVIDER: z.string().default('mock'),
  MODEL_API_KEY: z.string().optional(),
  ENCRYPTION_KEY: z.string().min(32).default('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'),
  ARTIFACT_STORAGE_PATH: z.string().default('./data/artifacts'),
  GLOBAL_DAILY_BUDGET_USD: z.coerce.number().positive().default(5.0),
  MAX_CONCURRENT_AGENT_RUNS: z.coerce.number().int().positive().default(3),
  MAX_DELEGATION_DEPTH: z.coerce.number().int().positive().default(2),
  EXTERNAL_WRITES_ENABLED: z.coerce.boolean().default(false)
}).superRefine((config, ctx) => {
  if (config.NODE_ENV === 'production' && !config.API_AUTH_TOKEN) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['API_AUTH_TOKEN'],
      message: 'API_AUTH_TOKEN is required in production.'
    });
  }
});
export type EnvConfig = z.infer<typeof EnvConfigSchema>;
