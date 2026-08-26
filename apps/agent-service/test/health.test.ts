import { describe, it, expect, vi } from 'vitest';
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
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it('GET /ready returns 200 and status ready', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/ready'
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.status).toBe('ready');
    expect(body.queue).toBe('connected');
  });

  it('returns degraded when the configured task queue is unavailable', async () => {
    const unavailableQueue = {
      enqueue: vi.fn(),
      process: vi.fn(),
      close: vi.fn(),
      healthCheck: vi.fn().mockResolvedValue(false)
    };
    const degradedServer = buildServer({
      config,
      taskQueue: unavailableQueue as any,
      processQueue: false
    });

    const response = await degradedServer.inject({ method: 'GET', url: '/ready' });

    expect(response.statusCode).toBe(503);
    expect(JSON.parse(response.body)).toMatchObject({ status: 'degraded', queue: 'disconnected' });
  });

  it('fails closed when the configured task queue cannot report health', async () => {
    const unverifiableQueue = {
      enqueue: vi.fn(),
      process: vi.fn(),
      close: vi.fn()
    };
    const degradedServer = buildServer({
      config,
      taskQueue: unverifiableQueue as any,
      processQueue: false
    });

    const response = await degradedServer.inject({ method: 'GET', url: '/ready' });

    expect(response.statusCode).toBe(503);
    expect(JSON.parse(response.body)).toMatchObject({ status: 'degraded', queue: 'disconnected' });
  });

  it('preserves a valid incoming request id and replaces an unsafe one', async () => {
    const validRequestId = 'owner-request-2026-08-26';
    const unsafeRequestId = 'bad request\nwith-newline';

    const valid = await server.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-request-id': validRequestId }
    });
    const unsafe = await server.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-request-id': unsafeRequestId }
    });

    expect(valid.headers['x-request-id']).toBe(validRequestId);
    expect(unsafe.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/i);
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

  it('GET /api/v1/settings exposes governance configuration without secrets', async () => {
    const token = 'a'.repeat(32);
    const secret = 'sk-sensitive-model-key';
    const settingsServer = buildServer({
      config: EnvConfigSchema.parse({
        NODE_ENV: 'production',
        API_AUTH_TOKEN: token,
        MODEL_PROVIDER: 'openai',
        MODEL_API_KEY: secret,
        ENCRYPTION_KEY: 'b'.repeat(64),
        GLOBAL_DAILY_BUDGET_USD: 7.5,
        EXTERNAL_WRITES_ENABLED: false
      })
    });

    const response = await settingsServer.inject({
      method: 'GET',
      url: '/api/v1/settings',
      headers: { authorization: `Bearer ${token}` }
    });
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(200);
    expect(body.data).toMatchObject({
      nodeEnv: 'production',
      modelProvider: 'openai',
      globalDailyBudgetUsd: 7.5,
      externalWritesEnabled: false,
      mutable: false,
      source: 'environment'
    });
    expect(response.body).not.toContain(secret);
    expect(response.body).not.toContain(token);
  });

  it('protects API routes with the configured bearer token', async () => {
    const token = 'a'.repeat(32);
    const protectedServer = buildServer({
      config: EnvConfigSchema.parse({
        NODE_ENV: 'production',
        API_AUTH_TOKEN: token,
        ENCRYPTION_KEY: 'b'.repeat(64),
        MODEL_PROVIDER: 'openai',
        MODEL_API_KEY: 'test-model-key'
      })
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

  it('fails closed when the distributed rate limiter is unavailable', async () => {
    const rateLimiter = {
      check: vi.fn().mockRejectedValue(new Error('redis offline')),
      close: vi.fn().mockResolvedValue(undefined)
    };
    const protectedServer = buildServer({ config, rateLimiter });

    const response = await protectedServer.inject({ method: 'GET', url: '/api/v1/info' });

    expect(response.statusCode).toBe(503);
    expect(JSON.parse(response.body).error).toContain('Rate limiter unavailable');
    expect(rateLimiter.check).toHaveBeenCalledWith('127.0.0.1');
  });
});
