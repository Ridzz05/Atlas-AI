import { ApprovalToken } from '@atlas/shared';
import { ToolCallRequest } from '@atlas/providers';
import { ToolContext, ToolRegistry } from '@atlas/tools';
import { ToolExecutor } from './agent-runner.js';

export interface ToolGatewayExecutorOptions {
  registry: ToolRegistry;
  /**
   * `allowedTools` is omitted here on purpose: it is per-call, supplied from the calling
   * agent's definition, never a property of the shared base context.
   */
  baseContext?: Omit<ToolContext, 'taskId' | 'runId' | 'agentId' | 'signal' | 'allowedTools'>;
}

export class ToolGatewayExecutor implements ToolExecutor {
  constructor(private options: ToolGatewayExecutorOptions) {}

  public async execute(
    toolCall: ToolCallRequest,
    context: {
      taskId: string;
      runId: string;
      agentId: string;
      grantedScopes?: string[];
      allowedTools: string[];
      approvalToken?: ApprovalToken;
      signal?: AbortSignal;
    }
  ): Promise<Record<string, unknown>> {
    const result = await this.options.registry.execute(toolCall.name, toolCall.arguments, {
      ...this.options.baseContext,
      taskId: context.taskId,
      runId: context.runId,
      agentId: context.agentId,
      grantedScopes: context.grantedScopes,
      allowedTools: context.allowedTools,
      approvalToken: context.approvalToken,
      signal: context.signal
    });

    if (!result.success) {
      return {
        success: false,
        error: result.error || `Tool '${toolCall.name}' rejected execution.`,
        approvalId: result.approvalId,
        approvalPending: result.approvalPending
      };
    }

    return {
      success: true,
      output: result.output && typeof result.output === 'object' ? result.output : { value: result.output }
    };
  }

  public getToolDefinitions(allowedTools?: string[]): Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }> {
    const allowed = allowedTools ? new Set(allowedTools) : null;
    return this.options.registry
      .list()
      .filter(t => !allowed || allowed.has(t.name))
      .map(t => {
        const schema = t.inputSchema as any;
        const properties: Record<string, unknown> = {};
        const required: string[] = [];
        if (schema && typeof schema === 'object' && schema.shape) {
          for (const [key, prop] of Object.entries(schema.shape)) {
            const p = prop as any;
            const typeName = p._def?.typeName || '';
            properties[key] = {
              type: typeName === 'ZodNumber' ? 'number' : typeName === 'ZodBoolean' ? 'boolean' : 'string',
              description: p.description || key
            };
            if (typeName !== 'ZodOptional' && p._def?.defaultValue === undefined) {
              required.push(key);
            }
          }
        }
        return {
          name: t.name,
          description: t.description,
          parameters: {
            type: 'object',
            properties,
            required: required.length > 0 ? required : undefined
          }
        };
      });
  }
}
