import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import { defaultAgentRegistry, CHIEF_AGENT, NED_AGENT, LAYLA_AGENT, HERMES_AGENT, ARGUS_AGENT } from '../src/index.js';

describe('@atlas/agents Registry & Definitions', () => {
  it('registers exactly one agent per definition file', () => {
    // scripts/ci-compose-smoke.sh derives its expected seeded-agent count from the number
    // of files in src/definitions. This test pins that derivation to the real registry so
    // the smoke assertion cannot silently drift away from the fleet again.
    const definitionsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/definitions');
    const definitionFiles = readdirSync(definitionsDir).filter(name => name.endsWith('.ts'));

    expect(defaultAgentRegistry.list().length).toBe(definitionFiles.length);
  });

  it('loads all core MVP and specialist agents by default', () => {
    const agents = defaultAgentRegistry.list();
    expect(agents.length).toBe(9);

    const ids = agents.map(a => a.id);
    expect(ids).toContain('ceo');
    expect(ids).toContain('cfo');
    expect(ids).toContain('cto');
    expect(ids).toContain('chief');
    expect(ids).toContain('ned');
    expect(ids).toContain('luna');
    expect(ids).toContain('layla');
    expect(ids).toContain('hermes');
    expect(ids).toContain('argus');
  });

  it('verifies C-Suite executive roles', () => {
    const ceo = defaultAgentRegistry.getOrThrow('ceo');
    expect(ceo.role).toBe('ceo');
    expect(ceo.permissions.externalWrites).toBe(false);

    const cfo = defaultAgentRegistry.getOrThrow('cfo');
    expect(cfo.role).toBe('cfo');
    expect(cfo.review.humanApprovalFor).toContain('budget.override_daily_cap');

    const cto = defaultAgentRegistry.getOrThrow('cto');
    expect(cto.role).toBe('cto');
    expect(cto.permissions.dataScopes).toContain('architecture');
  });

  it('verifies Chief orchestrator constraints', () => {
    const chief = defaultAgentRegistry.getOrThrow('chief');
    expect(chief.role).toBe('orchestrator');
    expect(chief.limits.maxDelegationDepth).toBe(2);
    expect(chief.permissions.externalWrites).toBe(false);
  });

  it('verifies Ned research permissions', () => {
    const ned = defaultAgentRegistry.getOrThrow('ned');
    expect(ned.role).toBe('researcher');
    expect(ned.permissions.tools).toContain('web.search');
    expect(ned.permissions.tools).toContain('web.fetch_safe');
  });

  it('verifies Layla has deterministic scoring and enrichment tools', () => {
    const layla = defaultAgentRegistry.getOrThrow('layla');
    expect(layla.permissions.tools).toContain('lead.enrich');
    expect(layla.permissions.tools).toContain('lead.score');
  });

  it('verifies Hermes content constraints', () => {
    const hermes = defaultAgentRegistry.getOrThrow('hermes');
    expect(hermes.role).toBe('content_creator');
    expect(hermes.permissions.tools).toContain('communication.create_draft');
    expect(hermes.permissions.tools).not.toContain('communication.send_approved');
  });

  it('verifies Argus QA verifier permissions', () => {
    const argus = defaultAgentRegistry.getOrThrow('argus');
    expect(argus.role).toBe('qa_verifier');
    expect(argus.permissions.tools).toContain('policy.verify');
  });
});
