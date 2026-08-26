import { describe, expect, it, vi } from 'vitest';
import { MessageRepository, ToolCallRepository } from '../src/index.js';

describe('durable orchestration history repositories', () => {
  it('persists and maps a message record', async () => {
    const db = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            id: '123e4567-e89b-12d3-a456-426614174000',
            task_id: '123e4567-e89b-12d3-a456-426614174001',
            run_id: '123e4567-e89b-12d3-a456-426614174002',
            sender_type: 'agent',
            sender_id: 'ned',
            recipient_id: null,
            content: 'Research result',
            metadata: { turn: 1 },
            created_at: new Date().toISOString()
          }
        ]
      })
    } as any;
    const repository = new MessageRepository(db);

    const message = await repository.create({
      taskId: '123e4567-e89b-12d3-a456-426614174001',
      runId: '123e4567-e89b-12d3-a456-426614174002',
      senderType: 'agent',
      senderId: 'ned',
      content: 'Research result',
      metadata: { turn: 1 }
    });

    expect(message.senderId).toBe('ned');
    expect(message.metadata).toEqual({ turn: 1 });
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO messages'),
      expect.arrayContaining(['ned', 'Research result', JSON.stringify({ turn: 1 })])
    );
  });

  it('creates and completes a durable tool call', async () => {
    const db = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [
            {
              id: '123e4567-e89b-12d3-a456-426614174003',
              run_id: '123e4567-e89b-12d3-a456-426614174002',
              task_id: '123e4567-e89b-12d3-a456-426614174001',
              agent_id: 'ned',
              tool_name: 'memory.search',
              input: { query: 'gym' },
              output: null,
              error: null,
              duration_ms: null,
              risk_level: 'read',
              requires_approval: false,
              approval_id: null,
              status: 'pending',
              created_at: new Date().toISOString()
            }
          ]
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: '123e4567-e89b-12d3-a456-426614174003',
              run_id: '123e4567-e89b-12d3-a456-426614174002',
              task_id: '123e4567-e89b-12d3-a456-426614174001',
              agent_id: 'ned',
              tool_name: 'memory.search',
              input: { query: 'gym' },
              output: { results: [] },
              error: null,
              duration_ms: 12,
              risk_level: 'read',
              requires_approval: false,
              approval_id: null,
              status: 'success',
              created_at: new Date().toISOString()
            }
          ]
        })
    } as any;
    const repository = new ToolCallRepository(db);

    const created = await repository.create({
      runId: '123e4567-e89b-12d3-a456-426614174002',
      taskId: '123e4567-e89b-12d3-a456-426614174001',
      agentId: 'ned',
      toolName: 'memory.search',
      input: { query: 'gym' }
    });
    const completed = await repository.complete(created.id, {
      status: 'success',
      output: { results: [] },
      durationMs: 12
    });

    expect(created.status).toBe('pending');
    expect(completed?.status).toBe('success');
    expect(db.query).toHaveBeenLastCalledWith(expect.stringContaining('UPDATE tool_calls'), [
      '{"results":[]}',
      null,
      12,
      'success',
      null,
      '123e4567-e89b-12d3-a456-426614174003'
    ]);
  });
});
