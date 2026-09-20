import { describe, it, expect, vi } from 'vitest';
import { SDLCRepository } from '../src/repositories/sdlc.repository.js';

/**
 * The SDLC repository is the only place that can stop a phase from being executed twice, so
 * its compare-and-set contract is pinned here. These are SQL-shape assertions, consistent
 * with the rest of this package's suite (no live PostgreSQL on this host).
 */
function buildRepo(rows: any[] = []) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const db = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      return { rows };
    })
  } as any;
  return { repo: new SDLCRepository(db), calls };
}

const row = {
  id: '11111111-1111-1111-1111-111111111111',
  title: 'Initiative',
  intent: 'Intent',
  status: 'active',
  current_phase: 'inception',
  strategic_brief: {},
  technical_spec: {},
  budget_envelope: {},
  sprint_plan: {},
  qa_report: {},
  parent_task_id: null,
  phase_task_id: '22222222-2222-2222-2222-222222222222',
  phase_attempt: 3,
  artifacts: [],
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString()
};

describe('@atlas/database SDLCRepository', () => {
  it('attaches a phase task only when the phase still matches and no task is open', async () => {
    const { repo, calls } = buildRepo([row]);

    const result = await repo.attachPhaseTask(row.id, 'inception', row.phase_task_id);

    expect(result).not.toBeNull();
    expect(result?.phaseTaskId).toBe(row.phase_task_id);
    expect(result?.phaseAttempt).toBe(3);

    const sql = calls[0].sql.replace(/\s+/g, ' ');
    expect(sql).toContain('phase_task_id = $1');
    expect(sql).toContain('phase_attempt = phase_attempt + 1');
    expect(sql).toContain('current_phase = $3');
    expect(sql).toContain('phase_task_id IS NULL OR phase_task_id = $1');
  });

  it('returns null when the compare-and-set matches no row', async () => {
    const { repo } = buildRepo([]);

    const result = await repo.attachPhaseTask(row.id, 'inception', row.phase_task_id);

    expect(result).toBeNull();
  });

  it('looks an initiative up by the task that is running its phase', async () => {
    const { repo, calls } = buildRepo([row]);

    const found = await repo.findByPhaseTaskId(row.phase_task_id);

    expect(found?.id).toBe(row.id);
    expect(calls[0].sql).toContain('WHERE phase_task_id = $1');
    expect(calls[0].params).toEqual([row.phase_task_id]);
  });

  it('returns null when no initiative owns the task', async () => {
    const { repo } = buildRepo([]);
    expect(await repo.findByPhaseTaskId('33333333-3333-3333-3333-333333333333')).toBeNull();
  });

  it('clears the phase task when the initiative advances', async () => {
    const { repo, calls } = buildRepo([{ ...row, current_phase: 'architecture' }]);

    const advanced = await repo.advancePhase(row.id, 'architecture', { strategicBrief: { title: 'x' } as any });

    expect(advanced.currentPhase).toBe('architecture');

    const update = calls.find(call => call.sql.includes('UPDATE sdlc_initiatives'));
    expect(update).toBeDefined();
    expect(update!.sql.replace(/\s+/g, ' ')).toContain('phase_task_id = NULL');
  });
});
