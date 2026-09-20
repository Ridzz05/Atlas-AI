import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { rootLogger } from '@atlas/observability';
import { ToolRegistry } from '../src/registry.js';
import { ToolContext, ToolDefinition } from '../src/types.js';

/**
 * The audit trail must record what was refused, not only what succeeded.
 *
 * `AuditService.format(...)` and `auditSink.record(...)` were called on the success path only. Every
 * denial — allowlist, policy block, invalid input, missing approval — returned early without a
 * record, and the `catch` block logged and published an event but wrote nothing durable. So
 * `audit_logs` answered "what did the system do?" and stayed silent on "who tried to do what, and
 * was refused?", which for a governance layer is the more important question.
 */
const probeTool: ToolDefinition = {
  name: 'artifacts.write',
  description: 'A tool used to probe auditing',
  inputSchema: z.object({ body: z.string().optional() }),
  outputSchema: z.object({ ok: z.boolean() }),
  riskLevel: 'medium',
  requiresApproval: false,
  manifest: {
    name: 'artifacts.write',
    version: 1,
    capability: 'artifacts',
    description: 'A tool used to probe auditing',
    sideEffects: ['filesystem_write'],
    riskLevel: 'medium',
    idempotency: 'none',
    requiredConnectionScopes: [],
    scopes: [],
    isIdempotentByDefault: false,
    approval: 'auto',
    timeoutMs: 1000
  },
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

function makeRegistry(tool: ToolDefinition = probeTool) {
  const auditSink = { record: vi.fn(async () => undefined) };
  const registry = new ToolRegistry();
  registry.register(tool);
  return { registry, auditSink };
}

describe('ToolRegistry audit coverage', () => {
  it('records a successful execution', async () => {
    const { registry, auditSink } = makeRegistry();

    const result = await registry.execute('artifacts.write', { body: 'x' }, makeContext({ auditSink: auditSink as any }));

    expect(result.success).toBe(true);
    expect(auditSink.record).toHaveBeenCalledTimes(1);
    expect(auditSink.record.mock.calls[0]?.[0]).toMatchObject({
      action: 'tool.artifacts.write',
      details: { outcome: 'succeeded' }
    });
  });

  it('records a denial by the agent allowlist', async () => {
    const { registry, auditSink } = makeRegistry();

    const result = await registry.execute('artifacts.write', { body: 'x' }, makeContext({ auditSink: auditSink as any, allowedTools: [] }));

    expect(result.success).toBe(false);
    expect(auditSink.record).toHaveBeenCalledTimes(1);
    expect(auditSink.record.mock.calls[0]?.[0]).toMatchObject({
      action: 'tool.artifacts.write',
      details: { outcome: 'denied' }
    });
  });

  it('records a denial by policy', async () => {
    const blocked: ToolDefinition = { ...probeTool, name: 'shell.execute', manifest: { ...probeTool.manifest!, name: 'shell.execute' } };
    const { registry, auditSink } = makeRegistry(blocked);

    const result = await registry.execute(
      'shell.execute',
      { body: 'x' },
      makeContext({ auditSink: auditSink as any, allowedTools: ['shell.execute'] })
    );

    expect(result.success).toBe(false);
    expect(auditSink.record).toHaveBeenCalledTimes(1);
    expect(auditSink.record.mock.calls[0]?.[0]).toMatchObject({
      action: 'tool.shell.execute',
      details: { outcome: 'denied' }
    });
  });

  it('records invalid input as a denial', async () => {
    const { registry, auditSink } = makeRegistry();

    const result = await registry.execute('artifacts.write', { body: 42 }, makeContext({ auditSink: auditSink as any }));

    expect(result.success).toBe(false);
    expect(auditSink.record).toHaveBeenCalledTimes(1);
    expect(auditSink.record.mock.calls[0]?.[0]).toMatchObject({ details: { outcome: 'denied' } });
  });

  it('records a failed execution', async () => {
    const throwing: ToolDefinition = {
      ...probeTool,
      execute: vi.fn(async () => {
        throw new Error('connector exploded');
      })
    };
    const { registry, auditSink } = makeRegistry(throwing);

    const result = await registry.execute('artifacts.write', { body: 'x' }, makeContext({ auditSink: auditSink as any }));

    expect(result.success).toBe(false);
    expect(auditSink.record).toHaveBeenCalledTimes(1);
    expect(auditSink.record.mock.calls[0]?.[0]).toMatchObject({
      action: 'tool.artifacts.write',
      details: { outcome: 'failed' }
    });
  });

  // The audit write used to sit inside the execution try, so a broken sink turned a completed tool
  // call into `success: false`. The side effect has already happened by then, and the runner records
  // the tool call as failed and lets the model retry — a double send for a non-idempotent action.
  // A missing audit record must be loud, but it must not rewrite what happened.
  it('keeps a completed execution reported as successful when the audit sink fails', async () => {
    const errorSpy = vi.spyOn(rootLogger, 'error').mockImplementation(() => undefined);
    const { registry, auditSink } = makeRegistry();
    auditSink.record.mockRejectedValue(new Error('audit store unavailable'));

    try {
      const result = await registry.execute('artifacts.write', { body: 'x' }, makeContext({ auditSink: auditSink as any }));

      expect(result.success).toBe(true);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringMatching(/audit/i), expect.anything());
    } finally {
      errorSpy.mockRestore();
    }
  });
});
