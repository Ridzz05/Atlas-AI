import { ToolCallRequest } from '@atlas/providers';
import { ToolContext, ToolRegistry } from '@atlas/tools';
import { ToolExecutor } from './agent-runner.js';

export interface ToolGatewayExecutorOptions {
  registry: ToolRegistry;
  baseContext?: Omit<ToolContext, 'taskId' | 'runId' | 'agentId' | 'signal'>;
}

export class ToolGatewayExecutor implements ToolExecutor {
  constructor(private options: ToolGatewayExecutorOptions) {}

  public async execute(
    toolCall: ToolCallRequest,
    context: { taskId: string; runId: string; agentId: string; signal?: AbortSignal }
  ): Promise<Record<string, unknown>> {
    const result = await this.options.registry.execute(toolCall.name, toolCall.arguments, {
      ...this.options.baseContext,
      taskId: context.taskId,
      runId: context.runId,
      agentId: context.agentId,
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
      output: (result.output && typeof result.output === 'object') ? result.output : { value: result.output }
    };
  }
}
