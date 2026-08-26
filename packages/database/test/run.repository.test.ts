import { describe, expect, it, vi } from 'vitest';
import { RunRepository } from '../src/index.js';

describe('RunRepository cancellation state', () => {
  it('records a cancellation request durably for an active run', async () => {
    const db = {
      query: vi.fn().mockResolvedValue({ rows: [{
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
      }] })
    } as any;
    const repository = new RunRepository(db);

    const run = await repository.requestCancellation(
      '123e4567-e89b-12d3-a456-426614174000',
      'owner stop'
    );

    expect(run?.cancelRequested).toBe(true);
    expect(run?.cancelReason).toBe('owner stop');
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('cancel_requested = TRUE'),
      ['owner stop', '123e4567-e89b-12d3-a456-426614174000']
    );
  });

  it('returns durable cancellation requests for a task', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rowCount: 2, rows: [] }) } as any;
    const repository = new RunRepository(db);

    await expect(repository.requestCancellationForTask(
      '123e4567-e89b-12d3-a456-426614174001',
      'emergency stop'
    )).resolves.toBe(2);

    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE task_id = $2'),
      ['emergency stop', '123e4567-e89b-12d3-a456-426614174001']
    );
  });

  it('preserves a pending cancellation when a worker tries to complete the run', async () => {
    const db = {
      query: vi.fn().mockResolvedValue({ rows: [{
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
      }] })
    } as any;
    const repository = new RunRepository(db);

    const run = await repository.updateStatus(
      '123e4567-e89b-12d3-a456-426614174000',
      'completed'
    );

    expect(run.status).toBe('cancelled');
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining("WHEN $1 = 'completed' AND cancel_requested"),
      ['completed', null, true, '123e4567-e89b-12d3-a456-426614174000']
    );
  });
});
