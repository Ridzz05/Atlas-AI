import { z, ZodSchema } from 'zod';
import { ApprovalToken, ToolRiskLevel } from '@atlas/shared';
import type { AuditRecord } from '@atlas/observability';

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

export type ResearchFreshness = 'fresh' | 'aging' | 'stale' | 'unknown';
export type ResearchSensitivity = 'public' | 'internal' | 'sensitive';

export interface ResearchEvidence {
  extractedAt: string;
  freshness: ResearchFreshness;
  sensitivity: ResearchSensitivity;
  unresolvedQuestions: string[];
  confidence: number;
}

export interface ResearchProvider {
  search(query: string, limit: number): Promise<Array<{
    title: string;
    url: string;
    snippet: string;
    confidence: number;
    extractedAt: string;
    freshness: ResearchFreshness;
    sensitivity: ResearchSensitivity;
    unresolvedQuestions: string[];
  }>>;
  lookupCompany(companyName: string, location: string): Promise<{
    found: boolean;
    companyName: string;
    address: string;
    phone?: string;
    instagram?: string;
    estimatedMembers?: number;
    sourceUrl: string;
    extractedAt: string;
    freshness: ResearchFreshness;
    sensitivity: ResearchSensitivity;
    unresolvedQuestions: string[];
    confidence: number;
  }>;
}

export type CommunicationSender = (
  input: CommunicationSendInput,
  context: ToolContext
) => Promise<CommunicationSendResult>;

export interface AuditSink {
  record(event: AuditRecord): Promise<unknown>;
}

export interface ApprovalExecutionStore {
  claimExecution(token: ApprovalToken, currentPayload: unknown): Promise<{ id: string } | null>;
  getExecutionStatus(id: string): Promise<string | null>;
  finalizeExecution(
    id: string,
    result: { success: boolean; output?: unknown; error?: string }
  ): Promise<unknown>;
}

export interface ApprovalRequestStore {
  requestApproval(input: {
    taskId: string;
    runId: string;
    agentId: string;
    action: string;
    target: string;
    payload: Record<string, unknown>;
    reason: string;
    riskLevel: ToolRiskLevel;
    expiresAt: Date;
  }): Promise<{ id: string } | null>;
}

export interface ToolContext {
  taskId: string;
  runId: string;
  agentId: string;
  grantedScopes?: string[];
  allowedTools?: string[];
  externalWritesEnabled?: boolean;
  approvalToken?: ApprovalToken;
  approvalSecretKey?: string;
  approvalExecutionStore?: ApprovalExecutionStore;
  approvalRequestStore?: ApprovalRequestStore;
  communicationSender?: CommunicationSender;
  auditSink?: AuditSink;
  researchProvider?: ResearchProvider;
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
  approvalId?: string;
  approvalPending?: boolean;
  durationMs: number;
  riskLevel: ToolRiskLevel;
}
