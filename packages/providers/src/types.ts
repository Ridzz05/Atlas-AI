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
  /**
   * Whether `costUsd` is a measurement rather than a placeholder.
   *
   * A provider whose price is neither declared nor reported by its API cannot know what a run cost,
   * and `costUsd: 0` for such a run is indistinguishable from a genuinely free one. The budget
   * subsystem cannot enforce a cap against an unknown price, so it must be able to say so.
   */
  costUsdKnown: boolean;
  finishReason: 'stop' | 'tool_calls' | 'length' | 'timeout' | 'cancelled';
}

export interface ModelProvider {
  readonly id: string;
  readonly name: string;
  run(request: ModelRunRequest): Promise<ModelRunResult>;
  estimateCost(inputTokens: number, outputTokens: number): number;
}
