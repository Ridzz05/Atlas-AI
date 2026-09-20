import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ScheduledJobTypeSchema } from '@atlas/shared';
import { ScheduledJobRepository, TaskRepository, WorkflowCheckpointRepository } from '@atlas/database';
import { TaskQueue } from '@atlas/orchestration';
import { AgentRegistry } from '@atlas/agents';
import { AutomationEngine } from '@atlas/orchestration';
import { rootLogger } from '@atlas/observability';
import { TelegramStateRepository } from '@atlas/database';
import { createIntakeGate } from './intake-gate.js';

const TriggerSchema = z.object({
  type: z.enum(['cron', 'event', 'webhook', 'manual']).default('manual'),
  jobType: ScheduledJobTypeSchema,
  payload: z.record(z.unknown()).optional(),
  assignedAgent: z.string().optional()
});

const CreateScheduledJobSchema = z.object({
  name: z.string().min(1).max(128),
  jobType: ScheduledJobTypeSchema,
  cronPattern: z.string().min(1).max(64),
  timezone: z.string().min(1).max(64).default('UTC'),
  payload: z.record(z.unknown()).default({}),
  assignedAgent: z.string().min(1).max(64).default('chief'),
  enabled: z.boolean().default(true)
});

export interface AutomationRouteOptions {
  taskRepo?: TaskRepository;
  taskQueue?: TaskQueue;
  registry?: AgentRegistry;
  scheduledJobRepo?: ScheduledJobRepository;
  workflowCheckpointRepo?: WorkflowCheckpointRepository;
  controlStateRepo?: TelegramStateRepository;
}

export function registerAutomationRoutes(app: FastifyInstance, options: AutomationRouteOptions): void {
  const intakeGate = createIntakeGate(options);

  // POST /api/v1/automations/trigger — full AI Automation entry point (follows task workflow: TaskRepo -> Queue -> Delegator)
  app.post('/api/v1/automations/trigger', { preHandler: intakeGate }, async (req, reply) => {
    if (!options.taskRepo || !options.taskQueue || !options.registry) {
      return reply.status(503).send({ error: 'Automation engine not available (missing taskRepo/queue/registry)' });
    }
    const parsed = TriggerSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid automation trigger', details: parsed.error.errors });
    }
    const { type, jobType, payload } = parsed.data;
    const engine = new AutomationEngine({
      taskRepo: options.taskRepo,
      taskQueue: options.taskQueue,
      registry: options.registry
    });
    const result = await engine.execute({
      id: `api_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      type,
      jobType,
      payload: payload ?? {}
    });
    if (result.status === 'failed') {
      return reply.status(500).send({ error: result.reason || 'Automation failed' });
    }
    return reply.status(201).send({ data: result });
  });

  // Scheduled jobs CRUD — thin wrapper over ScheduledJobRepository (same contract as dashboard)
  app.get('/api/v1/automations/scheduled-jobs', async (_req, reply) => {
    if (!options.scheduledJobRepo) return reply.status(503).send({ error: 'Scheduled jobs unavailable' });
    try {
      const jobs = await options.scheduledJobRepo.list();
      return reply.status(200).send({ data: jobs, count: jobs.length });
    } catch (err) {
      rootLogger.error('Failed to list scheduled jobs', { error: String(err) });
      return reply.status(500).send({ error: 'Failed to list scheduled jobs' });
    }
  });

  // Creating a scheduled job is intake: the worker's scheduler fires it on the next tick without
  // consulting the control state, so an operator who pressed emergency stop would still accumulate new
  // automation work. The two sibling POST routes in this file carry the gate; this one was the only
  // POST route in the API that created future work and did not.
  app.post('/api/v1/automations/scheduled-jobs', { preHandler: intakeGate }, async (req, reply) => {
    if (!options.scheduledJobRepo) return reply.status(503).send({ error: 'Scheduled jobs unavailable' });
    const parsed = CreateScheduledJobSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid scheduled job input', details: parsed.error.errors });
    try {
      const job = await options.scheduledJobRepo.create({
        ...parsed.data,
        createdBy: 'api-owner'
      });
      return reply.status(201).send(job);
    } catch (err) {
      rootLogger.error('Failed to create scheduled job', { error: String(err) });
      return reply.status(500).send({ error: 'Failed to create scheduled job' });
    }
  });

  app.post('/api/v1/automations/scheduled-jobs/:id/run', { preHandler: intakeGate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!options.scheduledJobRepo || !options.taskRepo || !options.registry) {
      return reply.status(503).send({ error: 'Automation dependencies unavailable' });
    }
    const job = await options.scheduledJobRepo.findById(id);
    if (!job) return reply.status(404).send({ error: `Scheduled job not found: ${id}` });
    if (!job.enabled) return reply.status(400).send({ error: 'Scheduled job is disabled' });
    const agent = options.registry.get(job.assignedAgent);
    if (!agent) return reply.status(400).send({ error: `Assigned agent not found: ${job.assignedAgent}` });
    try {
      const task = await options.taskRepo.create({
        title: `[scheduled:manual] ${job.name}`,
        goal: `Manual run of scheduled job ${job.id} (${job.jobType})`,
        assignedAgent: job.assignedAgent,
        priority: 'normal',
        context: { source: 'scheduled_job_manual', scheduledJobId: job.id, scheduledJobType: job.jobType, scheduledJobPayload: job.payload }
      });
      await options.taskQueue!.enqueue({ task, agent, prompt: task.goal });
      return reply.status(201).send({ data: { taskId: task.id, jobId: job.id } });
    } catch (err) {
      return reply.status(500).send({ error: String(err) });
    }
  });

  // Workflow checkpoints observability — read-only for automation visibility
  app.get('/api/v1/automations/workflows/checkpoints', async (req, reply) => {
    if (!options.workflowCheckpointRepo) return reply.status(503).send({ error: 'Workflow checkpoints unavailable' });
    const query = req.query as { runId?: string };
    if (!query.runId) return reply.status(400).send({ error: 'runId query required' });
    try {
      const checkpoints = await options.workflowCheckpointRepo.listByRun(query.runId);
      return reply.status(200).send({ data: checkpoints });
    } catch (err) {
      return reply.status(500).send({ error: String(err) });
    }
  });

  // Health for automation subsystems
  app.get('/api/v1/automations/health', async (_req, reply) => {
    return reply.status(200).send({
      status: 'ok',
      subsystems: {
        taskAutomation: Boolean(options.taskRepo && options.taskQueue && options.registry),
        scheduledJobs: Boolean(options.scheduledJobRepo),
        workflowCheckpoints: Boolean(options.workflowCheckpointRepo)
      },
      timestamp: new Date().toISOString()
    });
  });
}
