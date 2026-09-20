import { describe, expect, it, vi } from 'vitest';
import { RunRepository } from '../src/index.js';

const runId = '123e4567-e89b-12d3-a456-426614174000';

function runRow(overrides: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  return {
    id: runId,
    task_id: '123e4567-e89b-12d3-a456-426614174001',
    agent_id: 'chief',
    status: 'active',
    cancel_requested: false,
    cancel_reason: null,
    input_tokens: 0,
    output_tokens: 0,
    cost_usd: 0,
    turns_count: 0,
    started_at: now,
    ended_at: null,
    error: null,
    created_at: now,
    updated_at: now,
    ...overrides
  };
}

describe('RunRepository cancellation state', () => {
  it('returns durable aggregate cost metrics by period and agent', async () => {
    const db = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [
            {
              period_cost_usd: '0.1200',
              total_cost_usd: '1.2500',
              run_count: '4',
              active_run_count: '1',
              completed_run_count: '2',
              failed_run_count: '1'
            }
          ]
        })
        .mockResolvedValueOnce({
          rows: [
            { agent_id: 'ned', period_cost_usd: '0.6000', cost_usd: '0.8000', run_count: '2' },
            { agent_id: 'argus', period_cost_usd: '0.1200', cost_usd: '0.4500', run_count: '2' }
          ]
        })
    } as any;
    const repository = new RunRepository(db);

    const summary = await repository.getCostSummary(new Date('2026-08-26T10:00:00.000Z'));

    expect(summary).toMatchObject({
      periodCostUsd: 0.12,
      totalCostUsd: 1.25,
      runCount: 4,
      activeRunCount: 1,
      completedRunCount: 2,
      failedRunCount: 1,
      byAgent: [
        { agentId: 'ned', periodCostUsd: 0.6, costUsd: 0.8, runCount: 2 },
        { agentId: 'argus', periodCostUsd: 0.12, costUsd: 0.45, runCount: 2 }
      ]
    });
    expect(summary.periodStart).toBe('2026-08-26T00:00:00.000Z');
    expect(summary.periodEnd).toBe('2026-08-27T00:00:00.000Z');
  });

  it('returns durable worker lease telemetry', async () => {
    const db = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            active_lease_count: '2',
            expired_lease_count: '1',
            unleased_executable_run_count: '3',
            cancellation_requested_count: '1'
          }
        ]
      })
    } as any;
    const repository = new RunRepository(db);

    const summary = await repository.getLeaseSummary(new Date('2026-08-26T10:00:00.000Z'));

    expect(summary).toEqual({
      checkedAt: '2026-08-26T10:00:00.000Z',
      activeLeaseCount: 2,
      expiredLeaseCount: 1,
      unleasedExecutableRunCount: 3,
      cancellationRequestedCount: 1
    });
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('lease_expires_at < $1'), ['2026-08-26T10:00:00.000Z']);
  });

  it('records a cancellation request durably for an active run', async () => {
    const db = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            id: '123e4567-e89b-12d3-a456-426614174000',
            task_id: '123e4567-e89b-12d3-a456-426614174001',
            agent_id: 'chief',
            status: 'active',
            cancel_requested: true,
            cancel_reason: 'owner stop',
            input_tokens: 0,
            output_tokens: 0,
            cost_usd: 0,
            turns_count: 0,
            started_at: new Date().toISOString(),
            ended_at: null,
            error: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          }
        ]
      })
    } as any;
    const repository = new RunRepository(db);

    const run = await repository.requestCancellation('123e4567-e89b-12d3-a456-426614174000', 'owner stop');

    expect(run?.cancelRequested).toBe(true);
    expect(run?.cancelReason).toBe('owner stop');
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('cancel_requested = TRUE'), [
      'owner stop',
      '123e4567-e89b-12d3-a456-426614174000'
    ]);
  });

  it('returns durable cancellation requests for a task', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rowCount: 2, rows: [] }) } as any;
    const repository = new RunRepository(db);

    await expect(repository.requestCancellationForTask('123e4567-e89b-12d3-a456-426614174001', 'emergency stop')).resolves.toBe(2);

    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('WHERE task_id = $2'), [
      'emergency stop',
      '123e4567-e89b-12d3-a456-426614174001'
    ]);
  });

  it('preserves a pending cancellation when a worker tries to complete the run', async () => {
    const db = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            id: '123e4567-e89b-12d3-a456-426614174000',
            task_id: '123e4567-e89b-12d3-a456-426614174001',
            agent_id: 'chief',
            status: 'cancelled',
            cancel_requested: true,
            cancel_reason: 'remote stop',
            input_tokens: 0,
            output_tokens: 0,
            cost_usd: 0,
            turns_count: 0,
            started_at: new Date().toISOString(),
            ended_at: new Date().toISOString(),
            error: 'remote stop',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          }
        ]
      })
    } as any;
    const repository = new RunRepository(db);

    const run = await repository.updateStatus('123e4567-e89b-12d3-a456-426614174000', 'completed');

    expect(run.status).toBe('cancelled');
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining("WHEN $1 = 'completed' AND cancel_requested"), [
      'completed',
      null,
      true,
      '123e4567-e89b-12d3-a456-426614174000',
      null
    ]);
    // The query carries the lease guard: a run owned by another worker must not be touched.
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('worker_id IS NULL OR worker_id = $5'), expect.anything());
  });

  it('acquires a worker lease atomically for an executable run', async () => {
    const db = {
      query: vi.fn().mockResolvedValue({ rows: [runRow({ worker_id: 'worker-a' })] })
    } as any;
    const repository = new RunRepository(db);

    const run = await repository.acquireLease(runId, 'worker-a', 60);

    expect(run?.id).toBe(runId);
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('lease_expires_at = NOW() + ($3 * INTERVAL'), [runId, 'worker-a', 60]);
  });

  it('sees a task-level cancel through the runs of the task and of its children', async () => {
    // An orchestrator task has no Run row of its own, so a cancel aimed at it is only visible
    // through its children's runs. Without the join an emergency stop left the whole
    // delegation graph running to completion.
    const db = {
      query: vi.fn().mockResolvedValue({ rows: [{ cancel_reason: 'emergency stop' }] })
    } as any;
    const repository = new RunRepository(db);

    const cancellation = await repository.isCancellationRequestedForTask('parent-task-id');

    expect(cancellation.requested).toBe(true);
    expect(cancellation.reason).toBe('emergency stop');
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('t.parent_id = $1'), ['parent-task-id']);
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('r.cancel_requested = TRUE'), expect.anything());
  });

  it('reports no task-level cancellation when no run asked for one', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) } as any;
    const repository = new RunRepository(db);

    const cancellation = await repository.isCancellationRequestedForTask('parent-task-id');

    expect(cancellation.requested).toBe(false);
    expect(cancellation.reason).toBeUndefined();
  });

  it('recovers runs that hold no lease at all, and only after they go stale', async () => {
    // The leak: the sweep required `lease_expires_at IS NOT NULL`, so a run left in an active
    // status whose lease was never acquired was immortal. Its task then looked like it had an
    // active run, so the orphan-task sweep skipped it too, and the task stayed 'running'
    // forever across restarts. The time guard keeps a freshly started task from being killed
    // between "task -> running" and "run created".
    const db = { query: vi.fn().mockResolvedValue({ rowCount: 0, rows: [] }) } as any;
    const repository = new RunRepository(db);

    await repository.recoverStaleRuns();

    const runSweep = db.query.mock.calls[0][0] as string;
    expect(runSweep).toContain('lease_expires_at < NOW()');
    expect(runSweep).toContain('lease_expires_at IS NULL');
    expect(runSweep).toContain('updated_at < NOW()');

    const taskSweep = db.query.mock.calls[1][0] as string;
    expect(taskSweep).toContain("status IN ('running', 'planning')");
    expect(taskSweep).toContain('NOT EXISTS');
    expect(taskSweep).toContain('updated_at < NOW()');
  });

  it('renews only an owned worker lease', async () => {
    const db = {
      query: vi.fn().mockResolvedValue({ rowCount: 1, rows: [] })
    } as any;
    const repository = new RunRepository(db);

    await expect(repository.heartbeat(runId, 'worker-a', 60)).resolves.toBe(true);

    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('AND worker_id = $2'), [runId, 'worker-a', 60]);
  });

  it('releases a worker lease without changing run status', async () => {
    const db = {
      query: vi.fn().mockResolvedValue({ rowCount: 1, rows: [] })
    } as any;
    const repository = new RunRepository(db);

    await expect(repository.releaseLease(runId, 'worker-a')).resolves.toBe(true);

    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('worker_id = NULL'), [runId, 'worker-a']);
  });

  it('marks expired executable runs failed during worker recovery', async () => {
    const db = {
      query: vi.fn().mockResolvedValue({ rowCount: 2, rows: [] })
    } as any;
    const repository = new RunRepository(db);

    await expect(repository.recoverStaleRuns('worker lease expired')).resolves.toBe(2);

    expect(db.query).toHaveBeenCalledWith(expect.stringContaining("status = 'failed'"), ['worker lease expired', 900]);
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('lease_expires_at < NOW()'), ['worker lease expired', 900]);
  });
});
