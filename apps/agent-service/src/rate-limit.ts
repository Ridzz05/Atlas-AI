import Redis from 'ioredis';

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds?: number;
}

export interface RateLimiter {
  check(key: string): Promise<RateLimitDecision>;
  close(): Promise<void>;
}

export interface RateLimiterOptions {
  windowMs: number;
  maxRequests: number;
}

export class InMemoryRateLimiter implements RateLimiter {
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();

  private readonly windowMs: number;
  private readonly maxRequests: number;

  constructor(options: RateLimiterOptions) {
    this.windowMs = options.windowMs;
    this.maxRequests = options.maxRequests;
  }

  public async check(key: string): Promise<RateLimitDecision> {
    const now = Date.now();
    const current = this.buckets.get(key);
    const bucket = !current || current.resetAt <= now
      ? { count: 0, resetAt: now + this.windowMs }
      : current;

    bucket.count += 1;
    this.buckets.set(key, bucket);

    return {
      allowed: bucket.count <= this.maxRequests,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))
    };
  }

  public async close(): Promise<void> {
    this.buckets.clear();
  }
}

export interface RedisRateLimiterClient {
  eval(script: string, numberOfKeys: number, ...args: string[]): Promise<unknown>;
  quit?(): Promise<unknown>;
  disconnect?(): void;
}

const RATE_LIMIT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
return { count, ttl }
`;

export interface RedisRateLimiterOptions extends RateLimiterOptions {
  redisUrl: string;
  client?: RedisRateLimiterClient;
}

export class RedisRateLimiter implements RateLimiter {
  private readonly client: RedisRateLimiterClient;
  private readonly ownsClient: boolean;
  private readonly windowMs: number;
  private readonly maxRequests: number;

  constructor(options: RedisRateLimiterOptions) {
    this.client = options.client || new Redis(options.redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false
    });
    this.ownsClient = !options.client;
    this.windowMs = options.windowMs;
    this.maxRequests = options.maxRequests;
  }

  public async check(key: string): Promise<RateLimitDecision> {
    const result = await this.client.eval(
      RATE_LIMIT_SCRIPT,
      1,
      `atlas:api-rate-limit:${key}`,
      String(this.windowMs)
    );

    if (!Array.isArray(result) || result.length < 2) {
      throw new Error('invalid Redis rate-limit response');
    }

    const count = Number(result[0]);
    const ttlMs = Number(result[1]);
    if (!Number.isFinite(count) || !Number.isFinite(ttlMs)) {
      throw new Error('invalid Redis rate-limit response');
    }

    return {
      allowed: count <= this.maxRequests,
      retryAfterSeconds: Math.max(1, Math.ceil(Math.max(0, ttlMs) / 1000))
    };
  }

  public async close(): Promise<void> {
    if (!this.ownsClient) return;

    try {
      await this.client.quit?.();
    } catch {
      this.client.disconnect?.();
    }
  }
}
