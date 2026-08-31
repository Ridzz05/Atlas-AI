import { z } from 'zod';

export const ScheduledJobTypeSchema = z.enum(['daily_briefing']);
export type ScheduledJobType = z.infer<typeof ScheduledJobTypeSchema>;

export const ScheduledJobSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(128),
  jobType: ScheduledJobTypeSchema,
  cronPattern: z.string().min(1).max(64),
  timezone: z.string().min(1).max(64).default('UTC'),
  payload: z.record(z.unknown()).default({}),
  assignedAgent: z.string().min(1).max(64).default('chief'),
  enabled: z.boolean().default(true),
  lastRunAt: z.string().nullable().default(null),
  nextRunAt: z.string().nullable().default(null),
  lastError: z.string().nullable().default(null),
  createdBy: z.string().min(1).max(128),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type ScheduledJob = z.infer<typeof ScheduledJobSchema>;

export const CreateScheduledJobInputSchema = z.object({
  id: z.string().min(1).max(64).optional(),
  name: z.string().min(1).max(128),
  jobType: ScheduledJobTypeSchema,
  cronPattern: z.string().min(1).max(64),
  timezone: z.string().min(1).max(64).default('UTC'),
  payload: z.record(z.unknown()).default({}),
  assignedAgent: z.string().min(1).max(64).default('chief'),
  enabled: z.boolean().default(true),
  createdBy: z.string().min(1).max(128)
});
export type CreateScheduledJobInput = z.infer<typeof CreateScheduledJobInputSchema>;

export const UpdateScheduledJobInputSchema = z.object({
  name: z.string().min(1).max(128).optional(),
  cronPattern: z.string().min(1).max(64).optional(),
  timezone: z.string().min(1).max(64).optional(),
  payload: z.record(z.unknown()).optional(),
  assignedAgent: z.string().min(1).max(64).optional(),
  enabled: z.boolean().optional()
});
export type UpdateScheduledJobInput = z.infer<typeof UpdateScheduledJobInputSchema>;

export const BRIEFING_DEFAULT_CRON = '0 7 * * *';
export const BRIEFING_DEFAULT_TZ = 'Asia/Jakarta';
