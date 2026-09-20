import { describe, expect, it, vi } from 'vitest';
import { EnvConfigSchema } from '@atlas/shared';
import { buildServer } from '../src/server.js';

/**
 * Unhandled route errors used to be serialised to the client verbatim.
 *
 * No `setErrorHandler` was registered and the server runs with `logger: false`, so Fastify's
 * default handler put `error.message` straight into the 500 body and no server-side log line was
 * emitted at all. A failing repository therefore told the caller the table name, the database
 * host and port, or an absolute filesystem path — and left the operator with nothing to correlate
 * against the response's `x-request-id`.
 */
describe('agent-service error handling', () => {
  const internalDetail = 'connect ECONNREFUSED 10.1.2.3:5432 (relation "secret_table")';

  function buildWithFailingRepo() {
    return buildServer({
      config: EnvConfigSchema.parse({ NODE_ENV: 'test' }),
      eventRepo: {
        list: vi.fn().mockRejectedValue(new Error(internalDetail))
      } as any
    });
  }

  it('does not leak an internal error message to the client', async () => {
    const server = buildWithFailingRepo();

    const response = await server.inject({ method: 'GET', url: '/api/v1/events?limit=1' });

    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain('ECONNREFUSED');
    expect(response.body).not.toContain('secret_table');
    expect(response.body).not.toContain('10.1.2.3');
    expect(JSON.parse(response.body)).toMatchObject({ error: expect.any(String) });
  });

  it('keeps the request id on an error response so the failure can be correlated', async () => {
    const server = buildWithFailingRepo();

    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/events?limit=1',
      headers: { 'x-request-id': 'trace-me-123' }
    });

    expect(response.statusCode).toBe(500);
    expect(response.headers['x-request-id']).toBe('trace-me-123');
  });

  it('passes an explicit client error through instead of masking it', async () => {
    const server = buildServer({
      config: EnvConfigSchema.parse({ NODE_ENV: 'test' }),
      eventRepo: { list: vi.fn() } as any
    });

    const response = await server.inject({ method: 'GET', url: '/api/v1/events?limit=9999' });

    // A validation rejection is the caller's fault and keeps its 400 and its message.
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toBeTruthy();
  });
});
