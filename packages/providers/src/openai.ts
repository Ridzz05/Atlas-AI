import { ModelProvider, ModelRunRequest, ModelRunResult, ToolCallRequest } from './types.js';

export interface OpenAICompatibleOptions {
  apiKey?: string;
  baseUrl?: string;
  defaultModel?: string;
  inputCostPerMillion?: number;
  outputCostPerMillion?: number;
  providerId?: string;
  providerName?: string;
  defaultHeaders?: Record<string, string>;
  requireApiKey?: boolean;
}

export class OpenAICompatibleProvider implements ModelProvider {
  public readonly id: string;
  public readonly name: string;

  private apiKey: string;
  private baseUrl: string;
  private defaultModel: string;
  private inputCostPerMillion: number;
  private outputCostPerMillion: number;
  private providerHeaders: Record<string, string>;
  private requireApiKey: boolean;

  constructor(options: OpenAICompatibleOptions = {}) {
    this.id = options.providerId || 'openai-compatible';
    this.name = options.providerName || 'OpenAI Compatible Provider';
    this.apiKey = options.apiKey !== undefined ? options.apiKey : process.env.MODEL_API_KEY || '';
    this.baseUrl = (options.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
    this.defaultModel = options.defaultModel || 'gpt-4o-mini';
    this.inputCostPerMillion = options.inputCostPerMillion ?? 0.15;
    this.outputCostPerMillion = options.outputCostPerMillion ?? 0.6;
    this.providerHeaders = { ...(options.defaultHeaders || {}) };
    this.requireApiKey = options.requireApiKey ?? true;
  }

  public estimateCost(inputTokens: number, outputTokens: number): number {
    const inputCost = (inputTokens / 1_000_000) * this.inputCostPerMillion;
    const outputCost = (outputTokens / 1_000_000) * this.outputCostPerMillion;
    return Number((inputCost + outputCost).toFixed(6));
  }

  public async run(request: ModelRunRequest): Promise<ModelRunResult> {
    if (this.requireApiKey && !this.apiKey) {
      throw new Error('MODEL_API_KEY_MISSING: configure the model API key before starting an agent run.');
    }

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
      'Content-Type': 'application/json',
      ...this.providerHeaders
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      let response: Response;
      try {
        response = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          signal: request.signal
        });
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < maxRetries && !request.signal?.aborted) {
          await new Promise(resolve => setTimeout(resolve, attempt * 1000));
          continue;
        }
        throw lastError;
      }

      if (!response.ok) {
        const errorText = await response.text();
        const safeErrorText = this.apiKey ? errorText.replaceAll(this.apiKey, '[REDACTED]') : errorText;
        lastError = new Error(`${this.name} HTTP ${response.status}: ${safeErrorText}`);

        if ([429, 500, 502, 503, 504].includes(response.status) && attempt < maxRetries && !request.signal?.aborted) {
          let delayMs = attempt * 2000;
          const retryAfterHeader = response.headers.get('retry-after');
          if (retryAfterHeader) {
            const parsed = parseFloat(retryAfterHeader);
            if (!isNaN(parsed) && parsed > 0) {
              delayMs = Math.min(Math.ceil(parsed * 1000) + 500, 45000);
            }
          } else {
            const match = errorText.match(/try again in (\d+(?:\.\d+)?)s/i);
            if (match && match[1]) {
              const parsed = parseFloat(match[1]);
              if (!isNaN(parsed) && parsed > 0) {
                delayMs = Math.min(Math.ceil(parsed * 1000) + 500, 45000);
              }
            }
          }

          await new Promise(resolve => setTimeout(resolve, delayMs));
          continue;
        }

        throw lastError;
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
      let finishReason: ModelRunResult['finishReason'] = 'stop';
      if (choice?.finish_reason === 'tool_calls') {
        finishReason = 'tool_calls';
      } else if (choice?.finish_reason === 'length') {
        finishReason = 'length';
      }

      return {
        content: message?.content || '',
        toolCalls,
        inputTokens,
        outputTokens,
        costUsd: this.estimateCost(inputTokens, outputTokens),
        finishReason
      };
    }

    throw lastError || new Error(`${this.name}: Max retries exceeded`);
  }
}
