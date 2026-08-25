import { describe, expect, it } from 'vitest';
import { EnvConfigSchema } from '@atlas/shared';
import { InMemoryTaskQueue } from '@atlas/orchestration';
import { createAtlasRuntime } from '../src/index.js';

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
});
