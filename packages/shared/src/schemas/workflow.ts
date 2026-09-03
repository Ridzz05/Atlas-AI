import { z } from 'zod';

export const WorkflowStateSchema = z.enum([
  'running',
  'waiting_agent',
  'waiting_tool',
  'waiting_approval',
  'waiting_external_event',
  'scheduled',
  'retrying',
  'paused',
  'failed',
  'completed',
  'cancelled'
]);
export type WorkflowState = z.infer<typeof WorkflowStateSchema>;

export const WorkflowTransitionSchema = z.object({
  from: WorkflowStateSchema,
  to: WorkflowStateSchema,
  at: z.date().or(z.string()),
  reason: z.string().optional(),
  payload: z.record(z.unknown()).default({})
});
export type WorkflowTransition = z.infer<typeof WorkflowTransitionSchema>;

export const WorkflowCheckpointSchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  taskId: z.string().uuid(),
  agentId: z.string(),
  stepId: z.string(),
  state: WorkflowStateSchema,
  resumeAfter: z.date().or(z.string()).nullable().default(null),
  payload: z.record(z.unknown()).default({}),
  history: z.array(WorkflowTransitionSchema).default([]),
  createdAt: z.date().or(z.string()),
  updatedAt: z.date().or(z.string())
});
export type WorkflowCheckpoint = z.infer<typeof WorkflowCheckpointSchema>;

export const ALLOWED_WORKFLOW_TRANSITIONS: Record<WorkflowState, WorkflowState[]> = {
  running: ['waiting_agent', 'waiting_tool', 'waiting_approval', 'waiting_external_event', 'scheduled', 'paused', 'failed', 'completed', 'cancelled', 'retrying'],
  waiting_agent: ['running', 'paused', 'failed', 'cancelled'],
  waiting_tool: ['running', 'paused', 'failed', 'cancelled'],
  waiting_approval: ['running', 'cancelled'],
  waiting_external_event: ['running', 'paused', 'failed', 'cancelled'],
  scheduled: ['running', 'cancelled'],
  retrying: ['running', 'failed', 'cancelled'],
  paused: ['running', 'cancelled'],
  failed: [],
  completed: [],
  cancelled: []
};

export function canTransition(from: WorkflowState, to: WorkflowState): boolean {
  return ALLOWED_WORKFLOW_TRANSITIONS[from]?.includes(to) ?? false;
}