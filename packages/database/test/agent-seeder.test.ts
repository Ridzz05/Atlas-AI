import { describe, expect, it, vi } from 'vitest';
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

describe('@atlas/database agent seeding', () => {
  it('seeds the current agent definition and its version in one transaction', async () => {
    const client = {
      query: vi.fn().mockResolvedValue({ rows: [] })
    };
    const db = {
      transaction: vi.fn(async (callback: (tx: typeof client) => Promise<void>) => callback(client))
    };

    await seedAgents(db as never, [chiefAgent]);

    expect(db.transaction).toHaveBeenCalledOnce();
    expect(client.query).toHaveBeenCalledTimes(2);
    expect(client.query.mock.calls[0]?.[0]).toContain('INSERT INTO agents');
    expect(client.query.mock.calls[1]?.[0]).toContain('INSERT INTO agent_versions');
    expect(client.query.mock.calls[0]?.[1]).toContain('chief');
  });
});
