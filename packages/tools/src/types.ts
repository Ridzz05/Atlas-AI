import { z, ZodSchema } from 'zod';
import { ApprovalToken, ToolRiskLevel } from '@atlas/shared';

export interface CommunicationSendInput {
  recipient: string;
  channel: 'whatsapp' | 'email' | 'sms';
  content: string;
  subject?: string;
}

export interface CommunicationSendResult {
  messageId: string;
  recipient: string;
  timestamp: string;
}

export type CommunicationSender = (
  input: CommunicationSendInput,
  context: ToolContext
) => Promise<CommunicationSendResult>;

export interface ApprovalExecutionStore {
  claimExecution(token: ApprovalToken, currentPayload: unknown): Promise<{ id: string } | null>;
  finalizeExecution(
    id: string,
    result: { success: boolean; output?: unknown; error?: string }
  ): Promise<unknown>;
}

export interface ToolContext {
  taskId: string;
  runId: string;
  agentId: string;
  grantedScopes?: string[];
  externalWritesEnabled?: boolean;
  approvalToken?: ApprovalToken;
  approvalSecretKey?: string;
  approvalExecutionStore?: ApprovalExecutionStore;
  communicationSender?: CommunicationSender;
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
