import { ModelProvider, ModelRunRequest, ModelRunResult, ToolCallRequest } from './types.js';

export interface OpenAICompatibleOptions {
  apiKey?: string;
  baseUrl?: string;
  defaultModel?: string;
  inputCostPerMillion?: number;
  outputCostPerMillion?: number;
}

export class OpenAICompatibleProvider implements ModelProvider {
  public readonly id = 'openai-compatible';
  public readonly name = 'OpenAI Compatible Provider';

  private apiKey: string;
  private baseUrl: string;
  private defaultModel: string;
  private inputCostPerMillion: number;
  private outputCostPerMillion: number;

  constructor(options: OpenAICompatibleOptions = {}) {
    this.apiKey = options.apiKey || process.env.MODEL_API_KEY || '';
    this.baseUrl = (options.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
    this.defaultModel = options.defaultModel || 'gpt-4o-mini';
    this.inputCostPerMillion = options.inputCostPerMillion ?? 0.15;
    this.outputCostPerMillion = options.outputCostPerMillion ?? 0.6;
  }

  public estimateCost(inputTokens: number, outputTokens: number): number {
    const inputCost = (inputTokens / 1_000_000) * this.inputCostPerMillion;
    const outputCost = (outputTokens / 1_000_000) * this.outputCostPerMillion;
    return Number((inputCost + outputCost).toFixed(6));
  }

  public async run(request: ModelRunRequest): Promise<ModelRunResult> {
    const messages = [];

    if (request.systemPrompt) {
      messages.push({ role: 'system', content: request.systemPrompt });
    }

    for (const msg of request.messages) {
      messages.push({
        role: msg.role,
        content: msg.content,
        name: msg.name,
        tool_call_id: msg.toolCallId,
        tool_calls: msg.toolCalls?.map(tc => ({
          id: tc.id,
          type: 'function',
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.arguments)
          }
        }))
      });
    }

    const payload: Record<string, unknown> = {
      model: this.defaultModel,
      messages,
      temperature: request.temperature ?? 0.2
    };

    if (request.maxTokens !== undefined) {
      payload.max_tokens = request.maxTokens;
    }

    if (request.tools && request.tools.length > 0) {
      payload.tools = request.tools.map(t => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters
        }
      }));
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: request.signal
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI Provider HTTP ${response.status}: ${errorText}`);
    }

    const data = (await response.json()) as any;
    const choice = data.choices?.[0];
    const message = choice?.message;

    const toolCalls: ToolCallRequest[] = [];
    if (message?.tool_calls) {
      for (const tc of message.tool_calls) {
        let args = {};
        try {
          args = JSON.parse(tc.function.arguments);
        } catch {
          args = { raw: tc.function.arguments };
        }
        toolCalls.push({
          id: tc.id,
          name: tc.function.name,
          arguments: args
        });
      }
    }

    const inputTokens = data.usage?.prompt_tokens ?? 0;
    const outputTokens = data.usage?.completion_tokens ?? 0;
    const finishReason = choice?.finish_reason === 'tool_calls' ? 'tool_calls' : choice?.finish_reason === 'length' ? 'length' : 'stop';

    return {
      content: message?.content || '',
      toolCalls,
      inputTokens,
      outputTokens,
      costUsd: this.estimateCost(inputTokens, outputTokens),
      finishReason
    };
  }
}
