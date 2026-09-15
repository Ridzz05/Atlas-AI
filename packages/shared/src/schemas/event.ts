import { z } from 'zod';

export const EventTypeSchema = z.enum([
  'task.created',
  'task.updated',
  'task.completed',
  'task.failed',
  'task.cancelled',
  'run.started',
  'run.turn_completed',
  'run.completed',
  'run.failed',
  'run.cancelled',
  'tool.called',
  'tool.completed',
  'tool.failed',
  'approval.requested',
  'approval.decided',
  'memory.created',
  'artifact.created',
  'message.created',
  'system.emergency_stop'
]);
export type EventType = z.infer<typeof EventTypeSchema>;

export const SystemEventSchema = z.object({
  id: z.string().uuid(),
  type: EventTypeSchema,
  taskId: z.string().uuid().optional(),
  runId: z.string().uuid().optional(),
  agentId: z.string().optional(),
  payload: z.record(z.unknown()),
  timestamp: z.date().or(z.string())
});
export type SystemEvent = z.infer<typeof SystemEventSchema>;
