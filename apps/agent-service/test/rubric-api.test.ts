import { afterEach, describe, expect, it, vi } from 'vitest';
import { EnvConfigSchema } from '@atlas/shared';
import { DEFAULT_LEAD_RUBRIC, RubricEngine } from '@atlas/tools';
import { buildServer } from '../src/server.js';

const activeRow = {
  version: DEFAULT_LEAD_RUBRIC.version,
  definition: DEFAULT_LEAD_RUBRIC,
  isActive: true,
  createdBy: 'system',
  createdAt: '2026-08-26T00:00:00.000Z',
  updatedAt: '2026-08-26T00:00:00.000Z'
};

function createRepository() {
  return {
    list: vi.fn().mockResolvedValue([activeRow]),
    getActive: vi.fn().mockResolvedValue(activeRow),
    get: vi.fn(),
    create: vi.fn().mockResolvedValue(activeRow),
    activate: vi.fn().mockResolvedValue(activeRow),
    ensureDefault: vi.fn()
  } as any;
}

describe('agent-service rubric control API', () => {
  afterEach(() => {
    RubricEngine.hydrate([DEFAULT_LEAD_RUBRIC], DEFAULT_LEAD_RUBRIC.version);
  });

  it('lists persisted rubric versions and the active version', async () => {
    const rubricRepo = createRepository();
    const server = buildServer({
      config: EnvConfigSchema.parse({ NODE_ENV: 'test' }),
      rubricRepo,
      processQueue: false
    });

    const response = await server.inject({ method: 'GET', url: '/api/v1/rubrics' });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      data: [activeRow],
      activeVersion: DEFAULT_LEAD_RUBRIC.version,
      durable: true
    });
  });

  it('rejects malformed rubric definitions before touching the repository', async () => {
    const rubricRepo = createRepository();
    const server = buildServer({
      config: EnvConfigSchema.parse({ NODE_ENV: 'test' }),
      rubricRepo,
      processQueue: false
    });

    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/rubrics',
      payload: {
        definition: {
          ...DEFAULT_LEAD_RUBRIC,
          version: 'invalid-total',
          maxScores: { ...DEFAULT_LEAD_RUBRIC.maxScores, businessTypeFit: 14 }
        },
        activate: true
      }
    });

    expect(response.statusCode).toBe(400);
    expect(rubricRepo.create).not.toHaveBeenCalled();
  });

  it('fails closed before mutation when audit storage is unavailable', async () => {
    const rubricRepo = createRepository();
    const server = buildServer({
      config: EnvConfigSchema.parse({ NODE_ENV: 'test' }),
      rubricRepo,
      processQueue: false
    });

    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/rubrics',
      payload: { definition: DEFAULT_LEAD_RUBRIC, activate: false }
    });

    expect(response.statusCode).toBe(503);
    expect(rubricRepo.create).not.toHaveBeenCalled();
  });

  it('creates a validated version and refreshes the active engine after activation', async () => {
    const definition = {
      ...DEFAULT_LEAD_RUBRIC,
      version: 'v2-api',
      thresholds: { qualified: 70, needsReview: 40 }
    };
    const createdRow = { ...activeRow, version: definition.version, definition };
    const rubricRepo = createRepository();
    const auditCreate = vi.fn().mockResolvedValue({});
    rubricRepo.create.mockResolvedValue(createdRow);
    rubricRepo.list.mockResolvedValue([createdRow]);
    rubricRepo.getActive.mockResolvedValue(createdRow);
    const server = buildServer({
      config: EnvConfigSchema.parse({ NODE_ENV: 'test' }),
      rubricRepo,
      auditRepo: { create: auditCreate } as any,
      processQueue: false
    });

    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/rubrics',
      payload: { definition, activate: true }
    });

    expect(response.statusCode).toBe(201);
    expect(rubricRepo.create).toHaveBeenCalledWith({
      version: definition.version,
      definition,
      createdBy: 'owner-api',
      activate: true
    });
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: 'owner-api',
        action: 'rubric.created',
        target: definition.version
      })
    );
    expect(RubricEngine.getRubric().version).toBe(definition.version);
  });

  it('returns not found and preserves the active version when activation misses', async () => {
    const rubricRepo = createRepository();
    const auditCreate = vi.fn().mockResolvedValue({});
    rubricRepo.activate.mockResolvedValue(null);
    const server = buildServer({
      config: EnvConfigSchema.parse({ NODE_ENV: 'test' }),
      rubricRepo,
      auditRepo: { create: auditCreate } as any,
      processQueue: false
    });

    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/rubrics/missing/activate'
    });

    expect(response.statusCode).toBe(404);
    expect(RubricEngine.getRubric().version).toBe(DEFAULT_LEAD_RUBRIC.version);
    expect(rubricRepo.list).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it('audits a successful version activation after refreshing the engine', async () => {
    const definition = {
      ...DEFAULT_LEAD_RUBRIC,
      version: 'v2-activated',
      thresholds: { qualified: 70, needsReview: 40 }
    };
    const activatedRow = { ...activeRow, version: definition.version, definition };
    const rubricRepo = createRepository();
    const auditCreate = vi.fn().mockResolvedValue({});
    rubricRepo.activate.mockResolvedValue(activatedRow);
    rubricRepo.list.mockResolvedValue([activatedRow]);
    rubricRepo.getActive.mockResolvedValue(activatedRow);
    const server = buildServer({
      config: EnvConfigSchema.parse({ NODE_ENV: 'test' }),
      rubricRepo,
      auditRepo: { create: auditCreate } as any,
      processQueue: false
    });

    const response = await server.inject({
      method: 'POST',
      url: `/api/v1/rubrics/${definition.version}/activate`
    });

    expect(response.statusCode).toBe(200);
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: 'owner-api',
        action: 'rubric.activated',
        target: definition.version
      })
    );
    expect(RubricEngine.getRubric().version).toBe(definition.version);
  });
});
