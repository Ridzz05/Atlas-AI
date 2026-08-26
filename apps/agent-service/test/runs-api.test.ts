import { describe, expect, it, vi } from 'vitest';
import { EnvConfigSchema } from '@atlas/shared';
import { buildServer } from '../src/server.js';

describe('agent-service cancellation endpoint', () => {
  it('persists a cancellation request even when the run is owned by another worker', async () => {
    const runRepo = {
      requestCancellation: vi.fn().mockResolvedValue({ id: '123e4567-e89b-12d3-a456-426614174000' })
    } as any;
    const server = buildServer({
      config: EnvConfigSchema.parse({ NODE_ENV: 'test' }),
      runRepo,
      processQueue: false
    });

    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/runs/123e4567-e89b-12d3-a456-426614174000/cancel',
      payload: { reason: 'owner stop' }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().message).toContain('Cancellation requested');
    expect(runRepo.requestCancellation).toHaveBeenCalledWith('123e4567-e89b-12d3-a456-426614174000', 'owner stop');
  });

  it('rejects invalid run IDs and cancellation reasons before touching the repository', async () => {
    const runRepo = {
      requestCancellation: vi.fn().mockResolvedValue({ id: '123e4567-e89b-12d3-a456-426614174000' })
    } as any;
    const server = buildServer({
      config: EnvConfigSchema.parse({ NODE_ENV: 'test' }),
      runRepo,
      processQueue: false
    });

    const invalidId = await server.inject({
      method: 'POST',
      url: '/api/v1/runs/not-a-uuid/cancel',
      payload: { reason: 'owner stop' }
    });
    const invalidReason = await server.inject({
      method: 'POST',
      url: '/api/v1/runs/123e4567-e89b-12d3-a456-426614174000/cancel',
      payload: { reason: '   ' }
    });
    const oversizedReason = await server.inject({
      method: 'POST',
      url: '/api/v1/runs/123e4567-e89b-12d3-a456-426614174000/cancel',
      payload: { reason: 'x'.repeat(501) }
    });

    expect(invalidId.statusCode).toBe(400);
    expect(invalidReason.statusCode).toBe(400);
    expect(oversizedReason.statusCode).toBe(400);
    expect(runRepo.requestCancellation).not.toHaveBeenCalled();
  });
});
