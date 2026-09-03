import { z, ZodSchema } from 'zod';
import { ApprovalToken, ToolRiskLevel, ToolManifest } from '@atlas/shared';
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

/**
 * Implementations must apply their own DNS, redirect, response-size, and timeout
 * controls. Tool-level URL validation rejects obvious local targets but cannot
 * pin a hostname's resolved address across the provider's network request.
 */
export interface ResearchProvider {
  fetchSafe?(
    url: string,
    signal?: AbortSignal
  ): Promise<{
    content: string;
    sourceUrl: string;
    extractedAt: string;
    freshness: ResearchFreshness;
    sensitivity: ResearchSensitivity;
    unresolvedQuestions: string[];
    confidence: number;
  }>;
  search(
    query: string,
    limit: number,
    signal?: AbortSignal
  ): Promise<
    Array<{
      title: string;
      url: string;
      snippet: string;
      confidence: number;
      extractedAt: string;
      freshness: ResearchFreshness;
      sensitivity: ResearchSensitivity;
      unresolvedQuestions: string[];
    }>
  >;
  lookupCompany(
    companyName: string,
    location: string,
    signal?: AbortSignal
  ): Promise<{
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
  enrichLead?(
    companyName: string,
    location: string,
    signal?: AbortSignal
  ): Promise<{
    found: boolean;
    companyName: string;
    location: string;
    category: string;
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

export type CommunicationSender = (input: CommunicationSendInput, context: ToolContext) => Promise<CommunicationSendResult>;

export interface AuditSink {
  record(event: AuditRecord): Promise<unknown>;
}

export interface ApprovalExecutionStore {
  claimExecution(token: ApprovalToken, currentPayload: unknown): Promise<{ id: string } | null>;
  getExecutionStatus(id: string): Promise<string | null>;
  finalizeExecution(id: string, result: { success: boolean; output?: unknown; error?: string }): Promise<unknown>;
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

/**
 * Minimal idempotency contract shared by the Tool Gateway and connectors.
 *
 * These types are declared locally until they are exported from
 * `@atlas/shared`; once the shared package exposes them, prefer the
 * shared module to keep a single source of truth.
 */
export interface IdempotencyKey {
  key: string;
  taskId: string;
  runId?: string;
  actionName: string;
  payloadHash: string;
  createdAt: string;
}

export interface IdempotencyStore {
  claim(input: {
    key: string;
    taskId: string;
    runId?: string;
    actionName: string;
    payloadHash: string;
  }): Promise<{ existing: boolean; record?: unknown }>;
  findByKey(key: string): Promise<{
    outcome: 'in_flight' | 'succeeded' | 'failed' | 'expired';
    result?: unknown;
    error?: string;
    remoteId?: string | null;
    provider?: string | null;
  } | null>;
  recordSuccess(key: string, fields: { provider?: string; remoteId?: string; result?: Record<string, unknown> }): Promise<unknown>;
  recordFailure(key: string, error: string): Promise<unknown>;
  release(key: string): Promise<boolean>;
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
  idempotencyStore?: IdempotencyStore;
  idempotencyKey?: IdempotencyKey;
}

/**
 * ToolDefinition describes an executable tool the gateway can route to.
 *
 * `manifest` is REQUIRED for any tool registered via `ToolRegistry.register`
 * and the registry throws if it is missing. The manifest is the contract
 * that lets the policy engine answer the question: "what is this tool
 * allowed to do, what kind of side effects does it have, and how should
 * the human in the loop be involved?". Without a manifest, the registry
 * refuses to register a tool (it throws), because silent low-risk defaults
 * for unknown actions were the original P0.1 fail-open vulnerability.
 *
 * Legacy tools that pre-date the manifest contract remain allowed on the
 * interface as `manifest?: ToolManifest` for type compatibility with the
 * existing tool definitions in this repo, but `ToolRegistry.register()`
 * enforces presence at runtime. Legacy tools that genuinely lack a manifest
 * MUST be registered via `ToolRegistry.registerLegacy()`, which synthesises
 * a conservative default manifest marked `approval: 'human'`.
 */
export interface ToolDefinition<TInput = any, TOutput = any> {
  name: string;
  description: string;
  inputSchema: ZodSchema<TInput>;
  outputSchema: ZodSchema<TOutput>;
  riskLevel: ToolRiskLevel;
  requiresApproval: boolean;
  timeoutMs: number;
  manifest?: ToolManifest;
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
  idempotentReplay?: boolean;
}
