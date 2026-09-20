import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ToolRegistry } from '../src/registry.js';
import { ToolDefinition } from '../src/types.js';

/**
 * A manifest is the declaration the policy engine trusts, so it must be validated like any other
 * input.
 *
 * `register()` checked only that a manifest existed and that its `name` matched. Every field the
 * gateways actually act on — `riskLevel`, `approval`, `idempotency` — and every field a future
 * consumer would act on (`sideEffects`, `capability`, `requiredConnectionScopes`) was taken on
 * trust. A typo (`riskLevel: 'critcal'`) or an invented side effect (`'external_write'` instead of
 * `'write_external'`) sailed through, and the policy engine then evaluated against a value that
 * meant nothing.
 */
const validManifest = {
  name: 'test.manifest_probe',
  version: 1,
  capability: 'integration',
  description: 'A tool used to probe manifest validation',
  sideEffects: ['none'],
  riskLevel: 'read',
  idempotency: 'none',
  requiredConnectionScopes: [],
  scopes: [],
  isIdempotentByDefault: false,
  approval: 'auto',
  timeoutMs: 1000
};

function makeTool(manifest?: Record<string, unknown>): ToolDefinition {
  return {
    name: 'test.manifest_probe',
    description: 'A tool used to probe manifest validation',
    inputSchema: z.object({}),
    outputSchema: z.object({ ok: z.boolean() }),
    riskLevel: 'read',
    requiresApproval: false,
    execute: vi.fn(async () => ({ ok: true })),
    ...(manifest ? { manifest } : {})
  } as unknown as ToolDefinition;
}

describe('ToolRegistry manifest validation', () => {
  it('accepts a well-formed manifest', () => {
    const registry = new ToolRegistry();

    expect(() => registry.register(makeTool(validManifest))).not.toThrow();
    expect(registry.get('test.manifest_probe')).toBeDefined();
  });

  it('rejects a manifest whose riskLevel is not a known level', () => {
    const registry = new ToolRegistry();

    expect(() => registry.register(makeTool({ ...validManifest, riskLevel: 'critcal' }))).toThrow(/manifest/i);
    expect(registry.get('test.manifest_probe')).toBeUndefined();
  });

  it('rejects a manifest with an invented side effect', () => {
    const registry = new ToolRegistry();

    expect(() => registry.register(makeTool({ ...validManifest, sideEffects: ['external_write'] }))).toThrow(/manifest/i);
    expect(registry.get('test.manifest_probe')).toBeUndefined();
  });

  it('rejects a manifest with an unknown capability or approval mode', () => {
    const registry = new ToolRegistry();

    expect(() => registry.register(makeTool({ ...validManifest, capability: 'sorcery' }))).toThrow(/manifest/i);
    expect(() => registry.register(makeTool({ ...validManifest, approval: 'maybe' }))).toThrow(/manifest/i);
  });

  it('rejects a manifest missing a required field', () => {
    const registry = new ToolRegistry();
    const { riskLevel: _omitted, ...withoutRiskLevel } = validManifest;

    expect(() => registry.register(makeTool(withoutRiskLevel))).toThrow(/manifest/i);
  });

  // A legacy tool never declared its side effects, so the registry must not invent a claim. `['none']`
  // asserted "this tool has no side effects" about tools that make network requests, which is the
  // least conservative statement available. `'unknown'` is the honest value, and it is the value a
  // future consumer must fail closed on.
  it('marks undeclared side effects as unknown instead of claiming none', () => {
    const registry = new ToolRegistry();

    registry.registerLegacy(makeTool());

    const registered = registry.get('test.manifest_probe');
    expect(registered?.manifest?.sideEffects).toEqual(['unknown']);
  });

  it('keeps the declared side effects when a legacy tool does carry a manifest', () => {
    const registry = new ToolRegistry();

    registry.registerLegacy(makeTool({ ...validManifest, sideEffects: ['network'] }));

    expect(registry.get('test.manifest_probe')?.manifest?.sideEffects).toEqual(['network']);
  });
});
