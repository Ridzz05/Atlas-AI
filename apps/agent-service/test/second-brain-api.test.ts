import { describe, it, expect } from 'vitest';
import { buildServer } from '../src/server.js';
import { EnvConfigSchema } from '@atlas/shared';
import { SecondBrainService } from '@atlas/memory';

describe('agent-service second brain REST endpoints', () => {
  const config = EnvConfigSchema.parse({ NODE_ENV: 'test' });
  const secondBrainService = new SecondBrainService({ provider: 'mock', dimension: 128 });
  const server = buildServer({ config, secondBrainService, processQueue: false });

  it('GET /api/v1/brain/stats returns stats structure', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/brain/stats'
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.data).toMatchObject({
      totalDocuments: expect.any(Number),
      totalChunks: expect.any(Number),
      vectorDimension: 128
    });
  });

  it('POST /api/v1/brain/ingest indexes a markdown note', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/brain/ingest',
      payload: {
        title: 'Sales Strategy 2026',
        filePath: 'strategy/sales-2026.md',
        content: `---
title: "Sales Strategy 2026"
tags: [strategy, sales, growth]
---

# Q3 Gym Inbound Target
Reach 50 gyms across Sumatra and Java with automated Telegram outreach.`
      }
    });

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body);
    expect(body.status).toBe('success');
    expect(body.data.title).toBe('Sales Strategy 2026');
    expect(body.data.tags).toContain('sales');
  });

  it('GET /api/v1/brain/notes lists indexed notes', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/brain/notes'
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.count).toBeGreaterThanOrEqual(1);
    expect(body.data[0].title).toBe('Sales Strategy 2026');
  });

  it('GET /api/v1/brain/search retrieves matching chunks with citations', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/brain/search?q=gym+inbound+target'
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.count).toBeGreaterThanOrEqual(1);
    expect(body.data[0].citation.noteTitle).toBe('Sales Strategy 2026');
  });

  it('POST /api/v1/brain/query synthesizes grounded RAG answer', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/brain/query',
      payload: {
        query: 'What is the Q3 gym inbound target?'
      }
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.data.answer).toContain('Sales Strategy 2026');
    expect(body.data.citations.length).toBeGreaterThan(0);
  });

  it('GET and DELETE note by ID works properly', async () => {
    const listRes = await server.inject({ method: 'GET', url: '/api/v1/brain/notes' });
    const noteId = JSON.parse(listRes.body).data[0].id;

    const getRes = await server.inject({ method: 'GET', url: `/api/v1/brain/notes/${noteId}` });
    expect(getRes.statusCode).toBe(200);

    const deleteRes = await server.inject({ method: 'DELETE', url: `/api/v1/brain/notes/${noteId}` });
    expect(deleteRes.statusCode).toBe(200);

    const getAfterDelete = await server.inject({ method: 'GET', url: `/api/v1/brain/notes/${noteId}` });
    expect(getAfterDelete.statusCode).toBe(404);
  });
});
