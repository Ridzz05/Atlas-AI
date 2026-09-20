import { randomUUID } from 'node:crypto';
import { ToolDefinition, ToolContext, ToolExecutionResponse } from './types.js';
import { ApprovalMatrix, TokenVerifier } from '@atlas/policy';
import { rootLogger, AuditService } from '@atlas/observability';

/**
 * Minimal local EventBus contract.
 *
 * The `@atlas/events` package provides the production implementation, but to
 * avoid circular package dependencies between `@atlas/tools` and
 * `@atlas/events`, the registry only relies on this structural type. Any
 * compatible publish surface can be injected via the constructor.
 */
type EventBus = {
  publish(event: {
    id: string;
    type: string;
    taskId?: string;
    runId?: string;
    agentId?: string;
    payload?: Record<string, unknown>;
    timestamp: string;
  }): Promise<void>;
};

export interface ToolRegistryOptions {
  eventBus?: EventBus;
  idempotencyStore?: import('./types.js').IdempotencyStore;
}

function extractRemoteId(output: unknown): string | undefined {
  if (!output || typeof output !== 'object') return undefined;
  const record = output as Record<string, unknown>;
  for (const key of ['messageId', 'remoteId', 'id']) {
    const value = record[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();
  private consumedApprovalTokens = new Set<string>();
  private readonly eventBus?: EventBus;
  private readonly idempotencyStore?: import('./types.js').IdempotencyStore;
  private readonly loggedRegistration = new Set<string>();

  constructor(opts?: ToolRegistryOptions) {
    this.eventBus = opts?.eventBus;
    this.idempotencyStore = opts?.idempotencyStore;
  }

  /**
   * Register a tool. The tool MUST carry a `manifest` describing its
   * capability, side effects, risk level, approval mode, idempotency
   * requirement, and scopes. This is the contract that powers the
   * fail-closed policy engine.
   */
  public register(tool: ToolDefinition): void {
    if (!tool.manifest) {
      throw new Error('Tool must carry a ToolManifest');
    }
    if (tool.name !== tool.manifest.name) {
      throw new Error(`Tool manifest name '${tool.manifest.name}' does not match tool name '${tool.name}'`);
    }
    if (!this.loggedRegistration.has(tool.name)) {
      rootLogger.info(`Tool registered: ${tool.name}`, {
        capability: tool.manifest.capability,
        riskLevel: tool.manifest.riskLevel,
        approval: tool.manifest.approval,
        idempotency: tool.manifest.idempotency
      });
      this.loggedRegistration.add(tool.name);
    }
    this.tools.set(tool.name, tool);
    ApprovalMatrix.registerKnownAction(tool.name);
  }

  /**
   * Register a legacy tool that does not carry a manifest. The registry
   * synthesises a conservative default manifest so the policy engine can
   * still evaluate it. The default defaults `approval: 'human'` so the
   * tool cannot silently execute without operator consent. This is a
   * transitional escape hatch; new tools must use `register()`.
   */
  public registerLegacy(tool: ToolDefinition): void {
    const existing = tool as ToolDefinition & { manifest?: any };
    if (existing.manifest) {
      this.register(tool);
      return;
    }
    const synthetic: ToolDefinition = {
      ...tool,
      manifest: {
        name: tool.name,
        version: 1,
        capability: 'integration',
        description: tool.description,
        sideEffects: ['none'],
        riskLevel: tool.riskLevel,
        idempotency: 'none',
        requiredConnectionScopes: [],
        scopes: [],
        isIdempotentByDefault: false,
        approval: tool.requiresApproval ? 'human' : 'auto',
        timeoutMs: tool.timeoutMs
      }
    };
    this.register(synthetic);
  }

  public get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  public list(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  private async publishEvent(type: string, context: ToolContext, payload: Record<string, unknown>): Promise<void> {
    if (!this.eventBus) return;
    const event = {
      id: randomUUID(),
      type,
      taskId: context.taskId,
      runId: context.runId,
      agentId: context.agentId,
      payload,
      timestamp: new Date().toISOString()
    };
    try {
      await this.eventBus.publish(event);
    } catch (err) {
      rootLogger.error(`Failed to publish '${type}' event`, { error: String((err as Error)?.message || err) });
    }
  }

  public async execute(name: string, input: unknown, context: ToolContext): Promise<ToolExecutionResponse> {
    const startTime = Date.now();
    const tool = this.tools.get(name);

    if (!tool) {
      return {
        success: false,
        error: `Tool '${name}' not found in Tool Gateway registry.`,
        durationMs: 0,
        riskLevel: 'read'
      };
    }

    // Fail closed. `allowedTools` is required on ToolContext, so this also catches a caller
    // that built a context outside the type system: an absent allowlist denies the tool
    // rather than permitting everything.
    if (!Array.isArray(context.allowedTools) || !context.allowedTools.includes(name)) {
      return {
        success: false,
        error: `Tool '${name}' is not permitted for agent '${context.agentId}'.`,
        durationMs: 0,
        riskLevel: tool.riskLevel
      };
    }

    const policy = ApprovalMatrix.evaluate(name, {
      externalWritesEnabled: context.externalWritesEnabled
    });

    if (policy.blocked) {
      rootLogger.warn(`Blocked tool execution: ${name}`, { reason: policy.reason });
      return {
        success: false,
        error: policy.reason || `Execution of tool '${name}' is strictly blocked by policy.`,
        durationMs: Date.now() - startTime,
        riskLevel: policy.riskLevel
      };
    }

    const parseResult = tool.inputSchema.safeParse(input);
    if (!parseResult.success) {
      return {
        success: false,
        error: `Invalid input for tool '${name}': ${JSON.stringify(parseResult.error.errors)}`,
        durationMs: Date.now() - startTime,
        riskLevel: tool.riskLevel
      };
    }

    // A tool manifest may ESCALATE the policy decision (demand human approval) but may
    // never lower it. Previously `approval: 'auto'` forced requiresApproval to false,
    // which let a tool author opt out of the ApprovalMatrix requirement for their own
    // action — including permanently-approval-required actions such as
    // memory.delete_canonical. registerLegacy assigns 'auto' by default, so any new tool
    // that forgot requiresApproval:true would have executed without approval.
    const manifestApproval = tool.manifest?.approval;
    const effectivePolicy = {
      requiresApproval: policy.requiresApproval || manifestApproval === 'human'
    };

    let durableApprovalId: string | undefined;
    if (effectivePolicy.requiresApproval) {
      const token = context.approvalToken;
      if (!token || !context.approvalSecretKey) {
        if (context.approvalRequestStore) {
          const payload = parseResult.data as Record<string, unknown>;
          const target =
            typeof payload.recipient === 'string' ? payload.recipient : typeof payload.target === 'string' ? payload.target : name;
          const approval = await context.approvalRequestStore.requestApproval({
            taskId: context.taskId,
            runId: context.runId,
            agentId: context.agentId,
            action: name,
            target,
            payload,
            reason: policy.reason || `Action '${name}' requires human approval.`,
            riskLevel: policy.riskLevel,
            expiresAt: new Date(Date.now() + 60 * 60 * 1000)
          });
          return {
            success: false,
            error: `Action '${name}' requires human approval before execution.`,
            approvalId: approval?.id,
            approvalPending: true,
            durationMs: Date.now() - startTime,
            riskLevel: policy.riskLevel
          };
        }

        rootLogger.warn(`Tool '${name}' requires an approval token and verification key`);
        return {
          success: false,
          error: `Action '${name}' requires a valid human approval token before execution.`,
          durationMs: Date.now() - startTime,
          riskLevel: policy.riskLevel
        };
      }

      if (token.action !== name) {
        return {
          success: false,
          error: `Approval token action does not match '${name}'.`,
          durationMs: Date.now() - startTime,
          riskLevel: policy.riskLevel
        };
      }

      const verification = TokenVerifier.verifyToken(token, parseResult.data, context.approvalSecretKey);
      if (!verification.valid) {
        return {
          success: false,
          error: verification.reason || 'Approval token verification failed.',
          durationMs: Date.now() - startTime,
          riskLevel: policy.riskLevel
        };
      }

      if (context.approvalExecutionStore) {
        const claim = await context.approvalExecutionStore.claimExecution(token, parseResult.data);
        if (!claim) {
          return {
            success: false,
            error: 'Approval token has already been claimed or is no longer executable.',
            durationMs: Date.now() - startTime,
            riskLevel: policy.riskLevel
          };
        }
        durableApprovalId = claim.id;
      } else {
        if (this.consumedApprovalTokens.has(token.signature)) {
          return {
            success: false,
            error: 'Approval token has already been consumed.',
            durationMs: Date.now() - startTime,
            riskLevel: policy.riskLevel
          };
        }
        this.consumedApprovalTokens.add(token.signature);
      }
    }

    // tool.requested: policy has passed, before any side effect.
    await this.publishEvent('tool.requested', context, {
      toolName: name,
      riskLevel: tool.riskLevel,
      capability: tool.manifest?.capability
    });

    // Idempotency claim (P0 idempotency / side-effect safety)
    const idempotencyKey = context.idempotencyKey;
    const store = context.idempotencyStore ?? this.idempotencyStore;
    let idempotencyClaimed = false;
    if (tool.manifest?.idempotency && tool.manifest.idempotency !== 'none' && store && idempotencyKey) {
      try {
        const claim = await store.claim({
          key: idempotencyKey.key,
          taskId: idempotencyKey.taskId,
          runId: idempotencyKey.runId,
          actionName: idempotencyKey.actionName,
          payloadHash: idempotencyKey.payloadHash
        });
        if (claim.existing && claim.record) {
          const record = claim.record as {
            outcome?: 'in_flight' | 'succeeded' | 'failed' | 'expired';
            result?: unknown;
            error?: string;
          };
          if (record.outcome === 'succeeded') {
            await this.publishEvent('tool.completed', context, {
              toolName: name,
              riskLevel: tool.riskLevel,
              durationMs: 0,
              output: record.result,
              idempotentReplay: true
            });
            return {
              success: true,
              output: record.result,
              durationMs: 0,
              riskLevel: tool.riskLevel,
              idempotentReplay: true
            };
          }
          if (record.outcome === 'in_flight') {
            return {
              success: false,
              error: 'Idempotent action is still in flight.',
              durationMs: 0,
              riskLevel: tool.riskLevel
            };
          }
          if (record.outcome === 'failed') {
            return {
              success: false,
              error: record.error || 'Previous attempt failed',
              durationMs: 0,
              riskLevel: tool.riskLevel
            };
          }
          // 'expired' or any other outcome: release and proceed.
          await store.release(idempotencyKey.key);
        }
        idempotencyClaimed = true;
      } catch (err) {
        rootLogger.error('Idempotency claim failed', { error: String((err as Error)?.message || err) });
      }
    }

    const executionController = new AbortController();
    const forwardAbort = () => executionController.abort(context.signal?.reason);
    if (context.signal) {
      if (context.signal.aborted) {
        forwardAbort();
      } else {
        context.signal.addEventListener('abort', forwardAbort, { once: true });
      }
    }
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        const timeoutError = new Error(`Tool '${name}' timed out after ${tool.timeoutMs}ms`);
        reject(timeoutError);
        executionController.abort(timeoutError.message);
      }, tool.timeoutMs);
    });

    try {
      await this.publishEvent('tool.started', context, {
        toolName: name,
        riskLevel: tool.riskLevel
      });

      const rawOutput = await Promise.race([
        tool.execute({ ...context, signal: executionController.signal }, parseResult.data),
        timeoutPromise
      ]);
      if (executionController.signal.aborted) {
        throw new Error(String(executionController.signal.reason || 'Tool execution aborted'));
      }
      const outputValidation = tool.outputSchema.safeParse(rawOutput);
      if (!outputValidation.success) {
        throw new Error(`Invalid output from tool '${name}': ${JSON.stringify(outputValidation.error.errors)}`);
      }
      const output = outputValidation.data;

      if (durableApprovalId && context.approvalExecutionStore) {
        const finalized = await context.approvalExecutionStore.finalizeExecution(durableApprovalId, {
          success: true,
          output
        });
        if (!finalized) {
          throw new Error('Approval execution completed but durable finalization failed.');
        }
      }

      if (idempotencyClaimed && store && idempotencyKey) {
        try {
          await store.recordSuccess(idempotencyKey.key, {
            provider: tool.manifest?.name ?? tool.name,
            remoteId: extractRemoteId(output),
            result: output && typeof output === 'object' ? (output as Record<string, unknown>) : undefined
          });
        } catch (err) {
          rootLogger.error('Failed to record idempotency success', { error: String((err as Error)?.message || err) });
        }
      }

      const durationMs = Date.now() - startTime;

      const auditRecord = AuditService.format({
        actor: context.agentId,
        action: `tool.${name}`,
        taskId: context.taskId,
        runId: context.runId,
        details: { durationMs, riskLevel: tool.riskLevel }
      });
      if (context.auditSink) {
        await context.auditSink.record(auditRecord);
      }

      await this.publishEvent('tool.completed', context, {
        toolName: name,
        riskLevel: tool.riskLevel,
        durationMs,
        output
      });

      return {
        success: true,
        output,
        durationMs,
        riskLevel: tool.riskLevel
      };
    } catch (err: any) {
      const durationMs = Date.now() - startTime;
      if (durableApprovalId && context.approvalExecutionStore) {
        try {
          await context.approvalExecutionStore.finalizeExecution(durableApprovalId, {
            success: false,
            error: String(err?.message || 'Tool execution failed')
          });
        } catch (finalizationError) {
          rootLogger.error('Failed to finalize durable approval execution', { error: String(finalizationError) });
        }
      }
      if (idempotencyClaimed && store && idempotencyKey) {
        try {
          await store.recordFailure(idempotencyKey.key, String(err?.message || 'Tool execution failed'));
        } catch (recErr) {
          rootLogger.error('Failed to record idempotency failure', { error: String((recErr as Error)?.message || recErr) });
        }
      }
      rootLogger.error(`Error executing tool '${name}'`, { error: String(err?.message || err) });
      await this.publishEvent('tool.failed', context, {
        toolName: name,
        riskLevel: tool.riskLevel,
        durationMs,
        error: String(err?.message || 'Tool execution failed')
      });
      return {
        success: false,
        error: String(err?.message || 'Tool execution failed'),
        durationMs,
        riskLevel: tool.riskLevel
      };
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      context.signal?.removeEventListener('abort', forwardAbort);
    }
  }
}
