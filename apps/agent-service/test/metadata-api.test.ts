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
      server.inject({ method: 'GET', url: '/api/v1/messages?taskId=task-1' }),
      server.inject({ method: 'GET', url: '/api/v1/tool-calls?runId=run-1' }),
      server.inject({ method: 'GET', url: '/api/v1/memory?status=verified' })
    ]);

    expect(JSON.parse(artifacts.body)).toMatchObject({ count: 1, durable: true });
    expect(JSON.parse(audit.body)).toMatchObject({ count: 1, durable: true });
    expect(JSON.parse(messages.body)).toMatchObject({ count: 1, durable: true });
    expect(JSON.parse(toolCalls.body)).toMatchObject({ count: 1, durable: true });
    expect(JSON.parse(memory.body)).toMatchObject({ count: 1, durable: true });
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
});
