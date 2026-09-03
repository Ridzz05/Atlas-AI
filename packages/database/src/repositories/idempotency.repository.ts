import {
  IdempotencyRecord,
  IdempotencyRecordSchema,
  IdempotencyKey
} from '@atlas/shared/schemas/idempotency';
import { DatabaseClient } from '../client.js';

export class IdempotencyRepository {
  constructor(private db: DatabaseClient) {}

  public async claim(input: IdempotencyKey): Promise<IdempotencyRecord | null> {
    const result = await this.db.query(
      `
      INSERT INTO idempotency_keys (
        key, task_id, run_id, action_name, payload_hash
      ) VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (key) DO NOTHING
      RETURNING *
    `,
      [
        input.key,
        input.taskId,
        input.runId ?? null,
        input.actionName,
        input.payloadHash
      ]
    );

    if (!result.rows[0]) return null;
    return this.mapRow(result.rows[0]);
  }

  public async findByKey(key: string): Promise<IdempotencyRecord | null> {
    const result = await this.db.query(
      'SELECT * FROM idempotency_keys WHERE key = $1',
      [key]
    );
    if (!result.rows[0]) return null;
    return this.mapRow(result.rows[0]);
  }

  public async recordSuccess(
    key: string,
    fields: { provider?: string; remoteId?: string; result?: Record<string, unknown> }
  ): Promise<IdempotencyRecord | null> {
    const result = await this.db.query(
      `
      UPDATE idempotency_keys
      SET outcome = 'succeeded',
          provider = COALESCE($1, provider),
          remote_id = COALESCE($2, remote_id),
          result = COALESCE($3::jsonb, result),
          updated_at = NOW()
      WHERE key = $4
      RETURNING *
    `,
      [
        fields.provider ?? null,
        fields.remoteId ?? null,
        fields.result ? JSON.stringify(fields.result) : null,
        key
      ]
    );
    if (!result.rows[0]) return null;
    return this.mapRow(result.rows[0]);
  }

  public async recordFailure(key: string, error: string): Promise<IdempotencyRecord | null> {
    const result = await this.db.query(
      `
      UPDATE idempotency_keys
      SET outcome = 'failed',
          error = $1,
          updated_at = NOW()
      WHERE key = $2
      RETURNING *
    `,
      [error, key]
    );
    if (!result.rows[0]) return null;
    return this.mapRow(result.rows[0]);
  }

  public async release(key: string): Promise<boolean> {
    const result = await this.db.query(
      'DELETE FROM idempotency_keys WHERE key = $1',
      [key]
    );
    return (result.rowCount || 0) > 0;
  }

  public async expireStale(before: Date): Promise<number> {
    const result = await this.db.query(
      `
      UPDATE idempotency_keys
      SET outcome = 'expired',
          updated_at = NOW()
      WHERE outcome = 'in_flight'
        AND expires_at IS NOT NULL
        AND expires_at < $1
    `,
      [before]
    );
    return result.rowCount || 0;
  }

  private mapRow(row: any): IdempotencyRecord {
    if (!row) throw new Error('Idempotency repository returned an empty row.');
    return IdempotencyRecordSchema.parse({
      key: row.key,
      taskId: row.task_id,
      runId: row.run_id,
      actionName: row.action_name,
      payloadHash: row.payload_hash,
      provider: row.provider || null,
      remoteId: row.remote_id || null,
      outcome: row.outcome,
      result: this.parseJson(row.result),
      error: row.error || null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      expiresAt: row.expires_at
    });
  }

  private parseJson(value: unknown): any {
    return typeof value === 'string' ? JSON.parse(value) : value || null;
  }
}
