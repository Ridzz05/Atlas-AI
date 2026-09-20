import { z } from 'zod';

export const TaskStatusSchema = z.enum([
  'queued',
  'planning',
  'running',
  'review_pending',
  'approval_pending',
  'completed',
  'failed',
  'cancelled'
]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const TaskPrioritySchema = z.enum(['low', 'normal', 'high', 'urgent']);
export type TaskPriority = z.infer<typeof TaskPrioritySchema>;

export const PlanStepSchema = z.object({
  id: z.string(),
  agent: z.string(),
  objective: z.string(),
  depends_on: z.array(z.string()).default([]),
  parallelizable: z.boolean().default(false),
  expected_artifact: z.string().optional()
});
export type PlanStep = z.infer<typeof PlanStepSchema>;

export const TaskPlanSchema = z.object({
  goal: z.string(),
  assumptions: z.array(z.string()).default([]),
  questions: z.array(z.string()).default([]),
  steps: z.array(PlanStepSchema),
  approval_points: z.array(z.string()).default([]),
  estimated_cost_usd: z.number().nonnegative().default(0)
});
export type TaskPlan = z.infer<typeof TaskPlanSchema>;

export const TaskSchema = z.object({
  id: z.string().uuid(),
  parentId: z.string().uuid().nullable().default(null),
  title: z.string().min(1),
  goal: z.string().min(1),
  assignedAgent: z.string(),
  depth: z.number().int().min(0).max(2).default(0),
  status: TaskStatusSchema.default('queued'),
  priority: TaskPrioritySchema.default('normal'),
  context: z.record(z.unknown()).default({}),
  plan: TaskPlanSchema.nullable().default(null),
  result: z.record(z.unknown()).nullable().default(null),
  error: z.string().nullable().default(null),
  createdAt: z.date().or(z.string()),
  updatedAt: z.date().or(z.string()),
  completedAt: z.date().or(z.string()).nullable().default(null)
});
export type Task = z.infer<typeof TaskSchema>;

export const CreateTaskInputSchema = z.object({
  title: z.string().min(1),
  goal: z.string().min(1),
  assignedAgent: z.string().default('chief'),
  parentId: z.string().uuid().optional(),
  depth: z.number().int().min(0).max(2).optional(),
  priority: TaskPrioritySchema.default('normal'),
  context: z.record(z.unknown()).default({})
});
export type CreateTaskInput = z.infer<typeof CreateTaskInputSchema>;
