import { DatabaseClient } from '../client.js';

export interface ArtifactRecord {
  id: string;
  taskId: string;
  runId: string | null;
  name: string;
  mimeType: string;
  filePath: string;
  sizeBytes: number;
  metadata: Record<string, unknown>;
  createdAt: string | Date;
  updatedAt: string | Date;
}

export interface ArtifactCreateInput {
  taskId: string;
  runId?: string;
  name: string;
  mimeType: string;
  filePath: string;
  sizeBytes: number;
  metadata?: Record<string, unknown>;
}

export class ArtifactRepository {
  constructor(private db: DatabaseClient) {}

  public async create(input: ArtifactCreateInput): Promise<ArtifactRecord> {
    const result = await this.db.query(
      `
      INSERT INTO artifacts (task_id, run_id, name, mime_type, file_path, size_bytes, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `,
      [input.taskId, input.runId || null, input.name, input.mimeType, input.filePath, input.sizeBytes, JSON.stringify(input.metadata || {})]
    );

    return this.mapRow(result.rows[0]);
  }

  public async list(options: { taskId?: string; limit?: number } = {}): Promise<ArtifactRecord[]> {
    const limit = Math.min(100, Math.max(1, Math.trunc(options.limit || 50)));
    const values: unknown[] = [];
    let sql = 'SELECT * FROM artifacts';

    if (options.taskId) {
      values.push(options.taskId);
      sql += ` WHERE task_id = $${values.length}`;
    }

    values.push(limit);
    sql += ` ORDER BY created_at DESC, id DESC LIMIT $${values.length}`;
    const result = await this.db.query(sql, values);
    return result.rows.map(row => this.mapRow(row));
  }

  private mapRow(row: any): ArtifactRecord {
    if (!row) throw new Error('Artifact repository returned an empty row.');
    return {
      id: row.id,
      taskId: row.task_id,
      runId: row.run_id || null,
      name: row.name,
      mimeType: row.mime_type,
      filePath: row.file_path,
      sizeBytes: Number(row.size_bytes || 0),
      metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata || {},
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}
