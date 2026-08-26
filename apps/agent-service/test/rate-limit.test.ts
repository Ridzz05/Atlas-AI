import { describe, expect, it, vi } from 'vitest';
import { InMemoryRateLimiter, RedisRateLimiter } from '../src/rate-limit.js';

describe('agent-service rate limiting', () => {
  it('enforces a fixed window in memory', async () => {
    const limiter = new InMemoryRateLimiter({ windowMs: 60_000, maxRequests: 2 });

    await expect(limiter.check('127.0.0.1')).resolves.toMatchObject({ allowed: true });
    await expect(limiter.check('127.0.0.1')).resolves.toMatchObject({ allowed: true });
    await expect(limiter.check('127.0.0.1')).resolves.toMatchObject({ allowed: false });
  });

  it('uses an atomic Redis window and returns retry metadata', async () => {
    const evalMock = vi.fn().mockResolvedValue([3, 12_500]);
    const limiter = new RedisRateLimiter({
      redisUrl: 'redis://localhost:6379',
      windowMs: 60_000,
      maxRequests: 2,
      client: { eval: evalMock }
    });

    await expect(limiter.check('127.0.0.1')).resolves.toEqual({
      allowed: false,
      retryAfterSeconds: 13
    });
    expect(evalMock).toHaveBeenCalledWith(expect.stringContaining('PEXPIRE'), 1, 'atlas:api-rate-limit:127.0.0.1', '60000');
  });

  it('fails on malformed Redis responses instead of allowing unbounded traffic', async () => {
    const limiter = new RedisRateLimiter({
      redisUrl: 'redis://localhost:6379',
      windowMs: 60_000,
      maxRequests: 2,
      client: { eval: vi.fn().mockResolvedValue('invalid') }
    });

    await expect(limiter.check('127.0.0.1')).rejects.toThrow('invalid Redis rate-limit response');
  });
});
