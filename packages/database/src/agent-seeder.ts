import { isDeepStrictEqual } from 'node:util';
import { AgentDefinition } from '@atlas/shared';
import { rootLogger } from '@atlas/observability';
import { DatabaseClient } from './client.js';

/**
 * Compare a stored JSONB value with the definition on disk.
 *
 * Both sides go through a JSON round-trip first: that is what JSONB storage does to a value, and it
 * removes the two differences that are not real changes — key order and `undefined` properties —
 * so the warning below only fires on an actual edit.
 */
function normalize(value: unknown): unknown {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function definitionDrifted(stored: Record<string, unknown>, agent: AgentDefinition): boolean {
  return (
    stored.system_prompt !== agent.systemPrompt ||
    !isDeepStrictEqual(normalize(stored.model_policy), normalize(agent.modelPolicy)) ||
    !isDeepStrictEqual(normalize(stored.limits), normalize(agent.limits)) ||
    !isDeepStrictEqual(normalize(stored.permissions), normalize(agent.permissions))
  );
}

export async function seedAgents(db: DatabaseClient, agents: AgentDefinition[]): Promise<void> {
  await db.transaction(async client => {
    for (const agent of agents) {
      const modelPolicy = JSON.stringify(agent.modelPolicy);
      const limits = JSON.stringify(agent.limits);
      const permissions = JSON.stringify(agent.permissions);
      const review = JSON.stringify(agent.review);

      // `agents` is the mutable current pointer, so it tracks the code on every boot.
      await client.query(
        `INSERT INTO agents (
          id, name, role, version, description, system_prompt,
          model_policy, limits, permissions, review_policy, is_active
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, TRUE)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          role = EXCLUDED.role,
          version = EXCLUDED.version,
          description = EXCLUDED.description,
          system_prompt = EXCLUDED.system_prompt,
          model_policy = EXCLUDED.model_policy,
          limits = EXCLUDED.limits,
          permissions = EXCLUDED.permissions,
          review_policy = EXCLUDED.review_policy,
          is_active = TRUE,
          updated_at = NOW()`,
        [agent.id, agent.name, agent.role, agent.version, agent.description, agent.systemPrompt, modelPolicy, limits, permissions, review]
      );

      // `agent_versions` is a history — "Riwayat prompt, tools, dan policy". A history row is
      // immutable, so this is DO NOTHING, never DO UPDATE: rewriting it destroyed the record of what
      // an already-shipped version actually ran with, and an audit saying "run X used chief v3"
      // could no longer resolve to v3's real prompt.
      const versionResult = await client.query(
        `INSERT INTO agent_versions (
          agent_id, version, system_prompt, model_policy, limits, permissions
        ) VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (agent_id, version) DO NOTHING
        RETURNING id`,
        [agent.id, agent.version, agent.systemPrompt, modelPolicy, limits, permissions]
      );

      if (versionResult.rows.length > 0) {
        continue;
      }

      // The version row already existed. If the definition on disk has moved on, the edit was made
      // without bumping `version` — with the history protected, that change can never reach the
      // database, so the only correct move is to say so rather than to silently overwrite the past.
      const stored = await client.query(
        `SELECT system_prompt, model_policy, limits, permissions
         FROM agent_versions
         WHERE agent_id = $1 AND version = $2`,
        [agent.id, agent.version]
      );
      const existing = stored.rows[0] as Record<string, unknown> | undefined;
      if (existing && definitionDrifted(existing, agent)) {
        rootLogger.warn('Agent definition differs from its stored version history; bump the version', {
          agentId: agent.id,
          version: agent.version
        });
      }
    }
  });
}
