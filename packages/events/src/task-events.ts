import { EventType, SystemEvent, TaskStatus } from '@atlas/shared';

export type TaskLifecycleEventType = Extract<
  EventType,
  'task.created' | 'task.updated' | 'task.completed' | 'task.failed' | 'task.cancelled'
>;

export interface TaskLifecycleEventInput {
  taskId: string;
  status: TaskStatus;
  runId?: string;
  agentId?: string;
  type?: TaskLifecycleEventType;
  payload?: Record<string, unknown>;
}

export function createTaskLifecycleEvent(input: TaskLifecycleEventInput): SystemEvent {
  const type =
    input.type ||
    (input.status === 'completed'
      ? 'task.completed'
      : input.status === 'failed'
        ? 'task.failed'
        : input.status === 'cancelled'
          ? 'task.cancelled'
          : 'task.updated');

  return {
    id: crypto.randomUUID(),
    type,
    taskId: input.taskId,
    ...(input.runId ? { runId: input.runId } : {}),
    ...(input.agentId ? { agentId: input.agentId } : {}),
    payload: { status: input.status, ...input.payload },
    timestamp: new Date().toISOString()
  };
}
