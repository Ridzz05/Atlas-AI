import { describe, it, expect, vi } from 'vitest';
import {
  IdempotentSender,
  IdempotencyStoreAdapter
} from '../src/communication/idempotent-sender.js';
import {
  IdempotencyKey,
  IdempotencyRecord
} from '@atlas/shared/schemas/idempotency';
import {
  CommunicationSendInput,
  CommunicationSendResult,
  CommunicationSender
} from '../src/types.js';

class InMemoryIdempotencyStore implements IdempotencyStoreAdapter {
  public records = new Map<string, IdempotencyRecord>();

  public async claim(input: IdempotencyKey): Promise<{ existing: boolean; record?: IdempotencyRecord }> {
    const existing = this.records.get(input.key);
    if (existing) {
      return { existing: true, record: existing };
    }
    const record: IdempotencyRecord = {
      key: input.key,
      taskId: input.taskId,
      runId: input.runId,
      actionName: input.actionName,
      payloadHash: input.payloadHash,
      createdAt: input.createdAt,
      outcome: 'in_flight',
      provider: null,
      remoteId: null,
      result: null,
      error: null,
      expiresAt: null
    };
    this.records.set(input.key, record);
    return { existing: false, record };
  }

  public async findByKey(key: string): Promise<IdempotencyRecord | null> {
    return this.records.get(key) ?? null;
  }

  public async recordSuccess(
    key: string,
    fields: { provider?: string; remoteId?: string; result?: Record<string, unknown> }
  ): Promise<unknown> {
    const rec = this.records.get(key);
    if (!rec) return null;
    rec.outcome = 'succeeded';
    if (fields.provider !== undefined) rec.provider = fields.provider;
    if (fields.remoteId !== undefined) rec.remoteId = fields.remoteId;
    if (fields.result !== undefined) rec.result = fields.result;
    return rec;
  }

  public async recordFailure(key: string, error: string): Promise<unknown> {
    const rec = this.records.get(key);
    if (!rec) return null;
    rec.outcome = 'failed';
    rec.error = error;
    return rec;
  }

  public async release(key: string): Promise<boolean> {
    return this.records.delete(key);
  }
}

const baseInput: CommunicationSendInput = {
  recipient: '+6281234567890',
  channel: 'whatsapp',
  content: 'Hello there'
};

const ctx = { taskId: '11111111-1111-1111-1111-111111111111', runId: '22222222-2222-2222-2222-222222222222' };

describe('IdempotentSender', () => {
  it('first call: claim succeeds, inner sender runs, result is recorded', async () => {
    const store = new InMemoryIdempotencyStore();
    const inner = vi.fn<CommunicationSender>(async (): Promise<CommunicationSendResult> => ({
      messageId: 'remote-1',
      recipient: baseInput.recipient,
      timestamp: '2026-09-02T00:00:00.000Z'
    }));
    const now = new Date('2026-09-02T00:00:00.000Z');
    const sender = new IdempotentSender({
      inner,
      store,
      provider: 'whatsapp',
      now: () => now
    });

    const result = await sender.send(baseInput, ctx);

    expect(result.messageId).toBe('remote-1');
    expect(inner).toHaveBeenCalledTimes(1);
    const storedRecords = Array.from(store.records.values());
    expect(storedRecords.length).toBe(1);
    const stored = storedRecords[0];
    expect(stored?.outcome).toBe('succeeded');
    expect(stored?.remoteId).toBe('remote-1');
    expect(stored?.provider).toBe('whatsapp');
  });

  it('second call with same input: replays previous result without calling inner sender', async () => {
    const store = new InMemoryIdempotencyStore();
    const inner = vi.fn<CommunicationSender>(async (): Promise<CommunicationSendResult> => ({
      messageId: 'remote-2',
      recipient: baseInput.recipient,
      timestamp: '2026-09-02T00:00:00.000Z'
    }));
    const now = new Date('2026-09-02T00:00:00.000Z');
    const sender = new IdempotentSender({
      inner,
      store,
      provider: 'whatsapp',
      now: () => now
    });

    await sender.send(baseInput, ctx);
    const second = await sender.send(baseInput, ctx);

    expect(inner).toHaveBeenCalledTimes(1);
    expect(second.messageId).toBe('remote-2');
  });

  it('second call while in_flight: throws "still in flight"', async () => {
    const store = new InMemoryIdempotencyStore();
    const inner = vi.fn<CommunicationSender>(async () => ({
      messageId: 'remote-3',
      recipient: baseInput.recipient,
      timestamp: '2026-09-02T00:00:00.000Z'
    }));
    const sender = new IdempotentSender({
      inner,
      store,
      provider: 'whatsapp',
      now: () => new Date('2026-09-02T00:00:00.000Z')
    });

    const first = sender.send(baseInput, ctx);
    await expect(sender.send(baseInput, ctx)).rejects.toThrow(/still in flight/i);
    await first;
  });

  it('after in-flight TTL expires on failed record: releases and retries', async () => {
    const store = new InMemoryIdempotencyStore();
    let nowMs = new Date('2026-09-02T00:00:00.000Z').getTime();
    const inner = vi
      .fn<CommunicationSender>()
      .mockRejectedValueOnce(new Error('transient error'))
      .mockResolvedValueOnce({
        messageId: 'remote-4',
        recipient: baseInput.recipient,
        timestamp: '2026-09-02T00:05:00.000Z'
      });
    const sender = new IdempotentSender({
      inner,
      store,
      provider: 'whatsapp',
      defaultInFlightTtlMs: 1000,
      now: () => new Date(nowMs)
    });

    await expect(sender.send(baseInput, ctx)).rejects.toThrow('transient error');
    nowMs += 2000;
    const second = await sender.send(baseInput, ctx);

    expect(second.messageId).toBe('remote-4');
    expect(inner).toHaveBeenCalledTimes(2);
  });

  it('inner sender throws: recordFailure is called, error propagates', async () => {
    const store = new InMemoryIdempotencyStore();
    const inner = vi.fn<CommunicationSender>(async () => {
      throw new Error('provider down');
    });
    const sender = new IdempotentSender({
      inner,
      store,
      provider: 'email',
      now: () => new Date('2026-09-02T00:00:00.000Z')
    });

    await expect(sender.send(baseInput, ctx)).rejects.toThrow('provider down');
    const records = Array.from(store.records.values());
    expect(records.length).toBe(1);
    expect(records[0]?.outcome).toBe('failed');
    expect(records[0]?.error).toBe('provider down');
  });
});
