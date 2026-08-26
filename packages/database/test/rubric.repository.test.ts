import { describe, expect, it, vi } from 'vitest';
import { LeadRubricRepository } from '../src/index.js';

const definition = {
  version: 'v1',
  maxScores: { businessTypeFit: 100 },
  thresholds: { qualified: 80, needsReview: 60 }
};

const row = {
  version: 'v1',
  definition,
  is_active: true,
  created_by: 'system',
  created_at: '2026-08-26T00:00:00.000Z',
  updated_at: '2026-08-26T00:00:00.000Z'
};

function createTransactionalDb(handler: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>) {
  const client = { query: vi.fn(handler) };
  return {
    db: {
      query: vi.fn(handler),
      transaction: vi.fn(async (callback: (tx: typeof client) => Promise<unknown>) => callback(client))
    } as any,
    client
  };
}

describe('LeadRubricRepository', () => {
  it('lists persisted rubric versions and maps database fields to the public contract', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [row] }) } as any;
    const repository = new LeadRubricRepository(db);

    await expect(repository.list()).resolves.toEqual([
      {
        version: 'v1',
        definition,
        isActive: true,
        createdBy: 'system',
        createdAt: '2026-08-26T00:00:00.000Z',
        updatedAt: '2026-08-26T00:00:00.000Z'
      }
    ]);
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('FROM lead_rubrics'), []);
  });

  it('creates a new immutable version and can activate it atomically', async () => {
    const { db, client } = createTransactionalDb(async sql => {
      if (sql.includes('INSERT INTO lead_rubrics')) return { rows: [row] };
      return { rows: [] };
    });
    const repository = new LeadRubricRepository(db);

    const created = await repository.create({
      version: 'v1',
      definition,
      createdBy: 'system',
      activate: true
    });

    expect(created).toMatchObject({ version: 'v1', isActive: true, createdBy: 'system' });
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO lead_rubrics'),
      expect.arrayContaining(['v1', JSON.stringify(definition), 'system', true])
    );
  });

  it('does not deactivate the current version when activating an unknown version', async () => {
    const { db, client } = createTransactionalDb(async sql => {
      if (sql.includes('WHERE version = $1')) return { rows: [] };
      return { rows: [] };
    });
    const repository = new LeadRubricRepository(db);

    await expect(repository.activate('missing')).resolves.toBeNull();
    expect(client.query).not.toHaveBeenCalledWith(expect.stringContaining('SET is_active = FALSE'), expect.anything());
  });

  it('ensures a default version without replacing an already active operational version', async () => {
    const activeRow = { ...row, version: 'v2', definition: { ...definition, version: 'v2' } };
    const { db, client } = createTransactionalDb(async sql => {
      if (sql.includes('WHERE is_active = TRUE')) return { rows: [activeRow] };
      if (sql.includes('INSERT INTO lead_rubrics')) return { rows: [] };
      return { rows: [] };
    });
    const repository = new LeadRubricRepository(db);

    await repository.ensureDefault({
      version: 'v1',
      definition,
      createdBy: 'system'
    });

    expect(client.query).not.toHaveBeenCalledWith(expect.stringContaining('SET is_active = FALSE'), expect.anything());
  });
});
