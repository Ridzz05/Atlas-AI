import { DatabaseClient } from '../client.js';
import { Task, CreateTaskInput, TaskStatus, TaskPlan, TaskStatusSchema } from '@atlas/shared';

export interface TaskFilter {
  status?: TaskStatus;
  assignedAgent?: string;
  parentId?: string;
  limit?: number;
  offset?: number;
}

export class TaskRepository {
  constructor(private db: DatabaseClient) {}

  public async create(input: CreateTaskInput, id?: string): Promise<Task> {
    const taskId = id || crypto.randomUUID();
    const query = `
      INSERT INTO tasks (
        id, parent_id, title, goal, assigned_agent, priority, context, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'queued')
      RETURNING *;
    `;

    const res = await this.db.query(query, [
      taskId,
      input.parentId || null,
      input.title,
      input.goal,
      input.assignedAgent || 'chief',
      input.priority || 'normal',
      JSON.stringify(input.context || {})
    ]);

    return this.mapRow(res.rows[0]);
  }

  public async findById(id: string): Promise<Task | null> {
    const res = await this.db.query('SELECT * FROM tasks WHERE id = $1', [id]);
    if (!res.rows[0]) return null;
    return this.mapRow(res.rows[0]);
  }

  public async findByStatus(status: TaskStatus): Promise<Task[]> {
    const normalizedStatus = parseTaskStatus(status);
    const res = await this.db.query('SELECT * FROM tasks WHERE status = $1 ORDER BY created_at ASC', [normalizedStatus]);
    return res.rows.map(r => this.mapRow(r));
  }

  public async findChildren(parentId: string): Promise<Task[]> {
    const res = await this.db.query('SELECT * FROM tasks WHERE parent_id = $1 ORDER BY created_at ASC', [parentId]);
    return res.rows.map(r => this.mapRow(r));
  }

  public async updateStatus(id: string, status: TaskStatus, options?: { error?: string; result?: Record<string, unknown> }): Promise<Task> {
    const normalizedStatus = parseTaskStatus(status);
    const isTerminal = ['completed', 'failed', 'cancelled'].includes(normalizedStatus);
    const query = `
      UPDATE tasks
      SET status = $1,
          error = COALESCE($2, error),
          result = COALESCE($3, result),
          completed_at = CASE WHEN $4::boolean THEN NOW() ELSE completed_at END,
          updated_at = NOW()
      WHERE id = $5
      RETURNING *;
    `;

    const res = await this.db.query(query, [
      normalizedStatus,
      options?.error || null,
      options?.result ? JSON.stringify(options.result) : null,
      isTerminal,
      id
    ]);

    if (!res.rows[0]) {
      throw new Error(`Task not found: ${id}`);
    }

    return this.mapRow(res.rows[0]);
  }

  public async updatePlan(id: string, plan: TaskPlan): Promise<Task> {
    const query = `
      UPDATE tasks
      SET plan = $1,
          status = 'running',
          updated_at = NOW()
      WHERE id = $2
      RETURNING *;
    `;

    const res = await this.db.query(query, [JSON.stringify(plan), id]);
    if (!res.rows[0]) {
      throw new Error(`Task not found: ${id}`);
    }

    return this.mapRow(res.rows[0]);
  }

  public async list(filter: TaskFilter = {}): Promise<Task[]> {
    let sql = 'SELECT * FROM tasks WHERE 1=1';
    const params: any[] = [];

    if (filter.status) {
      params.push(parseTaskStatus(filter.status));
      sql += ` AND status = $${params.length}`;
    }

    if (filter.assignedAgent) {
      params.push(filter.assignedAgent);
      sql += ` AND assigned_agent = $${params.length}`;
    }

    if (filter.parentId) {
      params.push(filter.parentId);
      sql += ` AND parent_id = $${params.length}`;
    }

    sql += ' ORDER BY created_at DESC';

    if (filter.limit) {
      params.push(filter.limit);
      sql += ` LIMIT $${params.length}`;
    }

    if (filter.offset) {
      params.push(filter.offset);
      sql += ` OFFSET $${params.length}`;
    }

    const res = await this.db.query(sql, params);
    return res.rows.map(r => this.mapRow(r));
  }

  private mapRow(row: any): Task {
    const status = parsePersistedTaskStatus(row.status);
    return {
      id: row.id,
      parentId: row.parent_id,
      title: row.title,
      goal: row.goal,
      assignedAgent: row.assigned_agent,
      depth: Number(row.depth || 0),
      status,
      priority: row.priority,
      context: typeof row.context === 'string' ? JSON.parse(row.context) : row.context || {},
      plan: typeof row.plan === 'string' ? JSON.parse(row.plan) : row.plan,
      result: typeof row.result === 'string' ? JSON.parse(row.result) : row.result,
      error: row.error,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at
    };
  }
}

function parseTaskStatus(status: unknown): TaskStatus {
  const result = TaskStatusSchema.safeParse(status);
  if (!result.success) throw new Error(`Invalid task status: ${String(status)}`);
  return result.data;
}

function parsePersistedTaskStatus(status: unknown): TaskStatus {
  const result = TaskStatusSchema.safeParse(status);
  if (!result.success) throw new Error(`Invalid persisted task status: ${String(status)}`);
  return result.data;
}
