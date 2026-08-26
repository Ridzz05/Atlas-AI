import { FastifyInstance } from 'fastify';
import { ApprovalRepository, TaskRepository } from '@atlas/database';
import { ApprovalStatusSchema } from '@atlas/shared';
import { AgentDefinition } from '@atlas/shared';
import { TaskQueue } from '@atlas/orchestration';
import { z } from 'zod';
import { rootLogger } from '@atlas/observability';

const ApprovalDecisionSchema = z.object({
  status: z.enum(['approved', 'rejected', 'revision_requested']),
  decisionNote: z.string().max(2000).optional()
});
const ApprovalIdSchema = z.string().uuid();

export interface ApprovalRouteOptions {
  approvalRepo: ApprovalRepository;
  taskRepo?: TaskRepository;
  taskQueue?: TaskQueue;
  getAgentDefinition?: (id: string) => AgentDefinition;
}

export function registerApprovalRoutes(app: FastifyInstance, options: ApprovalRouteOptions): void {
  app.get('/api/v1/approvals', async (req, reply) => {
    const query = req.query as { status?: string; limit?: string };
    const status = query.status ? ApprovalStatusSchema.safeParse(query.status) : null;
    if (query.status && !status?.success) {
      return reply.status(400).send({ error: 'Invalid approval status.' });
    }

    const limit = query.limit ? Number(query.limit) : 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      return reply.status(400).send({ error: 'Approval limit must be an integer from 1 to 100.' });
    }

    try {
      const data = await options.approvalRepo.list(status?.success ? status.data : 'pending', limit);
      return reply.status(200).send({ data, count: data.length });
    } catch (error) {
      rootLogger.error('Failed to list approvals', { error: String(error) });
      return reply.status(500).send({ error: 'Failed to list approvals.' });
    }
  });

  app.post('/api/v1/approvals/:id/decision', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!ApprovalIdSchema.safeParse(id).success) {
      return reply.status(400).send({ error: 'Approval id must be a UUID.' });
    }
    const parsed = ApprovalDecisionSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid approval decision.', details: parsed.error.errors });
    }

    const actor = req.headers['x-actor-id'] || 'api-owner';
    const decidedBy = Array.isArray(actor) ? actor[0] : actor;
    let approval = await options.approvalRepo.decide(
      id,
      parsed.data.status,
      decidedBy || 'api-owner',
      parsed.data.decisionNote
    );

    // Approved records are intentionally retryable: if queue delivery fails after
    // the decision was stored, the same request can safely re-issue the token.
    if (!approval && parsed.data.status === 'approved') {
      const existing = await options.approvalRepo.findById(id);
      if (existing?.status === 'approved') approval = existing;
    }

    if (!approval) {
      return reply.status(409).send({
        error: 'Approval was not changed. It may not exist, may be expired, or may already be decided.'
      });
    }

    let resumeQueued = false;
    const canIssueExecutionToken = typeof (options.approvalRepo as any).issueExecutionToken === 'function';
    if (parsed.data.status === 'approved' && canIssueExecutionToken && options.taskRepo && options.taskQueue && options.getAgentDefinition) {
      try {
        const token = await options.approvalRepo.issueExecutionToken(approval.id);
        const approvedTask = await options.taskRepo.findById(approval.taskId);
        if (!token || !approvedTask || approvedTask.status !== 'approval_pending') {
          return reply.status(503).send({
            error: 'Approval was recorded, but its execution could not be resumed safely. Retry the approval request after the worker and task store are ready.'
          });
        }

        const queueTask = approvedTask.parentId
          ? await options.taskRepo.findById(approvedTask.parentId)
          : approvedTask;
        if (!queueTask) {
          return reply.status(503).send({
            error: 'Approval was recorded, but its parent task could not be found for safe resume.'
          });
        }

        await options.taskQueue.enqueue({
          task: queueTask,
          agent: options.getAgentDefinition(queueTask.assignedAgent),
          prompt: queueTask.goal,
          runId: approvedTask.parentId ? undefined : approval.runId,
          approvalResume: {
            taskId: approval.taskId,
            runId: approval.runId,
            token
          }
        });
        resumeQueued = true;
      } catch (error) {
        rootLogger.error('Approval recorded but resume enqueue failed', { error: String(error), approvalId: approval.id });
        return reply.status(503).send({
          error: 'Approval was recorded, but its execution could not be resumed safely. Retry the approval request.'
        });
      }
    }

    return reply.status(200).send({
      approval,
      message: resumeQueued
        ? 'Approval recorded and the paused task was queued for one-time execution.'
        : 'Approval decision recorded. No outbound side effect was executed by this decision endpoint.'
    });
  });
}
