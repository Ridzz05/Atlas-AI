import { DatabaseClient, DatabaseQueryExecutor } from '../client.js';

export type MessageSenderType = 'user' | 'agent' | 'system' | 'tool';

export interface MessageRecord {
  id: string;
  taskId: string | null;
  runId: string | null;
  senderType: MessageSenderType;
  senderId: string;
  recipientId: string | null;
  content: string;
  metadata: Record<string, unknown>;
  createdAt: string | Date;
}

export interface MessageCreateInput {
  taskId?: string | null;
  runId?: string | null;
  senderType: MessageSenderType;
  senderId: string;
  recipientId?: string | null;
  content: string;
  metadata?: Record<string, unknown>;
}

export class MessageRepository {
  constructor(private db: DatabaseClient) {}

  public async create(
    input: MessageCreateInput,
    id = crypto.randomUUID(),
    executor: DatabaseQueryExecutor = this.db
  ): Promise<MessageRecord> {
    const result = await executor.query(
      `
      INSERT INTO messages (id, task_id, run_id, sender_type, sender_id, recipient_id, content, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `,
      [
        id,
        input.taskId || null,
        input.runId || null,
        input.senderType,
        input.senderId,
        input.recipientId || null,
        input.content,
        JSON.stringify(input.metadata || {})
      ]
    );

    return this.mapRow(result.rows[0]);
  }

  /**
   * List messages, oldest-first by default.
   *
   * The default suits a thread: a task's or a run's messages read from where the conversation began.
   * A feed wants the opposite end — `order: 'newest'` returns the most recent window — and the
   * direction is an argument because it used to be implied by the SQL alone: the dashboard asked for
   * `limit=100` against an always-ascending query, so it received the first 100 messages ever written
   * and could never show new activity no matter how often it re-fetched.
   */
  public async list(
    options: { taskId?: string; runId?: string; limit?: number; order?: 'oldest' | 'newest' } = {}
  ): Promise<MessageRecord[]> {
    const limit = Math.min(200, Math.max(1, Math.trunc(options.limit || 100)));
    const values: unknown[] = [];
    const filters: string[] = [];

    if (options.taskId) {
      values.push(options.taskId);
      filters.push(`task_id = $${values.length}`);
    }
    if (options.runId) {
      values.push(options.runId);
      filters.push(`run_id = $${values.length}`);
    }

    let sql = 'SELECT * FROM messages';
    if (filters.length > 0) sql += ` WHERE ${filters.join(' AND ')}`;
    values.push(limit);
    // `id` breaks ties so the window is deterministic when several messages share a millisecond.
    const direction = options.order === 'newest' ? 'DESC' : 'ASC';
    sql += ` ORDER BY created_at ${direction}, id ${direction} LIMIT $${values.length}`;

    const result = await this.db.query(sql, values);
    return result.rows.map(row => this.mapRow(row));
  }

  private mapRow(row: any): MessageRecord {
    if (!row) throw new Error('Message repository returned an empty row.');
    return {
      id: row.id,
      taskId: row.task_id || null,
      runId: row.run_id || null,
      senderType: row.sender_type,
      senderId: row.sender_id,
      recipientId: row.recipient_id || null,
      content: row.content,
      metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata || {},
      createdAt: row.created_at
    };
  }
}
