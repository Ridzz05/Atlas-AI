import { ModelProvider, ModelRunRequest, ModelRunResult, ToolCallRequest } from './types.js';

export interface MockProviderOptions {
  cannedResponses?: Array<{
    content?: string;
    toolCalls?: ToolCallRequest[];
    delayMs?: number;
  }>;
  costPerThousandTokens?: number;
}

export class MockModelProvider implements ModelProvider {
  public readonly id = 'mock';
  public readonly name = 'Mock Provider';
  private callCount = 0;

  constructor(private options: MockProviderOptions = {}) {}

  public setCannedResponses(responses: Array<{ content?: string; toolCalls?: ToolCallRequest[]; delayMs?: number }>): void {
    this.options.cannedResponses = responses;
    this.callCount = 0;
  }

  public estimateCost(inputTokens: number, outputTokens: number): number {
    const rate = this.options.costPerThousandTokens ?? 0.0015;
    return Number((((inputTokens + outputTokens) / 1000) * rate).toFixed(6));
  }

  public async run(request: ModelRunRequest): Promise<ModelRunResult> {
    if (request.signal?.aborted) {
      throw new Error('Request aborted');
    }

    const canned = this.options.cannedResponses?.[this.callCount];
    this.callCount++;

    if (canned?.delayMs) {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(resolve, canned.delayMs);
        request.signal?.addEventListener('abort', () => {
          clearTimeout(timeout);
          reject(new Error('Request aborted'));
        });
      });
    }

    const inputTokens = Math.max(10, request.messages.reduce((acc, m) => acc + (m.content?.length || 0) / 4, 0));
    const content = canned?.content ?? `Mock response for ${request.agentId}: Goal acknowledged.`;
    const toolCalls = canned?.toolCalls ?? [];
    const outputTokens = Math.max(5, content.length / 4);

    return {
      content,
      toolCalls,
      inputTokens: Math.round(inputTokens),
      outputTokens: Math.round(outputTokens),
      costUsd: this.estimateCost(inputTokens, outputTokens),
      finishReason: toolCalls.length > 0 ? 'tool_calls' : 'stop'
    };
  }
}
