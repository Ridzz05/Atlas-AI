import { describe, expect, it, vi } from 'vitest';
import { TaskRepository } from '../src/repositories/task.repository.js';

describe('TaskRepository status integrity', () => {
  it('rejects an invalid task status before writing to the database', async () => {
    const db = { query: vi.fn() } as any;
    const repository = new TaskRepository(db);

    await expect(repository.updateStatus('123e4567-e89b-12d3-a456-426614174000', 'timed_out' as any)).rejects.toThrow(
      'Invalid task status'
    );
    expect(db.query).not.toHaveBeenCalled();
  });

  it('uses the supplied transaction executor for task creation', async () => {
    const db = { query: vi.fn() } as any;
    const transactionClient = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            id: '123e4567-e89b-12d3-a456-426614174000',
            parent_id: null,
            title: 'Atomic task',
            goal: 'Persist task and message together',
            assigned_agent: 'chief',
            depth: 0,
            status: 'queued',
            priority: 'normal',
            context: {},
            plan: null,
            result: null,
            error: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            completed_at: null
          }
        ]
      })
    };
    const repository = new TaskRepository(db);

    await repository.create(
      { title: 'Atomic task', goal: 'Persist task and message together', assignedAgent: 'chief' },
      '123e4567-e89b-12d3-a456-426614174000',
      transactionClient as any
    );

    expect(transactionClient.query).toHaveBeenCalledOnce();
    expect(db.query).not.toHaveBeenCalled();
  });
});
