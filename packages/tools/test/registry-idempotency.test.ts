import { describe, expect, it, vi } from 'vitest';
import { ToolRegistry } from '../src/registry.js';
import { ToolContext, ToolDefinition } from '../src/types.js';

/**
 * A manifest that declares `idempotency: 'required'` must not be satisfiable by accident.
 *
 * The claim block ran only when `store && idempotencyKey` were both present, so a missing store or
 * key skipped the claim and executed anyway. No production caller supplies either — the worker
 * builds `new ToolRegistry()` with no options and the tool gateway sets no idempotencyStore or key —
 * so the exactly-once control that `communication.send_approved` declares was a no-op, and a
 * retried run would re-execute the same send the moment an outbound connector is wired.
 */
const toolWithRequiredIdempotency: ToolDefinition = {
  name: 'artifacts.write',
  description: 'A tool that demands exactly-once execution',
  inputSchema: { safeParse: (value: unknown) => ({ success: true, data: value }) } as any,
  outputSchema: { safeParse: (value: unknown) => ({ success: true, data: value }) } as any,
  riskLevel: 'high',
  requiresApproval: false,
  manifest: {
    name: 'artifacts.write',
    version: 1,
    capability: 'integration',
    description: 'A tool that demands exactly-once execution',
    riskLevel: 'high',
    approval: 'auto',
    sideEffects: ['external_write'],
    requiredConnectionScopes: [],
    idempotency: 'required',
    isIdempotentByDefault: false
  } as any,
  execute: vi.fn(async () => ({ ok: true }))
};

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    agentId: 'hermes',
    taskId: '123e4567-e89b-12d3-a456-426614174000',
    runId: '123e4567-e89b-12d3-a456-426614174001',
    allowedTools: ['artifacts.write'],
    grantedScopes: [],
    ...overrides
  } as ToolContext;
}

// `artifacts.write` is auto-approved by the ApprovalMatrix, so the approval gate does not fire
// first and these tests isolate the idempotency control. The manifest is synthetic on purpose: the
// point is the registry's enforcement, not any one real tool's declaration.
describe('ToolRegistry idempotency enforcement', () => {
  it('refuses to execute a required-idempotency tool when no store is configured', async () => {
    const registry = new ToolRegistry();
    registry.register(toolWithRequiredIdempotency);

    const result = await registry.execute('artifacts.write', {}, makeContext());

    expect(result.success).toBe(false);
    expect(String(result.error)).toMatch(/idempotency/i);
    expect(toolWithRequiredIdempotency.execute).not.toHaveBeenCalled();
  });

  it('derives a stable key when the store is present but the caller supplied none', async () => {
    // The registry owns the requirement, so it derives the key from (task, run, action, payload) —
    // the same logical action must land on the same key across retries.
    const seen: string[] = [];
    const store = {
      claim: vi.fn(async (input: { key: string }) => {
        seen.push(input.key);
        return { existing: false };
      })
    };
    const registry = new ToolRegistry({ idempotencyStore: store as any });
    registry.register(toolWithRequiredIdempotency);

    const first = await registry.execute('artifacts.write', { body: 'x' }, makeContext());
    const second = await registry.execute('artifacts.write', { body: 'x' }, makeContext());

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(seen[1]);
    expect(seen[0]).toContain('artifacts.write');
  });

  it('derives a different key for a different payload', async () => {
    const seen: string[] = [];
    const store = {
      claim: vi.fn(async (input: { key: string }) => {
        seen.push(input.key);
        return { existing: false };
      })
    };
    const registry = new ToolRegistry({ idempotencyStore: store as any });
    registry.register(toolWithRequiredIdempotency);

    await registry.execute('artifacts.write', { body: 'x' }, makeContext());
    await registry.execute('artifacts.write', { body: 'y' }, makeContext());

    expect(seen[0]).not.toBe(seen[1]);
  });

  it('executes when both the store and the key are present', async () => {
    const registry = new ToolRegistry({
      idempotencyStore: { claim: vi.fn(async () => ({ existing: false })) } as any
    });
    registry.register(toolWithRequiredIdempotency);

    const result = await registry.execute(
      'artifacts.write',
      {},
      makeContext({
        idempotencyKey: {
          key: 'k1',
          taskId: '123e4567-e89b-12d3-a456-426614174000',
          actionName: 'artifacts.write',
          payloadHash: 'h'
        }
      } as any)
    );

    expect(result.success).toBe(true);
    expect(toolWithRequiredIdempotency.execute).toHaveBeenCalled();
  });
});
