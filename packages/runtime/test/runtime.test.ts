import { describe, expect, it, vi } from 'vitest';
import { EnvConfigSchema } from '@atlas/shared';
import { InMemoryTaskQueue } from '@atlas/orchestration';
import { DEFAULT_LEAD_RUBRIC, RubricEngine } from '@atlas/tools';
import { createAtlasRuntime } from '../src/index.js';
import { createServiceHealthServer, getServiceReadiness } from '../src/health.js';

describe('@atlas/runtime', () => {
  it('composes repositories and injected runtime dependencies without external services', async () => {
    const db = {
      close: async () => undefined
    } as never;
    const queue = new InMemoryTaskQueue();
    const runtime = await createAtlasRuntime(EnvConfigSchema.parse({ NODE_ENV: 'test' }), {
      db,
      taskQueue: queue,
      migrate: false,
      seed: false
    });

    expect(runtime.taskRepo).toBeDefined();
    expect(runtime.runRepo).toBeDefined();
    expect(runtime.taskQueue).toBe(queue);
    expect(runtime.registry.list()).toHaveLength(5);

    await runtime.close();
  });

  it('hydrates the active persisted lead rubric during runtime bootstrap', async () => {
    const activeDefinition = {
      ...DEFAULT_LEAD_RUBRIC,
      version: 'v2-active',
      thresholds: { qualified: 70, needsReview: 40 }
    };
    const defaultRow = {
      version: DEFAULT_LEAD_RUBRIC.version,
      definition: DEFAULT_LEAD_RUBRIC,
      is_active: false,
      created_by: 'system',
      created_at: '2026-08-26T00:00:00.000Z',
      updated_at: '2026-08-26T00:00:00.000Z'
    };
    const activeRow = {
      ...defaultRow,
      version: activeDefinition.version,
      definition: activeDefinition,
      is_active: true
    };
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM lead_rubrics') && sql.includes('is_active = TRUE')) {
        return { rows: [activeRow] };
      }
      if (sql.includes('FROM lead_rubrics')) {
        return { rows: [defaultRow, activeRow] };
      }
      return { rows: [] };
    });
    const db = {
      query,
      transaction: vi.fn(async (callback: (client: { query: typeof query }) => Promise<unknown>) => callback({ query })),
      close: async () => undefined
    } as any;

    try {
      const runtime = await createAtlasRuntime(EnvConfigSchema.parse({ NODE_ENV: 'test' }), {
        db,
        taskQueue: new InMemoryTaskQueue(),
        migrate: false,
        seed: false
      });

      expect(runtime.rubricRepo).toBeDefined();
      expect(RubricEngine.getRubric().version).toBe('v2-active');
      await runtime.close();
    } finally {
      RubricEngine.hydrate([DEFAULT_LEAD_RUBRIC], DEFAULT_LEAD_RUBRIC.version);
    }
  });

  it('fails readiness closed when the service or a runtime dependency is unavailable', async () => {
    const healthy = {
      healthCheck: async () => true
    };
    const unavailable = {
      healthCheck: async () => false
    };

    await expect(getServiceReadiness({
      service: 'worker',
      isRunning: () => false,
      database: healthy,
      queue: healthy
    })).resolves.toEqual({
      ready: false,
      database: false,
      queue: false
    });

    await expect(getServiceReadiness({
      service: 'telegram-bot',
      isRunning: () => true,
      database: healthy,
      queue: unavailable
    })).resolves.toEqual({
      ready: false,
      database: true,
      queue: false
    });
  });

  it('serves liveness and dependency-aware readiness endpoints', async () => {
    let running = true;
    const service = createServiceHealthServer({
      service: 'worker',
      isRunning: () => running,
      database: { healthCheck: async () => true },
      queue: { healthCheck: async () => true }
    }, { host: '127.0.0.1', port: 0 });

    await service.start();
    const address = service.server.address();
    if (!address || typeof address === 'string') throw new Error('Health server did not bind to a TCP port.');

    const health = await fetch(`http://127.0.0.1:${address.port}/health`);
    expect(health.status).toBe(200);
    expect((await health.json()).service).toBe('worker');

    const ready = await fetch(`http://127.0.0.1:${address.port}/ready`);
    expect(ready.status).toBe(200);
    expect((await ready.json()).status).toBe('ready');

    running = false;
    const degraded = await fetch(`http://127.0.0.1:${address.port}/ready`);
    expect(degraded.status).toBe(503);
    expect((await degraded.json()).status).toBe('degraded');

    await service.stop();
  });
});
