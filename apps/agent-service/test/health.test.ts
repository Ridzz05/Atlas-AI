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

  it('protects API routes with the configured bearer token', async () => {
    const token = 'a'.repeat(32);
    const protectedServer = buildServer({
      config: EnvConfigSchema.parse({ NODE_ENV: 'production', API_AUTH_TOKEN: token })
    });

    const unauthorized = await protectedServer.inject({
      method: 'GET',
      url: '/api/v1/info'
    });
    expect(unauthorized.statusCode).toBe(401);

    const authorized = await protectedServer.inject({
      method: 'GET',
      url: '/api/v1/info',
      headers: { authorization: `Bearer ${token}` }
    });
    expect(authorized.statusCode).toBe(200);

    const health = await protectedServer.inject({
      method: 'GET',
      url: '/health'
    });
    expect(health.statusCode).toBe(200);
  });

  it('emits CORS headers only for configured origins', async () => {
    const corsServer = buildServer({
      config: EnvConfigSchema.parse({
        NODE_ENV: 'test',
        CORS_ALLOWED_ORIGINS: 'https://dashboard.example.com'
      })
    });

    const allowed = await corsServer.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'https://dashboard.example.com' }
    });
    expect(allowed.headers['access-control-allow-origin']).toBe('https://dashboard.example.com');

    const denied = await corsServer.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'https://evil.example.com' }
    });
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('rate-limits protected API requests and leaves health checks available', async () => {
    const limitedServer = buildServer({
      config: EnvConfigSchema.parse({
        NODE_ENV: 'test',
        API_RATE_LIMIT_MAX_REQUESTS: 2,
        API_RATE_LIMIT_WINDOW_SECONDS: 60
      })
    });

    const first = await limitedServer.inject({ method: 'GET', url: '/api/v1/info' });
    const second = await limitedServer.inject({ method: 'GET', url: '/api/v1/info' });
    const third = await limitedServer.inject({ method: 'GET', url: '/api/v1/info' });
    const health = await limitedServer.inject({ method: 'GET', url: '/health' });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(third.statusCode).toBe(429);
    expect(third.headers['retry-after']).toBeDefined();
    expect(health.statusCode).toBe(200);
  });
});
