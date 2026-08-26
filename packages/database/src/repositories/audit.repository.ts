import type { AuditRecord } from '@atlas/observability';
import { DatabaseClient } from '../client.js';

export class AuditRepository {
  constructor(private db: DatabaseClient) {}

  public async create(record: AuditRecord): Promise<AuditRecord> {
    const result = await this.db.query(`
      INSERT INTO audit_events (id, timestamp, actor, action, target, task_id, run_id, details, ip_address)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `, [
      record.id,
      record.timestamp,
      record.actor,
      record.action,
      record.target || null,
      record.taskId || null,
      record.runId || null,
      JSON.stringify(record.details || {}),
      record.ipAddress || null
    ]);

    return this.mapRow(result.rows[0]);
  }

  public async list(options: {
    actor?: string;
    action?: string;
    taskId?: string;
    runId?: string;
    limit?: number;
  } = {}): Promise<AuditRecord[]> {
    const limit = Math.min(100, Math.max(1, Math.trunc(options.limit || 50)));
    const values: unknown[] = [];
    const filters: string[] = [];
    const addFilter = (column: string, value: unknown) => {
      values.push(value);
      filters.push(`${column} = $${values.length}`);
    };

    if (options.actor) addFilter('actor', options.actor);
    if (options.action) addFilter('action', options.action);
    if (options.taskId) addFilter('task_id', options.taskId);
    if (options.runId) addFilter('run_id', options.runId);

    let sql = 'SELECT * FROM audit_events';
    if (filters.length > 0) sql += ` WHERE ${filters.join(' AND ')}`;
    values.push(limit);
    sql += ` ORDER BY timestamp DESC, id DESC LIMIT $${values.length}`;

    const result = await this.db.query(sql, values);
    return result.rows.map(row => this.mapRow(row));
  }

  private mapRow(row: any): AuditRecord {
    if (!row) throw new Error('Audit repository returned an empty row.');
    return {
      id: row.id,
      timestamp: row.timestamp,
      actor: row.actor,
      action: row.action,
      target: row.target || undefined,
      taskId: row.task_id || undefined,
      runId: row.run_id || undefined,
      details: typeof row.details === 'string' ? JSON.parse(row.details) : row.details || {},
      ipAddress: row.ip_address || undefined
    };
  }
}
