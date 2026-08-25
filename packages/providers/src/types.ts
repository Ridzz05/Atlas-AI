export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  toolCallId?: string;
  toolCalls?: ToolCallRequest[];
}

export interface ToolCallRequest {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ModelRunRequest {
  runId: string;
  agentId: string;
  messages: ChatMessage[];
  systemPrompt?: string;
  tools?: Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }>;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface ModelRunResult {
  content: string;
  toolCalls: ToolCallRequest[];
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  finishReason: 'stop' | 'tool_calls' | 'length' | 'timeout' | 'cancelled';
}

export interface ModelProvider {
  readonly id: string;
  readonly name: string;
  run(request: ModelRunRequest): Promise<ModelRunResult>;
  estimateCost(inputTokens: number, outputTokens: number): number;
}
