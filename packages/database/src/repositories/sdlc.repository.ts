import { DatabaseClient } from '../client.js';
import { SDLCInitiative, SDLCPhase, StrategicBrief, TechnicalSpec, BudgetEnvelope, SprintPlan, QAReport } from '@atlas/shared';

export interface CreateSDLCInitiativeParams {
  id?: string;
  title: string;
  intent: string;
  parentTaskId?: string;
  strategicBrief?: StrategicBrief;
}

export interface UpdateSDLCPhaseParams {
  strategicBrief?: StrategicBrief;
  technicalSpec?: TechnicalSpec;
  budgetEnvelope?: BudgetEnvelope;
  sprintPlan?: SprintPlan;
  qaReport?: QAReport;
  status?: 'active' | 'paused' | 'completed' | 'failed';
  artifacts?: string[];
}

export class SDLCRepository {
  constructor(private db: DatabaseClient) {}

  public async create(params: CreateSDLCInitiativeParams): Promise<SDLCInitiative> {
    const id = params.id || crypto.randomUUID();
    const query = `
      INSERT INTO sdlc_initiatives (
        id, title, intent, parent_task_id, strategic_brief, status, current_phase
      ) VALUES ($1, $2, $3, $4, $5, 'active', 'inception')
      RETURNING *;
    `;

    const res = await this.db.query(query, [
      id,
      params.title,
      params.intent,
      params.parentTaskId || null,
      JSON.stringify(params.strategicBrief || {})
    ]);

    return this.mapRow(res.rows[0]);
  }

  public async findById(id: string): Promise<SDLCInitiative | null> {
    const res = await this.db.query('SELECT * FROM sdlc_initiatives WHERE id = $1', [id]);
    if (!res.rows[0]) return null;
    return this.mapRow(res.rows[0]);
  }

  /**
   * Reverse lookup used when a task reaches a terminal state: which initiative (if any) is
   * waiting on this task. Returns null for ordinary tasks.
   */
  public async findByPhaseTaskId(taskId: string): Promise<SDLCInitiative | null> {
    const res = await this.db.query('SELECT * FROM sdlc_initiatives WHERE phase_task_id = $1', [taskId]);
    if (!res.rows[0]) return null;
    return this.mapRow(res.rows[0]);
  }

  public async list(options: { status?: string; limit?: number; offset?: number } = {}): Promise<SDLCInitiative[]> {
    const limit = options.limit || 50;
    const offset = options.offset || 0;
    let query = 'SELECT * FROM sdlc_initiatives';
    const params: any[] = [];

    if (options.status) {
      query += ' WHERE status = $1';
      params.push(options.status);
      query += ` ORDER BY created_at DESC LIMIT $2 OFFSET $3`;
      params.push(limit, offset);
    } else {
      query += ` ORDER BY created_at DESC LIMIT $1 OFFSET $2`;
      params.push(limit, offset);
    }

    const res = await this.db.query(query, params);
    return res.rows.map(r => this.mapRow(r));
  }

  /**
   * Attach the task that will execute `phase`, as a compare-and-set on the current phase.
   *
   * Returns null when the initiative has already moved on (or already has an open phase
   * task), which is how two concurrent `advance` calls are prevented from enqueueing the
   * same phase twice. The previous implementation read the phase and then updated without
   * a precondition, so both callers could spend provider tokens on the same phase.
   */
  public async attachPhaseTask(id: string, phase: SDLCPhase, taskId: string): Promise<SDLCInitiative | null> {
    const query = `
      UPDATE sdlc_initiatives
      SET phase_task_id = $1, phase_attempt = phase_attempt + 1, updated_at = NOW()
      WHERE id = $2 AND current_phase = $3
        AND (phase_task_id IS NULL OR phase_task_id = $1)
      RETURNING *;
    `;

    const res = await this.db.query(query, [taskId, id, phase]);
    if (!res.rows[0]) return null;
    return this.mapRow(res.rows[0]);
  }

  /**
   * Move the initiative to `nextPhase`. Clears `phase_task_id` because the phase that just
   * finished is no longer running; the caller attaches the next phase's task separately.
   */
  public async advancePhase(id: string, nextPhase: SDLCPhase, updates: UpdateSDLCPhaseParams = {}): Promise<SDLCInitiative> {
    const current = await this.findById(id);
    if (!current) {
      throw new Error(`SDLC Initiative not found: ${id}`);
    }

    const strategicBrief = updates.strategicBrief || current.strategicBrief;
    const technicalSpec = updates.technicalSpec || current.technicalSpec;
    const budgetEnvelope = updates.budgetEnvelope || current.budgetEnvelope;
    const sprintPlan = updates.sprintPlan || current.sprintPlan;
    const qaReport = updates.qaReport || current.qaReport;
    const status = updates.status || (nextPhase === 'completed' ? 'completed' : nextPhase === 'failed' ? 'failed' : current.status);
    const artifacts = updates.artifacts ? [...current.artifacts, ...updates.artifacts] : current.artifacts;

    const query = `
      UPDATE sdlc_initiatives
      SET
        current_phase = $1,
        status = $2,
        strategic_brief = $3,
        technical_spec = $4,
        budget_envelope = $5,
        sprint_plan = $6,
        qa_report = $7,
        artifacts = $8,
        phase_task_id = NULL,
        updated_at = NOW()
      WHERE id = $9
      RETURNING *;
    `;

    const res = await this.db.query(query, [
      nextPhase,
      status,
      JSON.stringify(strategicBrief || {}),
      JSON.stringify(technicalSpec || {}),
      JSON.stringify(budgetEnvelope || {}),
      JSON.stringify(sprintPlan || {}),
      JSON.stringify(qaReport || {}),
      JSON.stringify(artifacts),
      id
    ]);

    return this.mapRow(res.rows[0]);
  }

  private mapRow(row: any): SDLCInitiative {
    return {
      id: row.id,
      title: row.title,
      intent: row.intent,
      status: row.status,
      currentPhase: row.current_phase,
      strategicBrief: Object.keys(row.strategic_brief || {}).length > 0 ? row.strategic_brief : undefined,
      technicalSpec: Object.keys(row.technical_spec || {}).length > 0 ? row.technical_spec : undefined,
      budgetEnvelope: Object.keys(row.budget_envelope || {}).length > 0 ? row.budget_envelope : undefined,
      sprintPlan: Object.keys(row.sprint_plan || {}).length > 0 ? row.sprint_plan : undefined,
      qaReport: Object.keys(row.qa_report || {}).length > 0 ? row.qa_report : undefined,
      parentTaskId: row.parent_task_id || undefined,
      phaseTaskId: row.phase_task_id || undefined,
      phaseAttempt: typeof row.phase_attempt === 'number' ? row.phase_attempt : 0,
      artifacts: Array.isArray(row.artifacts) ? row.artifacts : [],
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString()
    };
  }
}
