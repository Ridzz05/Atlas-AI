import { describe, expect, it, vi } from 'vitest';
import { TaskRepository } from '../src/repositories/task.repository.js';

describe('TaskRepository status integrity', () => {
  it('rejects an invalid task status before writing to the database', async () => {
    const db = { query: vi.fn() } as any;
    const repository = new TaskRepository(db);

    await expect(
      repository.updateStatus('123e4567-e89b-12d3-a456-426614174000', 'timed_out' as any)
    ).rejects.toThrow('Invalid task status');
    expect(db.query).not.toHaveBeenCalled();
  });
});
