import { describe, expect, it, vi } from 'vitest';
import { EnvConfigSchema } from '@atlas/shared';
import { InMemoryMemoryStore, MemoryRetriever, MemoryTools } from '@atlas/memory';
import { buildServer } from '../src/server.js';

/**
 * The memory loop must be closable.
 *
 * Agents write memory through `memory.propose_write`, which always creates an item as `unverified`.
 * Agent reads go through `memory.search` and `memory.get`, which are verified-only — a rule this
 * codebase deliberately enforces on every agent-facing route. `MemoryProposalService.verify()` and
 * `.deprecate()` implement the promotion step and audit it, but nothing reachable called either one:
 * there was no route, and no button.
 *
 * The consequence is that the whole subsystem was inert. Every proposal stayed `unverified` forever,
 * so every agent read returned nothing, and the only way to change a memory item's status was to
 * edit the database by hand — bypassing the audit trail that the service methods exist to write.
 *
 * The operator already holds the authority these routes need: the same `API_AUTH_TOKEN` bearer that
 * decides approvals, pauses intake and stops the system. Promotion is the same kind of act.
 */
const memoryId = '123e4567-e89b-12d3-a456-426614174100';

async function buildServerWithMemory() {
  const memoryStore = new InMemoryMemoryStore();
  await memoryStore.save({
    id: memoryId,
    type: 'entity',
    status: 'unverified',
    content: 'Mega Gym Palembang has 500 active members',
    scope: 'approved_research',
    author: 'ned',
    source: 'agent',
    confidence: 0.85,
    taskId: null,
    artifactId: null,
    metadata: {},
    expiresAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

  const auditCreate = vi.fn(async () => ({ id: 'audit-1' }));
  const server = buildServer({
    config: EnvConfigSchema.parse({ NODE_ENV: 'test' }),
    memoryStore,
    auditRepo: { create: auditCreate } as any,
    processQueue: false
  });

  return { server, memoryStore, auditCreate };
}

/** What an agent would see, using the same verified-only tools the worker registers. */
async function agentVisibleIds(memoryStore: InMemoryMemoryStore): Promise<string[]> {
  const tools = new MemoryTools(new MemoryRetriever(memoryStore), {} as any, memoryStore);
  const { results } = await tools.search({ query: 'Mega Gym Palembang members', allowedScopes: ['approved_research'] });
  return results.map(r => r.id);
}

describe('operator memory governance routes', () => {
  it('promotes a proposal to verified, and the agent can then read it', async () => {
    const { server, memoryStore } = await buildServerWithMemory();
    expect(await agentVisibleIds(memoryStore)).toEqual([]);

    const response = await server.inject({ method: 'POST', url: `/api/v1/memory/${memoryId}/verify` });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).item.status).toBe('verified');
    expect(await agentVisibleIds(memoryStore)).toEqual([memoryId]);
  });

  it('audits the promotion through the memory audit sink', async () => {
    const { server, auditCreate } = await buildServerWithMemory();

    await server.inject({ method: 'POST', url: `/api/v1/memory/${memoryId}/verify` });

    expect(auditCreate).toHaveBeenCalledTimes(1);
    expect(auditCreate.mock.calls[0]?.[0]).toMatchObject({
      actor: 'memory-governance',
      action: 'memory.verified',
      target: memoryId
    });
  });

  it('deprecates an item, and the agent can no longer read it', async () => {
    const { server, memoryStore, auditCreate } = await buildServerWithMemory();
    await server.inject({ method: 'POST', url: `/api/v1/memory/${memoryId}/verify` });
    expect(await agentVisibleIds(memoryStore)).toEqual([memoryId]);

    const response = await server.inject({ method: 'POST', url: `/api/v1/memory/${memoryId}/deprecate` });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).item.status).toBe('deprecated');
    expect(await agentVisibleIds(memoryStore)).toEqual([]);
    expect(auditCreate.mock.calls[1]?.[0]).toMatchObject({ action: 'memory.deprecated' });
  });

  it('rejects a non-uuid id and an unknown id', async () => {
    const { server } = await buildServerWithMemory();

    const badId = await server.inject({ method: 'POST', url: '/api/v1/memory/not-a-uuid/verify' });
    expect(badId.statusCode).toBe(400);

    const unknown = await server.inject({
      method: 'POST',
      url: '/api/v1/memory/123e4567-e89b-12d3-a456-426614174999/verify'
    });
    expect(unknown.statusCode).toBe(404);
  });

  it('refuses the promotion when no memory store is configured', async () => {
    const server = buildServer({ config: EnvConfigSchema.parse({ NODE_ENV: 'test' }), processQueue: false });

    const response = await server.inject({ method: 'POST', url: `/api/v1/memory/${memoryId}/verify` });

    expect(response.statusCode).toBe(503);
  });

  // Verification on an expired item cannot take effect: every read filters `expires_at <= NOW()`, so
  // the item stays invisible to agents however its status reads. Reporting success would be a
  // promotion that did nothing — the operator would believe the fact is canonical.
  it('refuses to promote an item whose expiry has already passed', async () => {
    const memoryStore = new InMemoryMemoryStore();
    const expiredId = '123e4567-e89b-12d3-a456-426614174200';
    await memoryStore.save({
      id: expiredId,
      type: 'entity',
      status: 'unverified',
      content: 'A stale fact',
      scope: 'approved_research',
      author: 'ned',
      source: 'agent',
      confidence: 0.5,
      taskId: null,
      artifactId: null,
      metadata: {},
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
      createdAt: new Date(Date.now() - 120_000).toISOString(),
      updatedAt: new Date(Date.now() - 120_000).toISOString()
    });
    const server = buildServer({
      config: EnvConfigSchema.parse({ NODE_ENV: 'test' }),
      memoryStore,
      processQueue: false
    });

    const response = await server.inject({ method: 'POST', url: `/api/v1/memory/${expiredId}/verify` });

    // 404 rather than 409: an expired item is treated as gone by every read path (findById, search,
    // memory.get), so the governance route answers the same way rather than inventing a second
    // convention. The message names the expiry so the operator is not left guessing.
    expect(response.statusCode).toBe(404);
    expect(JSON.parse(response.body).error).toMatch(/expired/i);
  });
});
