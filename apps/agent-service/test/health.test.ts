import { describe, it, expect } from 'vitest';
import { buildServer } from '../src/server.js';
import { EnvConfigSchema } from '@atlas/shared';

describe('agent-service health endpoints', () => {
  const config = EnvConfigSchema.parse({ NODE_ENV: 'test' });
  const server = buildServer({ config });

  it('GET /health returns 200 and status ok', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/health'
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.status).toBe('ok');
    expect(body.service).toBe('agent-service');
  });

  it('GET /ready returns 200 and status ready', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/ready'
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.status).toBe('ready');
  });

  it('GET /api/v1/info returns 200', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/info'
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.name).toBe('ATLAS AI OS Agent Service');
  });
});
