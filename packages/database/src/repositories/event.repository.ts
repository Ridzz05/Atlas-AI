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
    return result.rows.map(row => SystemEventSchema.parse({
      id: row.event_id,
      type: row.event_type,
      taskId: row.task_id || undefined,
      runId: row.run_id || undefined,
      agentId: row.agent_id || undefined,
      payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload || {},
      timestamp: row.occurred_at
    }));
  }
}
