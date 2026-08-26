import { describe, expect, it, vi } from 'vitest';
import { MessageRepository } from '../src/repositories/message.repository.js';

describe('MessageRepository transaction support', () => {
  it('uses the supplied transaction executor for message creation', async () => {
    const db = { query: vi.fn() } as any;
    const transactionClient = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            id: '123e4567-e89b-12d3-a456-426614174001',
            task_id: '123e4567-e89b-12d3-a456-426614174000',
            run_id: null,
            sender_type: 'user',
            sender_id: 'api-owner',
            recipient_id: null,
            content: 'Persist this message atomically',
            metadata: {},
            created_at: new Date().toISOString()
          }
        ]
      })
    };
    const repository = new MessageRepository(db);

    await repository.create(
      {
        taskId: '123e4567-e89b-12d3-a456-426614174000',
        senderType: 'user',
        senderId: 'api-owner',
        content: 'Persist this message atomically'
      },
      '123e4567-e89b-12d3-a456-426614174001',
      transactionClient as any
    );

    expect(transactionClient.query).toHaveBeenCalledOnce();
    expect(db.query).not.toHaveBeenCalled();
  });
});
