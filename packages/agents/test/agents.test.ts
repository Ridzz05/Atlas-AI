import { describe, it, expect } from 'vitest';
import { defaultAgentRegistry, CHIEF_AGENT, NED_AGENT, LAYLA_AGENT, HERMES_AGENT, ARGUS_AGENT } from '../src/index.js';

describe('@atlas/agents Registry & Definitions', () => {
  it('loads all 5 core MVP agents by default', () => {
    const agents = defaultAgentRegistry.list();
    expect(agents.length).toBe(5);

    const ids = agents.map(a => a.id);
    expect(ids).toContain('chief');
    expect(ids).toContain('ned');
    expect(ids).toContain('layla');
    expect(ids).toContain('hermes');
    expect(ids).toContain('argus');
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
