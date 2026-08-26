import { describe, expect, it, vi } from 'vitest';
import { InMemoryMemoryStore } from '@atlas/memory';
import { EnvConfigSchema } from '@atlas/shared';
import { buildServer } from '../src/server.js';

describe('agent-service metadata endpoints', () => {
  it('returns durable artifact, audit, and memory data', async () => {
    const memoryStore = new InMemoryMemoryStore();
    const memoryId = '123e4567-e89b-12d3-a456-426614174000';
    await memoryStore.save({
      id: memoryId,
      type: 'semantic',
      status: 'verified',
      content: 'ATLAS owner preference',
      scope: 'global',
      author: 'owner',
      source: 'test',
      confidence: 1,
      taskId: null,
      artifactId: null,
      metadata: {},
      expiresAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    const server = buildServer({
      config: EnvConfigSchema.parse({ NODE_ENV: 'test' }),
      artifactRepo: { list: vi.fn().mockResolvedValue([{ name: 'report.md' }]) } as any,
      auditRepo: { list: vi.fn().mockResolvedValue([{ action: 'tool.artifacts.write' }]) } as any,
      messageRepo: { list: vi.fn().mockResolvedValue([{ senderId: 'ned' }]) } as any,
      toolCallRepo: { list: vi.fn().mockResolvedValue([{ toolName: 'memory.search' }]) } as any,
      memoryStore
    });

    const [artifacts, audit, messages, toolCalls, memory] = await Promise.all([
      server.inject({ method: 'GET', url: '/api/v1/artifacts?limit=10' }),
      server.inject({ method: 'GET', url: '/api/v1/audit?limit=10' }),
      server.inject({ method: 'GET', url: '/api/v1/messages?taskId=123e4567-e89b-12d3-a456-426614174000' }),
      server.inject({ method: 'GET', url: '/api/v1/tool-calls?runId=123e4567-e89b-12d3-a456-426614174001' }),
      server.inject({ method: 'GET', url: '/api/v1/memory?status=verified' })
    ]);

    expect(JSON.parse(artifacts.body)).toMatchObject({ count: 1, durable: true });
    expect(JSON.parse(audit.body)).toMatchObject({ count: 1, durable: true });
    expect(JSON.parse(messages.body)).toMatchObject({ count: 1, durable: true });
    expect(JSON.parse(toolCalls.body)).toMatchObject({ count: 1, durable: true });
    expect(JSON.parse(memory.body)).toMatchObject({ count: 1, durable: true });
  });

  it('returns durable aggregate cost and budget metrics', async () => {
    const server = buildServer({
      config: EnvConfigSchema.parse({ NODE_ENV: 'test' }),
      runRepo: {
        getCostSummary: vi.fn().mockResolvedValue({
          periodStart: '2026-08-26T00:00:00.000Z',
          periodEnd: '2026-08-27T00:00:00.000Z',
          periodCostUsd: 0.12,
          totalCostUsd: 1.25,
          runCount: 4,
          activeRunCount: 1,
          completedRunCount: 2,
          failedRunCount: 1,
          byAgent: [{ agentId: 'ned', costUsd: 0.8, runCount: 2 }]
        })
      } as any,
      budgetRepo: {
        getGlobalDailySummary: vi.fn().mockResolvedValue({
          limitUsd: 5,
          usedUsd: 1.25,
          reservedUsd: 0.5,
          availableUsd: 3.25,
          resetAt: '2026-08-27T00:00:00.000Z'
        })
      } as any
    });

    const response = await server.inject({ method: 'GET', url: '/api/v1/costs' });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      durable: true,
      data: {
        costs: { periodCostUsd: 0.12, totalCostUsd: 1.25 },
        budget: { availableUsd: 3.25 }
      }
    });
  });

  it('rejects unsupported memory filters and invalid ids', async () => {
    const server = buildServer({
      config: EnvConfigSchema.parse({ NODE_ENV: 'test' }),
      memoryStore: new InMemoryMemoryStore()
    });

    const invalidStatus = await server.inject({ method: 'GET', url: '/api/v1/memory?status=unknown' });
    const invalidId = await server.inject({ method: 'GET', url: '/api/v1/memory/not-a-uuid' });

    expect(invalidStatus.statusCode).toBe(400);
    expect(invalidId.statusCode).toBe(400);
  });

  it('rejects UUID-shaped but invalid memory ids before repository access', async () => {
    const findById = vi.fn();
    const server = buildServer({
      config: EnvConfigSchema.parse({ NODE_ENV: 'test' }),
      memoryStore: { findById } as any
    });

    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/memory/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    });

    expect(response.statusCode).toBe(400);
    expect(findById).not.toHaveBeenCalled();
  });

  it('rejects invalid UUID filters before querying metadata repositories', async () => {
    const artifactList = vi.fn().mockResolvedValue([]);
    const auditList = vi.fn().mockResolvedValue([]);
    const messageList = vi.fn().mockResolvedValue([]);
    const toolCallList = vi.fn().mockResolvedValue([]);
    const server = buildServer({
      config: EnvConfigSchema.parse({ NODE_ENV: 'test' }),
      artifactRepo: { list: artifactList } as any,
      auditRepo: { list: auditList } as any,
      messageRepo: { list: messageList } as any,
      toolCallRepo: { list: toolCallList } as any
    });

    const responses = await Promise.all([
      server.inject({ method: 'GET', url: '/api/v1/artifacts?taskId=not-a-uuid' }),
      server.inject({ method: 'GET', url: '/api/v1/audit?runId=not-a-uuid' }),
      server.inject({ method: 'GET', url: '/api/v1/messages?taskId=not-a-uuid' }),
      server.inject({ method: 'GET', url: '/api/v1/tool-calls?runId=not-a-uuid' })
    ]);

    expect(responses.every(response => response.statusCode === 400)).toBe(true);
    expect(artifactList).not.toHaveBeenCalled();
    expect(auditList).not.toHaveBeenCalled();
    expect(messageList).not.toHaveBeenCalled();
    expect(toolCallList).not.toHaveBeenCalled();
  });
});
