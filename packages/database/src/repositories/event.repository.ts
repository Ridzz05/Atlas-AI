import { SystemEvent, SystemEventSchema } from '@atlas/shared';
import { DatabaseClient } from '../client.js';

export class SystemEventRepository {
  constructor(private db: DatabaseClient) {}

  public async list(options: { limit?: number; since?: Date | string } = {}): Promise<SystemEvent[]> {
    const limit = Math.min(100, Math.max(1, Math.trunc(options.limit || 50)));
    const values: unknown[] = [];
    let sql = `
      SELECT event_id, event_type, task_id, run_id, agent_id, payload, occurred_at
      FROM event_outbox`;

    if (options.since) {
      values.push(options.since);
      sql += ` WHERE occurred_at > $${values.length}`;
    }

    values.push(limit);
    sql += ` ORDER BY occurred_at DESC, event_id DESC LIMIT $${values.length}`;

    const result = await this.db.query(sql, values);
    return result.rows.map(row => this.mapRow(row));
  }

  public async listAfterId(afterId: string, limit = 100): Promise<SystemEvent[]> {
    const normalizedLimit = Math.min(100, Math.max(1, Math.trunc(limit || 100)));
    const cursor = await this.db.query(
      'SELECT event_id, occurred_at FROM event_outbox WHERE event_id = $1',
      [afterId]
    );
    const cursorRow = cursor.rows[0];
    if (!cursorRow) return [];

    const result = await this.db.query(`
      SELECT event_id, event_type, task_id, run_id, agent_id, payload, occurred_at
      FROM event_outbox
      WHERE (occurred_at, event_id) > ($1::timestamptz, $2::uuid)
      ORDER BY occurred_at ASC, event_id ASC
      LIMIT $3`, [cursorRow.occurred_at, cursorRow.event_id, normalizedLimit]);

    return result.rows.map(row => this.mapRow(row));
  }

  private mapRow(row: any): SystemEvent {
    return SystemEventSchema.parse({
      id: row.event_id,
      type: row.event_type,
      taskId: row.task_id || undefined,
      runId: row.run_id || undefined,
      agentId: row.agent_id || undefined,
      payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload || {},
      timestamp: row.occurred_at
    });
  }
}
