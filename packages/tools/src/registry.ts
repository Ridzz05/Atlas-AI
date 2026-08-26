import { ToolDefinition, ToolContext, ToolExecutionResponse } from './types.js';
import { ApprovalMatrix, TokenVerifier } from '@atlas/policy';
import { rootLogger, AuditService } from '@atlas/observability';

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();
  private consumedApprovalTokens = new Set<string>();

  public register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  public get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  public list(): ToolDefinition[] {
    return Array.from(this.tools.values());
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

    if (context.allowedTools && !context.allowedTools.includes(name)) {
      return {
        success: false,
        error: `Tool '${name}' is not permitted for agent '${context.agentId}'.`,
        durationMs: 0,
        riskLevel: tool.riskLevel
      };
    }

    // 1. Policy evaluation check
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

    // 2. Validate input schema
    const parseResult = tool.inputSchema.safeParse(input);
    if (!parseResult.success) {
      return {
        success: false,
        error: `Invalid input for tool '${name}': ${JSON.stringify(parseResult.error.errors)}`,
        durationMs: Date.now() - startTime,
        riskLevel: tool.riskLevel
      };
    }

    // 3. Verify approval against the exact validated payload before execution.
    let durableApprovalId: string | undefined;
    if (policy.requiresApproval) {
      const token = context.approvalToken;
      if (!token || !context.approvalSecretKey) {
        if (context.approvalRequestStore) {
          const payload = parseResult.data as Record<string, unknown>;
          const target = typeof payload.recipient === 'string'
            ? payload.recipient
            : typeof payload.target === 'string' ? payload.target : name;
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

        // Consume before awaiting the external side effect to prevent concurrent replay.
        this.consumedApprovalTokens.add(token.signature);
      }
    }

    // 4. Execute with timeout
    try {
      const rawOutput = await Promise.race([
        tool.execute(context, parseResult.data),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Tool '${name}' timed out after ${tool.timeoutMs}ms`)), tool.timeoutMs)
        )
      ]);
      const outputValidation = tool.outputSchema.safeParse(rawOutput);
      if (!outputValidation.success) {
        throw new Error(
          `Invalid output from tool '${name}': ${JSON.stringify(outputValidation.error.errors)}`
        );
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

      const durationMs = Date.now() - startTime;

      // 4. Audit execution
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
      rootLogger.error(`Error executing tool '${name}'`, { error: String(err?.message || err) });
      return {
        success: false,
        error: String(err?.message || 'Tool execution failed'),
        durationMs,
        riskLevel: tool.riskLevel
      };
    }
  }
}
