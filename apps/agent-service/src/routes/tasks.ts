import { FastifyInstance } from 'fastify';
import { CreateTaskInputSchema, TaskStatusSchema, AgentDefinition, SystemEvent, Task } from '@atlas/shared';
import { TaskRepository, TelegramStateRepository } from '@atlas/database';
import { TaskQueue } from '@atlas/orchestration';
import { EventBus } from '@atlas/events';
import { rootLogger } from '@atlas/observability';
import { z } from 'zod';

const TaskIdSchema = z.string().uuid();

function parseQueryInteger(value: unknown, label: string, fallback: number, minimum: number, maximum: number): number | { error: string } {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    return { error: `${label} must be an integer from ${minimum} to ${maximum}.` };
  }
  return parsed;
}

export interface TaskRouteOptions {
  taskRepo: TaskRepository;
  taskQueue: TaskQueue;
  eventBus: EventBus;
  getAgentDefinition: (id: string) => AgentDefinition;
  controlStateRepo?: TelegramStateRepository;
}

export function registerTaskRoutes(app: FastifyInstance, options: TaskRouteOptions): void {
  // Create Task
  app.post('/api/v1/tasks', async (req, reply) => {
    const parseResult = CreateTaskInputSchema.safeParse(req.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: 'Invalid task input',
        details: parseResult.error.errors
      });
    }

    const input = parseResult.data;

    let agent: AgentDefinition;
    try {
      agent = options.getAgentDefinition(input.assignedAgent);
    } catch {
      return reply.status(400).send({ error: `Unknown assigned agent: ${input.assignedAgent}` });
    }

    if (options.controlStateRepo) {
      try {
        const controlState = await options.controlStateRepo.getControlState();
        if (controlState.emergencyStop || controlState.paused) {
          return reply.status(423).send({
            error: controlState.emergencyStop ? 'Task intake is locked by emergency stop' : 'Task intake is paused',
            state: controlState.emergencyStop ? 'emergency_stop' : 'paused'
          });
        }
      } catch (err) {
        rootLogger.error('Failed to read execution control state', { error: String(err) });
        return reply.status(503).send({ error: 'Execution control state unavailable' });
      }
    }

    try {
      const task = await options.taskRepo.create(input);
      await publishTaskCreated(options.eventBus, task);

      // Enqueue job for background processing
      await options.taskQueue.enqueue({
        task,
        agent,
        prompt: task.goal
      });

      return reply.status(201).send(task);
    } catch (err) {
      rootLogger.error('Failed to create task', { error: String(err) });
      return reply.status(500).send({ error: 'Failed to create task' });
    }
  });

  // List Tasks
  app.get('/api/v1/tasks', async (req, reply) => {
    const query = req.query as {
      status?: unknown;
      assignedAgent?: unknown;
      limit?: unknown;
      offset?: unknown;
    };
    const statusResult = query.status === undefined ? null : TaskStatusSchema.safeParse(query.status);
    if (query.status !== undefined && !statusResult?.success) {
      return reply.status(400).send({ error: 'Invalid task status.' });
    }

    const assignedAgent = query.assignedAgent;
    if (
      assignedAgent !== undefined &&
      (typeof assignedAgent !== 'string' || assignedAgent.trim().length === 0 || assignedAgent.length > 64)
    ) {
      return reply.status(400).send({ error: 'assignedAgent must be a non-empty string up to 64 characters.' });
    }

    const limit = parseQueryInteger(query.limit, 'Task limit', 50, 1, 100);
    if (typeof limit !== 'number') return reply.status(400).send(limit);
    const offset = parseQueryInteger(query.offset, 'Task offset', 0, 0, 100000);
    if (typeof offset !== 'number') return reply.status(400).send(offset);

    try {
      const tasks = await options.taskRepo.list({
        status: statusResult?.success ? statusResult.data : undefined,
        assignedAgent: assignedAgent as string | undefined,
        limit,
        offset
      });
      return reply.status(200).send({ data: tasks, count: tasks.length });
    } catch (err) {
      rootLogger.error('Failed to list tasks', { error: String(err) });
      return reply.status(500).send({ error: 'Failed to list tasks' });
    }
  });

  // Get Task by ID
  app.get('/api/v1/tasks/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!TaskIdSchema.safeParse(id).success) {
      return reply.status(400).send({ error: 'Task id must be a UUID.' });
    }
    try {
      const task = await options.taskRepo.findById(id);
      if (!task) {
        return reply.status(404).send({ error: `Task not found: ${id}` });
      }
      return reply.status(200).send(task);
    } catch (err) {
      rootLogger.error(`Failed to find task ${id}`, { error: String(err) });
      return reply.status(500).send({ error: 'Failed to fetch task' });
    }
  });
}

async function publishTaskCreated(eventBus: EventBus, task: Task): Promise<void> {
  const event: SystemEvent = {
    id: crypto.randomUUID(),
    type: 'task.created',
    taskId: task.id,
    agentId: task.assignedAgent,
    payload: {
      status: task.status,
      title: task.title,
      assignedAgent: task.assignedAgent
    },
    timestamp: new Date().toISOString()
  };

  try {
    await eventBus.publish(event);
  } catch (error) {
    rootLogger.error('Failed to publish task.created event', { taskId: task.id, error: String(error) });
  }
}
