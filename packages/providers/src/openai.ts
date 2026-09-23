import { ModelProvider, ModelRunRequest, ModelRunResult, ToolCallRequest } from './types.js';
import { ToolNameCodec } from './tool-names.js';

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
  /**
   * Provider-specific request fields, spread into the payload.
   *
   * Used by OpenRouter to ask for the cost it charges, which is the only accurate source for a model
   * whose price this codebase does not know.
   */
  extraPayload?: Record<string, unknown>;
}

export class OpenAICompatibleProvider implements ModelProvider {
  public readonly id: string;
  public readonly name: string;

  private apiKey: string;
  private baseUrl: string;
  private defaultModel: string;
  private inputCostPerMillion: number;
  private outputCostPerMillion: number;
  /**
   * Whether a price was actually declared for this endpoint.
   *
   * The constructor used to default both prices to 0.15/0.6 — gpt-4o-mini's — for every provider
   * that did not override them, so `ollama` (a local runtime, free) was billed at gpt-4o-mini rates
   * and its runs consumed the paid budget, and `groq`/`deepseek`/any OpenAI-compatible endpoint were
   * priced as if they were gpt-4o-mini. An undeclared price is unknown, not zero and not someone
   * else's.
   */
  private pricingConfigured: boolean;
  private extraPayload: Record<string, unknown>;
  private providerHeaders: Record<string, string>;
  private requireApiKey: boolean;

  constructor(options: OpenAICompatibleOptions = {}) {
    this.id = options.providerId || 'openai-compatible';
    this.name = options.providerName || 'OpenAI Compatible Provider';
    this.apiKey = options.apiKey !== undefined ? options.apiKey : process.env.MODEL_API_KEY || '';
    this.baseUrl = (options.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
    this.defaultModel = options.defaultModel || 'gpt-4o-mini';
    this.pricingConfigured = options.inputCostPerMillion !== undefined && options.outputCostPerMillion !== undefined;
    this.inputCostPerMillion = options.inputCostPerMillion ?? 0;
    this.outputCostPerMillion = options.outputCostPerMillion ?? 0;
    this.extraPayload = { ...(options.extraPayload || {}) };
    this.providerHeaders = { ...(options.defaultHeaders || {}) };
    this.requireApiKey = options.requireApiKey ?? true;
  }

  public estimateCost(inputTokens: number, outputTokens: number): number {
    if (!this.pricingConfigured) return 0;
    const inputCost = (inputTokens / 1_000_000) * this.inputCostPerMillion;
    const outputCost = (outputTokens / 1_000_000) * this.outputCostPerMillion;
    return Number((inputCost + outputCost).toFixed(6));
  }

  public async run(request: ModelRunRequest): Promise<ModelRunResult> {
    if (this.requireApiKey && !this.apiKey) {
      throw new Error('MODEL_API_KEY_MISSING: configure the model API key before starting an agent run.');
    }

    const messages = [];
    // Tool names are addressed with a dot internally and only `[a-zA-Z0-9_-]` is allowed on the
    // wire, so the adapter translates in both directions. Declarations are registered first: they
    // are the authoritative list for this request, so a name carried by an earlier turn resolves to
    // the same wire name the model was shown.
    const toolNames = new ToolNameCodec();
    for (const tool of request.tools || []) {
      toolNames.toWire(tool.name);
    }

    if (request.systemPrompt) {
      messages.push({ role: 'system', content: request.systemPrompt });
    }

    for (const msg of request.messages) {
      messages.push({
        role: msg.role,
        content: msg.content,
        name: msg.name ? toolNames.toWire(msg.name) : undefined,
        tool_call_id: msg.toolCallId,
        tool_calls: msg.toolCalls?.map(tc => ({
          id: tc.id,
          type: 'function',
          function: {
            name: toolNames.toWire(tc.name),
            arguments: JSON.stringify(tc.arguments)
          }
        }))
      });
    }

    const payload: Record<string, unknown> = {
      model: this.defaultModel,
      messages,
      temperature: request.temperature ?? 0.2,
      ...this.extraPayload
    };

    if (request.maxTokens !== undefined) {
      payload.max_tokens = request.maxTokens;
    }

    if (request.tools && request.tools.length > 0) {
      payload.tools = request.tools.map(t => ({
        type: 'function',
        function: {
          name: toolNames.toWire(t.name),
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
            // Back to the name the Tool Gateway is keyed by, never the wire spelling.
            name: toolNames.toRegistry(tc.function.name),
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

      // Prefer the cost the provider itself reports: it is the only accurate figure for a model
      // whose price this codebase does not know.
      const reportedCost = data.usage?.cost;
      const hasReportedCost = typeof reportedCost === 'number' && Number.isFinite(reportedCost);

      return {
        content: message?.content || '',
        toolCalls,
        inputTokens,
        outputTokens,
        costUsd: hasReportedCost ? Number(reportedCost.toFixed(6)) : this.estimateCost(inputTokens, outputTokens),
        costUsdKnown: hasReportedCost || this.pricingConfigured,
        finishReason
      };
    }

    throw lastError || new Error(`${this.name}: Max retries exceeded`);
  }
}
