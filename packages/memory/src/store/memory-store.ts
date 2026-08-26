import { MemoryItem, MemoryItemSchema, MemoryType, MemoryStatus } from '@atlas/shared';
import { DatabaseClient } from '@atlas/database';
import { rootLogger } from '@atlas/observability';
import { ProposeMemoryInput } from '../types.js';

export interface MemoryStore {
  save(item: MemoryItem): Promise<MemoryItem>;
  findById(id: string): Promise<MemoryItem | null>;
  listExpired(options?: { now?: Date; limit?: number }): Promise<MemoryItem[]>;
  search(params: { scopes?: string[]; types?: MemoryType[]; status?: MemoryStatus; limit?: number }): Promise<MemoryItem[]>;
  updateStatus(id: string, status: MemoryStatus): Promise<MemoryItem | null>;
  delete(id: string): Promise<boolean>;
  deleteByScope(scope: string): Promise<number>;
}

export function isMemoryExpired(item: Pick<MemoryItem, 'expiresAt'>, now = Date.now()): boolean {
  if (item.expiresAt == null) return false;
  const expiresAt = new Date(item.expiresAt).getTime();
  return !Number.isFinite(expiresAt) || expiresAt <= now;
}

export class InMemoryMemoryStore implements MemoryStore {
  private items = new Map<string, MemoryItem>();

  public async save(item: MemoryItem): Promise<MemoryItem> {
    const validated = MemoryItemSchema.parse(item);
    this.items.set(validated.id, validated);
    return validated;
  }

  public async findById(id: string): Promise<MemoryItem | null> {
    const item = this.items.get(id);
    return item && !isMemoryExpired(item) ? item : null;
  }

  public async listExpired(options: { now?: Date; limit?: number } = {}): Promise<MemoryItem[]> {
    const now = options.now?.getTime() ?? Date.now();
    const items = Array.from(this.items.values())
      .filter(item => isMemoryExpired(item, now))
      .sort((a, b) => {
        const aExpires = new Date(a.expiresAt as string).getTime();
        const bExpires = new Date(b.expiresAt as string).getTime();
        return aExpires - bExpires || a.id.localeCompare(b.id);
      });

    return options.limit ? items.slice(0, options.limit) : items;
  }

  public async search(params: { scopes?: string[]; types?: MemoryType[]; status?: MemoryStatus; limit?: number }): Promise<MemoryItem[]> {
    let list = Array.from(this.items.values());

    if (params.scopes && params.scopes.length > 0) {
      const allowed = new Set(params.scopes);
      list = list.filter(item => allowed.has(item.scope) || item.scope === 'global');
    }

    if (params.types && params.types.length > 0) {
      const types = new Set(params.types);
      list = list.filter(item => types.has(item.type));
    }

    if (params.status) {
      list = list.filter(item => item.status === params.status);
    }

    list = list.filter(item => !isMemoryExpired(item));

    if (params.limit) {
      list = list.slice(0, params.limit);
    }

    return list;
  }

  public async updateStatus(id: string, status: MemoryStatus): Promise<MemoryItem | null> {
    const item = this.items.get(id);
    if (!item) return null;
    item.status = status;
    item.updatedAt = new Date().toISOString();
    return item;
  }

  public async delete(id: string): Promise<boolean> {
    return this.items.delete(id);
  }

  public async deleteByScope(scope: string): Promise<number> {
    let deletedCount = 0;
    for (const [id, item] of this.items.entries()) {
      if (item.scope === scope) {
        this.items.delete(id);
        deletedCount++;
      }
    }
    return deletedCount;
  }
}

export class DatabaseMemoryStore implements MemoryStore {
  constructor(private db: DatabaseClient) {}

  public async save(item: MemoryItem): Promise<MemoryItem> {
    const query = `
      INSERT INTO memory_items (
        id, type, status, content, scope, author, source, confidence, task_id, artifact_id, metadata, expires_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      ON CONFLICT (id) DO UPDATE SET
        content = EXCLUDED.content,
        status = EXCLUDED.status,
        confidence = EXCLUDED.confidence,
        metadata = EXCLUDED.metadata,
        updated_at = NOW()
      RETURNING *;
    `;

    const res = await this.db.query(query, [
      item.id,
      item.type,
      item.status,
      item.content,
      item.scope,
      item.author,
      item.source,
      item.confidence,
      item.taskId || null,
      item.artifactId || null,
      JSON.stringify(item.metadata || {}),
      item.expiresAt || null
    ]);

    return this.mapRow(res.rows[0]);
  }

  public async findById(id: string): Promise<MemoryItem | null> {
    const res = await this.db.query('SELECT * FROM memory_items WHERE id = $1 AND (expires_at IS NULL OR expires_at > NOW())', [id]);
    if (!res.rows[0]) return null;
    return this.mapRow(res.rows[0]);
  }

  public async listExpired(options: { now?: Date; limit?: number } = {}): Promise<MemoryItem[]> {
    const now = options.now || new Date();
    const limit = Math.min(1000, Math.max(1, Math.trunc(options.limit || 100)));
    const res = await this.db.query(
      `SELECT * FROM memory_items
       WHERE expires_at IS NOT NULL AND expires_at <= $1
       ORDER BY expires_at ASC, id ASC
       LIMIT $2`,
      [now, limit]
    );
    return res.rows.map(row => this.mapRow(row));
  }

  public async search(params: { scopes?: string[]; types?: MemoryType[]; status?: MemoryStatus; limit?: number }): Promise<MemoryItem[]> {
    let sql = 'SELECT * FROM memory_items WHERE 1=1';
    const values: any[] = [];

    if (params.scopes && params.scopes.length > 0) {
      values.push(params.scopes);
      sql += ` AND (scope = ANY($${values.length}) OR scope = 'global')`;
    }

    if (params.types && params.types.length > 0) {
      values.push(params.types);
      sql += ` AND type = ANY($${values.length})`;
    }

    if (params.status) {
      values.push(params.status);
      sql += ` AND status = $${values.length}`;
    }

    sql += ' AND (expires_at IS NULL OR expires_at > NOW())';

    sql += ' ORDER BY created_at DESC';

    if (params.limit) {
      values.push(params.limit);
      sql += ` LIMIT $${values.length}`;
    }

    const res = await this.db.query(sql, values);
    return res.rows.map(r => this.mapRow(r));
  }

  public async updateStatus(id: string, status: MemoryStatus): Promise<MemoryItem | null> {
    const query = `
      UPDATE memory_items
      SET status = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING *;
    `;
    const res = await this.db.query(query, [status, id]);
    if (!res.rows[0]) return null;
    return this.mapRow(res.rows[0]);
  }

  public async delete(id: string): Promise<boolean> {
    const res = await this.db.query('DELETE FROM memory_items WHERE id = $1', [id]);
    return (res.rowCount || 0) > 0;
  }

  public async deleteByScope(scope: string): Promise<number> {
    const res = await this.db.query('DELETE FROM memory_items WHERE scope = $1', [scope]);
    return res.rowCount || 0;
  }

  private mapRow(row: any): MemoryItem {
    return {
      id: row.id,
      type: row.type,
      status: row.status,
      content: row.content,
      scope: row.scope,
      author: row.author,
      source: row.source,
      confidence: Number(row.confidence || 1.0),
      taskId: row.task_id,
      artifactId: row.artifact_id,
      metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata || {},
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}
