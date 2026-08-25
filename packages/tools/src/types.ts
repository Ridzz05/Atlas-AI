import { z, ZodSchema } from 'zod';
import { ToolRiskLevel } from '@atlas/shared';

export interface ToolContext {
  taskId: string;
  runId: string;
  agentId: string;
  grantedScopes?: string[];
  externalWritesEnabled?: boolean;
  approvalToken?: string;
  signal?: AbortSignal;
}

export interface ToolDefinition<TInput = any, TOutput = any> {
  name: string;
  description: string;
  inputSchema: ZodSchema<TInput>;
  outputSchema: ZodSchema<TOutput>;
  riskLevel: ToolRiskLevel;
  requiresApproval: boolean;
  timeoutMs: number;
  execute(context: ToolContext, input: TInput): Promise<TOutput>;
}

export interface ToolExecutionResponse {
  success: boolean;
  output?: unknown;
  error?: string;
  durationMs: number;
  riskLevel: ToolRiskLevel;
}
