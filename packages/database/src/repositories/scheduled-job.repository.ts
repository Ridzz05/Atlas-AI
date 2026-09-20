import { DatabaseClient } from '../client.js';
import {
  CreateScheduledJobInput,
  CreateScheduledJobInputSchema,
  ScheduledJob,
  ScheduledJobSchema,
  UpdateScheduledJobInput,
  UpdateScheduledJobInputSchema
} from '@atlas/shared';

export class ScheduledJobRepository {
  constructor(private db: DatabaseClient) {}

  public async create(input: CreateScheduledJobInput): Promise<ScheduledJob> {
    const validated = CreateScheduledJobInputSchema.parse(input);
    const id = validated.id || this.generateId();
    const res = await this.db.query(
      `INSERT INTO scheduled_jobs (
         id, name, job_type, cron_pattern, timezone, payload,
         assigned_agent, enabled, created_by
       ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)
       RETURNING *`,
      [
        id,
        validated.name,
        validated.jobType,
        validated.cronPattern,
        validated.timezone,
        JSON.stringify(validated.payload),
        validated.assignedAgent,
        validated.enabled,
        validated.createdBy
      ]
    );
    return this.mapRow(res.rows[0]);
  }

  public async findById(id: string): Promise<ScheduledJob | null> {
    const res = await this.db.query('SELECT * FROM scheduled_jobs WHERE id = $1', [id]);
    if (!res.rows[0]) return null;
    return this.mapRow(res.rows[0]);
  }

  public async list(filter: { enabled?: boolean; jobType?: string } = {}): Promise<ScheduledJob[]> {
    let sql = 'SELECT * FROM scheduled_jobs WHERE 1=1';
    const params: unknown[] = [];
    if (typeof filter.enabled === 'boolean') {
      params.push(filter.enabled);
      sql += ` AND enabled = $${params.length}`;
    }
    if (filter.jobType) {
      params.push(filter.jobType);
      sql += ` AND job_type = $${params.length}`;
    }
    sql += ' ORDER BY created_at ASC';
    const res = await this.db.query(sql, params);
    return res.rows.map(r => this.mapRow(r));
  }

  public async update(id: string, input: UpdateScheduledJobInput): Promise<ScheduledJob> {
    const validated = UpdateScheduledJobInputSchema.parse(input);
    const fields: string[] = [];
    const params: unknown[] = [];

    const map: Array<[keyof UpdateScheduledJobInput, string]> = [
      ['name', 'name'],
      ['cronPattern', 'cron_pattern'],
      ['timezone', 'timezone'],
      ['assignedAgent', 'assigned_agent'],
      ['enabled', 'enabled']
    ];
    for (const [key, column] of map) {
      const value = validated[key];
      if (value !== undefined) {
        params.push(value);
        fields.push(`${column} = $${params.length}`);
      }
    }
    if (validated.payload !== undefined) {
      params.push(JSON.stringify(validated.payload));
      fields.push(`payload = $${params.length}::jsonb`);
    }
    if (fields.length === 0) {
      const existing = await this.findById(id);
      if (!existing) throw new Error(`Scheduled job not found: ${id}`);
      return existing;
    }
    fields.push('updated_at = NOW()');
    params.push(id);
    const res = await this.db.query(`UPDATE scheduled_jobs SET ${fields.join(', ')} WHERE id = $${params.length} RETURNING *`, params);
    if (!res.rows[0]) throw new Error(`Scheduled job not found: ${id}`);
    return this.mapRow(res.rows[0]);
  }

  public async recordRun(id: string, nextRunAt: Date | null, error?: string): Promise<void> {
    await this.db.query(
      `UPDATE scheduled_jobs
       SET last_run_at = NOW(),
           next_run_at = $2,
           last_error = $3,
           updated_at = NOW()
       WHERE id = $1`,
      [id, nextRunAt, error || null]
    );
  }

  /**
   * Atomically claim a due job by advancing its schedule, and only if it is still at the value the
   * caller read.
   *
   * `recordRun` was a blind UPDATE applied AFTER the task was created and enqueued, so there was
   * no compare-and-set anywhere in the tick. Two worker replicas ticking in the same minute both
   * read the same `next_run_at`, both passed the due check, and both dispatched: the same cron
   * tick ran twice, each with its own task id, so nothing downstream could deduplicate them. This
   * is the claim, and it must happen BEFORE the side effects.
   *
   * `expectedNextRunAt` is the value the caller read (null for a job that has never run);
   * `IS NOT DISTINCT FROM` makes that comparison NULL-safe. Returns the claimed row, or null when
   * another caller got there first.
   */
  public async claimRun(id: string, expectedNextRunAt: Date | null, nextRunAt: Date): Promise<ScheduledJob | null> {
    const res = await this.db.query(
      `UPDATE scheduled_jobs
       SET last_run_at = NOW(),
           next_run_at = $3,
           last_error = NULL,
           updated_at = NOW()
       WHERE id = $1
         AND next_run_at IS NOT DISTINCT FROM $2
       RETURNING *`,
      [id, expectedNextRunAt, nextRunAt]
    );

    return res.rows[0] ? this.mapRow(res.rows[0]) : null;
  }

  /**
   * Annotate a job whose dispatch failed after it was already claimed.
   *
   * It must not touch `next_run_at`: the claim already advanced the schedule, and re-pointing it
   * here is what turned one transient failure into a duplicate task on every tick.
   */
  public async recordError(id: string, error: string): Promise<void> {
    await this.db.query(`UPDATE scheduled_jobs SET last_error = $2, updated_at = NOW() WHERE id = $1`, [id, error]);
  }

  public async delete(id: string): Promise<boolean> {
    const res = await this.db.query('DELETE FROM scheduled_jobs WHERE id = $1', [id]);
    return (res.rowCount || 0) > 0;
  }

  private generateId(): string {
    return `sj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }

  private mapRow(row: any): ScheduledJob {
    return ScheduledJobSchema.parse({
      id: row.id,
      name: row.name,
      jobType: row.job_type,
      cronPattern: row.cron_pattern,
      timezone: row.timezone,
      payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload,
      assignedAgent: row.assigned_agent,
      enabled: Boolean(row.enabled),
      lastRunAt: row.last_run_at ? new Date(row.last_run_at).toISOString() : null,
      nextRunAt: row.next_run_at ? new Date(row.next_run_at).toISOString() : null,
      lastError: row.last_error || null,
      createdBy: row.created_by,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString()
    });
  }
}
