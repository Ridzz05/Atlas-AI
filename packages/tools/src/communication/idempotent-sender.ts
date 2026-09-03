import { createHash } from 'node:crypto';
import {
  CommunicationSendInput,
  CommunicationSendResult,
  CommunicationSender,
  ToolContext
} from '../types.js';
import {
  computeIdempotencyKey,
  IdempotencyKey,
  IdempotencyRecord
} from '@atlas/shared/schemas/idempotency';
import { rootLogger } from '@atlas/observability';

export interface IdempotencyStoreAdapter {
  claim(input: IdempotencyKey): Promise<{ existing: boolean; record?: IdempotencyRecord }>;
  findByKey(key: string): Promise<IdempotencyRecord | null>;
  recordSuccess(
    key: string,
    fields: { provider?: string; remoteId?: string; result?: Record<string, unknown> }
  ): Promise<unknown>;
  recordFailure(key: string, error: string): Promise<unknown>;
  release(key: string): Promise<boolean>;
}

export interface IdempotentSenderOptions {
  inner: CommunicationSender;
  store: IdempotencyStoreAdapter;
  provider: 'whatsapp' | 'email' | 'sms';
  defaultInFlightTtlMs?: number;
  now?: () => Date;
}

export interface SendContext {
  taskId: string;
  runId?: string;
  agentId?: string;
}

const DEFAULT_TTL_MS = 5 * 60 * 1000;
function toIsoString(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}
const ACTION_NAME = 'communication.send_approved';

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map((item) => stableStringify(item)).join(',') + ']';
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0
  );
  return (
    '{' +
    entries.map(([k, v]) => JSON.stringify(k) + ':' + stableStringify(v)).join(',') +
    '}'
  );
}

function hashInput(input: CommunicationSendInput): string {
  const canonical = {
    recipient: input.recipient,
    channel: input.channel,
    subject: input.subject ?? null,
    content: input.content
  };
  return createHash('sha256').update(stableStringify(canonical)).digest('hex');
}

function buildToolContext(
  base: SendContext,
  idempotencyKey: IdempotencyKey
): ToolContext {
  return {
    taskId: base.taskId,
    runId: base.runId ?? '',
    agentId: base.agentId ?? '',
    idempotencyKey,
    idempotencyStore: undefined
  } as ToolContext;
}

export class IdempotentSender {
  private readonly inner: CommunicationSender;
  private readonly store: IdempotencyStoreAdapter;
  private readonly provider: 'whatsapp' | 'email' | 'sms';
  private readonly ttlMs: number;
  private readonly now: () => Date;

  constructor(opts: IdempotentSenderOptions) {
    this.inner = opts.inner;
    this.store = opts.store;
    this.provider = opts.provider;
    this.ttlMs = opts.defaultInFlightTtlMs ?? DEFAULT_TTL_MS;
    this.now = opts.now ?? (() => new Date());
  }

  public async send(
    input: CommunicationSendInput,
    context: SendContext
  ): Promise<CommunicationSendResult> {
    const payloadHash = hashInput(input);
    const payload = {
      recipient: input.recipient,
      channel: input.channel,
      subject: input.subject ?? null,
      content: input.content
    };
    const key = computeIdempotencyKey({
      taskId: context.taskId,
      runId: context.runId,
      actionName: ACTION_NAME,
      payload
    });

    const idempotencyKey: IdempotencyKey = {
      key,
      taskId: context.taskId,
      runId: context.runId,
      actionName: ACTION_NAME,
      payloadHash,
      createdAt: this.now().toISOString()
    };

    const claim = await this.store.claim(idempotencyKey);
    if (claim.existing && claim.record) {
      const replayed = await this.replayOrFail(claim.record, key, input, context);
      if (replayed) return replayed;
    }

    try {
      const result = await this.inner(input, buildToolContext(context, idempotencyKey));
      await this.store.recordSuccess(key, {
        provider: this.provider,
        remoteId: result.messageId,
        result: result as unknown as Record<string, unknown>
      });
      return result;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err ?? 'Sender failed');
      await this.store.recordFailure(key, message);
      throw err;
    }
  }

  private async replayOrFail(
    record: IdempotencyRecord,
    key: string,
    input: CommunicationSendInput,
    context: SendContext
  ): Promise<CommunicationSendResult | null> {
    switch (record.outcome) {
      case 'succeeded': {
        const result = record.result as unknown as Partial<CommunicationSendResult> | null;
        if (result && typeof result === 'object' && typeof result.messageId === 'string') {
          return {
            messageId: result.messageId,
            recipient: result.recipient ?? input.recipient,
            timestamp: result.timestamp ?? toIsoString(record.createdAt)
          };
        }
        return {
          messageId: record.remoteId ?? 'replayed',
          recipient: input.recipient,
          timestamp: toIsoString(record.createdAt)
        };
      }
      case 'in_flight': {
        throw new Error(`Idempotent send still in flight: ${key}`);
      }
      case 'failed': {
        const ageMs = this.now().getTime() - new Date(toIsoString(record.createdAt)).getTime();
        if (ageMs >= this.ttlMs) {
          await this.store.release(key);
          return this.send(input, context);
        }
        throw new Error(`Previous send failed: ${record.error ?? 'unknown error'}`);
      }
      case 'expired': {
        await this.store.release(key);
        return this.send(input, context);
      }
      default: {
        rootLogger.warn('Unknown idempotency outcome, releasing and retrying', { key });
        await this.store.release(key);
        return this.send(input, context);
      }
    }
  }
}


