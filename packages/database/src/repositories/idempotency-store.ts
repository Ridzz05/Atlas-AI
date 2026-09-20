import { IdempotencyRepository } from './idempotency.repository.js';

/**
 * The tools-side `IdempotencyStore` contract, declared structurally.
 *
 * `@atlas/tools` is not a dependency of this package and this package must not become one, for the
 * same reason the tools registry only depends on a structural EventBus: the alternative is a
 * circular package dependency. Declaring the shape here lets the adapter satisfy the interface
 * without the import.
 */
export interface IdempotencyStoreContract {
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

/**
 * Adapts the durable repository to the tool registry's store contract.
 *
 * `claim` needs the two shapes reconciled. The repository returns the row when it inserted it or
 * reclaimed an expired one, and null when a live row already holds the key — so a null has to be
 * resolved with a read, because the registry needs the existing record to decide between replaying a
 * recorded success, re-raising a recorded failure, and refusing while another attempt is in flight.
 */
export class DatabaseIdempotencyStore implements IdempotencyStoreContract {
  constructor(private readonly repo: IdempotencyRepository) {}

  public async claim(input: {
    key: string;
    taskId: string;
    runId?: string;
    actionName: string;
    payloadHash: string;
  }): Promise<{ existing: boolean; record?: unknown }> {
    const claimed = await this.repo.claim({
      key: input.key,
      taskId: input.taskId,
      runId: input.runId,
      actionName: input.actionName,
      payloadHash: input.payloadHash,
      createdAt: new Date().toISOString()
    });
    if (claimed) {
      return { existing: false, record: claimed };
    }
    const held = await this.repo.findByKey(input.key);
    return { existing: true, record: held ?? undefined };
  }

  public async findByKey(key: string): Promise<{
    outcome: 'in_flight' | 'succeeded' | 'failed' | 'expired';
    result?: unknown;
    error?: string;
    remoteId?: string | null;
    provider?: string | null;
  } | null> {
    const record = await this.repo.findByKey(key);
    if (!record) return null;
    return {
      outcome: record.outcome,
      result: record.result ?? undefined,
      error: record.error ?? undefined,
      remoteId: record.remoteId,
      provider: record.provider
    };
  }

  public async recordSuccess(
    key: string,
    fields: { provider?: string; remoteId?: string; result?: Record<string, unknown> }
  ): Promise<unknown> {
    return this.repo.recordSuccess(key, fields);
  }

  public async recordFailure(key: string, error: string): Promise<unknown> {
    return this.repo.recordFailure(key, error);
  }

  public async release(key: string): Promise<boolean> {
    return this.repo.release(key);
  }
}
