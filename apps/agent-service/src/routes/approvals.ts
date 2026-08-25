import { FastifyInstance } from 'fastify';
import { ApprovalRepository } from '@atlas/database';
import { ApprovalStatusSchema } from '@atlas/shared';
import { z } from 'zod';
import { rootLogger } from '@atlas/observability';

const ApprovalDecisionSchema = z.object({
  status: z.enum(['approved', 'rejected', 'revision_requested']),
  decisionNote: z.string().max(2000).optional()
});

export interface ApprovalRouteOptions {
  approvalRepo: ApprovalRepository;
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
    const parsed = ApprovalDecisionSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid approval decision.', details: parsed.error.errors });
    }

    const actor = req.headers['x-actor-id'] || 'api-owner';
    const decidedBy = Array.isArray(actor) ? actor[0] : actor;
    const approval = await options.approvalRepo.decide(
      id,
      parsed.data.status,
      decidedBy || 'api-owner',
      parsed.data.decisionNote
    );
    if (!approval) {
      return reply.status(409).send({
        error: 'Approval was not changed. It may not exist, may be expired, or may already be decided.'
      });
    }

    return reply.status(200).send({
      approval,
      message: 'Approval decision recorded. No outbound side effect was executed by this decision endpoint.'
    });
  });
}
