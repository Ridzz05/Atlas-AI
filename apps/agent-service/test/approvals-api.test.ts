import { describe, expect, it, vi } from 'vitest';
import { EnvConfigSchema } from '@atlas/shared';
import { buildServer } from '../src/server.js';

/**
 * The approver recorded on an approval must be the principal that actually authenticated.
 *
 * The route read `req.headers['x-actor-id'] || 'api-owner'` and wrote that straight into
 * `approvals.decided_by` — a column that exists precisely to record who approved, and that the
 * approvals UI shows. So the client chose the name on the governance record: a payment could be
 * approved and durably recorded as "approved by cfo". Nothing in the system ever sent the header
 * (the dashboard does not), so its only effect was to let a caller misattribute a decision.
 *
 * The API authenticates exactly one principal — the holder of `API_AUTH_TOKEN` (server.ts) — so
 * there is no per-user identity to attribute to, and the honest value is that principal rather than
 * a string the request supplies.
 */
const approvalId = '123e4567-e89b-12d3-a456-426614174000';

function buildServerWithApprovalRepo() {
  const decided: Array<{ id: string; status: string; decidedBy: string }> = [];
  const approvalRepo = {
    list: vi.fn(async () => []),
    findById: vi.fn(async () => ({ id: approvalId, status: 'pending', taskId: approvalId })),
    decide: vi.fn(async (id: string, status: string, decidedBy: string) => {
      decided.push({ id, status, decidedBy });
      return { id, status, decidedBy, taskId: approvalId };
    })
  };

  const server = buildServer({
    config: EnvConfigSchema.parse({ NODE_ENV: 'test' }),
    approvalRepo: approvalRepo as any,
    processQueue: false
  });

  return { server, approvalRepo, decided };
}

describe('approval decision actor identity', () => {
  it('records the authenticated principal, not a client-supplied header', async () => {
    const { server, decided } = buildServerWithApprovalRepo();

    const response = await server.inject({
      method: 'POST',
      url: `/api/v1/approvals/${approvalId}/decision`,
      headers: { 'x-actor-id': 'cfo' },
      payload: { status: 'approved' }
    });

    expect(response.statusCode).toBe(200);
    expect(decided).toHaveLength(1);
    expect(decided[0]?.decidedBy).not.toBe('cfo');
    expect(decided[0]?.decidedBy).toBe('api-owner');
  });

  it('records the same principal when no header is sent', async () => {
    const { server, decided } = buildServerWithApprovalRepo();

    await server.inject({
      method: 'POST',
      url: `/api/v1/approvals/${approvalId}/decision`,
      payload: { status: 'rejected', decisionNote: 'Not now' }
    });

    expect(decided[0]?.decidedBy).toBe('api-owner');
  });
});
