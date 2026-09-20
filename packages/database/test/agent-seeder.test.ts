import { describe, expect, it, vi } from 'vitest';
import { rootLogger } from '@atlas/observability';
import { seedAgents } from '../src/agent-seeder.js';
import { AgentDefinition } from '@atlas/shared';

const chiefAgent: AgentDefinition = {
  id: 'chief',
  name: 'Chief',
  role: 'orchestrator',
  version: 1,
  description: 'Root orchestrator',
  systemPrompt: 'You are Chief.',
  limits: { maxTurns: 1, maxDelegationDepth: 2, timeoutSeconds: 10, maxCostUsd: 1 },
  permissions: { tools: [], dataScopes: ['global'], externalWrites: false },
  modelPolicy: { preferredTier: 'balanced', fallbackTier: 'fast', temperature: 0.2 },
  review: { humanApprovalFor: [] }
};

/**
 * The stored row as PostgreSQL would hand it back: JSONB columns already parsed.
 *
 * JSONB also normalises key order and drops `undefined`, so the comparison in the seeder must not
 * depend on either.
 */
function storedVersionRow(agent: AgentDefinition, overrides: Record<string, unknown> = {}) {
  return {
    system_prompt: agent.systemPrompt,
    model_policy: agent.modelPolicy,
    limits: agent.limits,
    permissions: agent.permissions,
    ...overrides
  };
}

/**
 * A fake client that models the conflict behaviour of `ON CONFLICT (agent_id, version) DO NOTHING
 * RETURNING id`: a row when the version is new, nothing when it already exists.
 */
function makeClient(existingVersionRow: Record<string, unknown> | null) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const client = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (sql.includes('INSERT INTO agent_versions')) {
        return existingVersionRow ? { rows: [] } : { rows: [{ id: 'version-row-1' }] };
      }
      if (sql.includes('SELECT system_prompt')) {
        return { rows: existingVersionRow ? [existingVersionRow] : [] };
      }
      return { rows: [] };
    })
  };
  return { client, calls };
}

function makeDb(client: { query: unknown }) {
  return {
    transaction: vi.fn(async (callback: (tx: typeof client) => Promise<void>) => callback(client))
  };
}

describe('@atlas/database agent seeding', () => {
  it('seeds the current agent definition and its version in one transaction', async () => {
    const { client, calls } = makeClient(null);
    const db = makeDb(client);

    await seedAgents(db as never, [chiefAgent]);

    expect(db.transaction).toHaveBeenCalledOnce();
    expect(calls).toHaveLength(2);
    expect(calls[0]?.sql).toContain('INSERT INTO agents');
    expect(calls[1]?.sql).toContain('INSERT INTO agent_versions');
    expect(calls[0]?.params).toContain('chief');
  });

  // `agent_versions` is described as "Riwayat prompt, tools, dan policy" — a history. A history row
  // must be immutable: `DO UPDATE` rewrote the stored prompt/policy for a version that had already
  // shipped, so an audit saying "run X used chief v3" could no longer resolve to what v3 actually
  // ran with. The `agents` row is the mutable current pointer; this table is the record.
  it('never rewrites a stored version row', async () => {
    const { client, calls } = makeClient(storedVersionRow(chiefAgent));

    await seedAgents(makeDb(client) as never, [chiefAgent]);

    const versionWrites = calls.filter(c => c.sql.includes('INSERT INTO agent_versions'));
    expect(versionWrites).toHaveLength(1);
    expect(versionWrites[0]?.sql).toContain('ON CONFLICT (agent_id, version) DO NOTHING');
    expect(versionWrites[0]?.sql).not.toContain('DO UPDATE');
  });

  it('warns when the on-disk definition no longer matches its stored version', async () => {
    // The realistic cause: the prompt was edited but `version` was not bumped. With the history
    // protected, the only way that change can reach the database is a new version — so say so.
    const warnSpy = vi.spyOn(rootLogger, 'warn').mockImplementation(() => undefined);
    const { client } = makeClient(storedVersionRow(chiefAgent, { system_prompt: 'You are Chief. (old)' }));

    try {
      await seedAgents(makeDb(client) as never, [chiefAgent]);

      expect(warnSpy).toHaveBeenCalledTimes(1);
      const [message, context] = warnSpy.mock.calls[0] as [string, Record<string, unknown>];
      expect(message).toMatch(/version/i);
      expect(context).toMatchObject({ agentId: 'chief', version: 1 });
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('stays quiet when the stored version matches, ignoring key order and undefined', async () => {
    const warnSpy = vi.spyOn(rootLogger, 'warn').mockImplementation(() => undefined);
    const { client } = makeClient(
      storedVersionRow(chiefAgent, {
        // Reordered keys and a dropped `undefined`, exactly as JSONB round-trips them.
        model_policy: { temperature: 0.2, fallbackTier: 'fast', preferredTier: 'balanced' },
        limits: { maxTurns: 1, maxDelegationDepth: 2, timeoutSeconds: 10, maxCostUsd: 1, note: undefined }
      })
    );

    try {
      await seedAgents(makeDb(client) as never, [chiefAgent]);

      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });
});
