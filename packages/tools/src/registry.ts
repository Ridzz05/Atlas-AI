import { ToolDefinition, ToolContext, ToolExecutionResponse } from './types.js';
import { ApprovalMatrix } from '@atlas/policy';
import { rootLogger, AuditService } from '@atlas/observability';

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

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

    if (policy.requiresApproval && !context.approvalToken) {
      rootLogger.warn(`Tool '${name}' requires approval token which was not provided`);
      return {
        success: false,
        error: `Action '${name}' requires a valid human approval token before execution.`,
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

    // 3. Execute with timeout
    try {
      const output = await Promise.race([
        tool.execute(context, parseResult.data),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Tool '${name}' timed out after ${tool.timeoutMs}ms`)), tool.timeoutMs)
        )
      ]);

      const durationMs = Date.now() - startTime;

      // 4. Audit execution
      AuditService.format({
        actor: context.agentId,
        action: `tool.${name}`,
        taskId: context.taskId,
        runId: context.runId,
        details: { durationMs, riskLevel: tool.riskLevel }
      });

      return {
        success: true,
        output,
        durationMs,
        riskLevel: tool.riskLevel
      };
    } catch (err: any) {
      const durationMs = Date.now() - startTime;
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
