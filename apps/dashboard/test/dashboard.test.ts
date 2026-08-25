import { describe, it, expect } from 'vitest';
import { defaultAgentRegistry } from '@atlas/agents';

describe('@atlas/dashboard Integration Tests', () => {
  it('loads the core agent roster with all 5 specialist definitions', () => {
    const agents = defaultAgentRegistry.list();
    expect(agents.length).toBe(5);

    const ids = agents.map(a => a.id);
    expect(ids).toContain('chief');
    expect(ids).toContain('ned');
    expect(ids).toContain('layla');
    expect(ids).toContain('hermes');
    expect(ids).toContain('argus');
  });

  it('validates agent limits and security configurations', () => {
    const chief = defaultAgentRegistry.getOrThrow('chief');
    expect(chief.limits.maxDelegationDepth).toBe(2);
    expect(chief.limits.maxTurns).toBe(15);

    const argus = defaultAgentRegistry.getOrThrow('argus');
    expect(argus.role).toBe('qa_verifier');
  });
});
