import { WorkflowCheckpoint, WorkflowCheckpointSchema, WorkflowState, WorkflowTransition } from '@atlas/shared';
import { DatabaseClient } from '../client.js';

export interface WorkflowCheckpointUpsertInput {
  runId: string;
  taskId: string;
  agentId: string;
  stepId: string;
  state: WorkflowState;
  resumeAfter?: Date | null;
  payload?: Record<string, unknown>;
}

export class WorkflowCheckpointRepository {
  constructor(private db: DatabaseClient) {}

  public async upsert(input: WorkflowCheckpointUpsertInput): Promise<WorkflowCheckpoint> {
    const result = await this.db.query(
      `
      INSERT INTO workflow_checkpoints (
        run_id, task_id, agent_id, step_id, state, resume_after, payload
      ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
      ON CONFLICT (run_id, step_id) DO UPDATE
        SET state = EXCLUDED.state,
            resume_after = EXCLUDED.resume_after,
            payload = EXCLUDED.payload,
            updated_at = NOW()
      RETURNING *
    `,
      [input.runId, input.taskId, input.agentId, input.stepId, input.state, input.resumeAfter ?? null, JSON.stringify(input.payload ?? {})]
    );

    return this.mapRow(result.rows[0]);
  }

  public async appendTransition(runId: string, stepId: string, transition: WorkflowTransition): Promise<WorkflowCheckpoint | null> {
    const result = await this.db.query(
      `
      UPDATE workflow_checkpoints
      SET history = COALESCE(history, '[]'::jsonb) || $1::jsonb,
          updated_at = NOW()
      WHERE run_id = $2 AND step_id = $3
      RETURNING *
    `,
      [JSON.stringify([transition]), runId, stepId]
    );
    if (!result.rows[0]) return null;
    return this.mapRow(result.rows[0]);
  }

  public async findByRunAndStep(runId: string, stepId: string): Promise<WorkflowCheckpoint | null> {
    const result = await this.db.query('SELECT * FROM workflow_checkpoints WHERE run_id = $1 AND step_id = $2', [runId, stepId]);
    if (!result.rows[0]) return null;
    return this.mapRow(result.rows[0]);
  }

  public async listByRun(runId: string): Promise<WorkflowCheckpoint[]> {
    const result = await this.db.query('SELECT * FROM workflow_checkpoints WHERE run_id = $1 ORDER BY created_at ASC', [runId]);
    return result.rows.map(row => this.mapRow(row));
  }

  public async listResumable(now: Date, limit = 50): Promise<WorkflowCheckpoint[]> {
    const safeLimit = Math.min(500, Math.max(1, Math.trunc(limit)));
    const result = await this.db.query(
      `
      SELECT * FROM workflow_checkpoints
      WHERE state IN ('scheduled', 'paused', 'waiting_external_event')
        AND resume_after IS NOT NULL
        AND resume_after <= $1
      ORDER BY resume_after ASC
      LIMIT $2
    `,
      [now, safeLimit]
    );
    return result.rows.map(row => this.mapRow(row));
  }

  private mapRow(row: any): WorkflowCheckpoint {
    if (!row) throw new Error('Workflow checkpoint repository returned an empty row.');
    return WorkflowCheckpointSchema.parse({
      id: row.id,
      runId: row.run_id,
      taskId: row.task_id,
      agentId: row.agent_id,
      stepId: row.step_id,
      state: row.state,
      resumeAfter: row.resume_after,
      payload: this.parseJson(row.payload) || {},
      history: this.parseJson(row.history) || [],
      createdAt: row.created_at,
      updatedAt: row.updated_at
    });
  }

  private parseJson(value: unknown): any {
    return typeof value === 'string' ? JSON.parse(value) : value || null;
  }
}
