import { AgentDefinition } from '@atlas/shared';
import { DatabaseClient } from './client.js';

export async function seedAgents(db: DatabaseClient, agents: AgentDefinition[]): Promise<void> {
  await db.transaction(async client => {
    for (const agent of agents) {
      const modelPolicy = JSON.stringify(agent.modelPolicy);
      const limits = JSON.stringify(agent.limits);
      const permissions = JSON.stringify(agent.permissions);
      const review = JSON.stringify(agent.review);

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

      await client.query(
        `INSERT INTO agent_versions (
          agent_id, version, system_prompt, model_policy, limits, permissions
        ) VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (agent_id, version) DO UPDATE SET
          system_prompt = EXCLUDED.system_prompt,
          model_policy = EXCLUDED.model_policy,
          limits = EXCLUDED.limits,
          permissions = EXCLUDED.permissions`,
        [agent.id, agent.version, agent.systemPrompt, modelPolicy, limits, permissions]
      );
    }
  });
}
