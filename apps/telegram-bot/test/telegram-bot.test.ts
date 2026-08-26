import { describe, it, expect, vi } from 'vitest';
import { AtlasTelegramBot } from '../src/bot.js';
import { ApprovalCardRenderer } from '../src/cards/approval-card.js';
import { defaultAgentRegistry } from '@atlas/agents';
import { ApprovalRequest } from '@atlas/shared';
import { TelegramApiClient } from '../src/bot.js';

describe('@atlas/telegram-bot tests', () => {
  const allowedUser = 12345678;
  const unauthorizedUser = 99999999;

  const bot = new AtlasTelegramBot({
    config: {
      botToken: 'mock-token',
      allowedUserIds: new Set(['12345678']),
      isPolling: true
    },
    registry: defaultAgentRegistry
  });

  it('rejects unauthorized users', async () => {
    const update = {
      update_id: 101,
      message: {
        message_id: 1,
        from: { id: unauthorizedUser, is_bot: false, first_name: 'Attacker' },
        chat: { id: unauthorizedUser, type: 'private' },
        text: '/agents',
        date: Math.floor(Date.now() / 1000)
      }
    };

    const result = await bot.processUpdate(update);
    expect(result.responseText).toContain('not authorized');
  });

  it('deduplicates repeat updates', async () => {
    const update = {
      update_id: 102,
      message: {
        message_id: 2,
        from: { id: allowedUser, is_bot: false, first_name: 'Owner' },
        chat: { id: allowedUser, type: 'private' },
        text: '/help',
        date: Math.floor(Date.now() / 1000)
      }
    };

    const first = await bot.processUpdate(update);
    expect(first.responseText).toContain('ATLAS AI OS');

    // Second call with same update_id should be ignored
    const second = await bot.processUpdate(update);
    expect(second.ignored).toBe(true);
  });

  it('uses a durable update claim store when one is configured', async () => {
    const claimed = new Set<number>();
    const stateRepo = {
      claimUpdate: vi.fn(async (updateId: number) => {
        if (claimed.has(updateId)) return false;
        claimed.add(updateId);
        return true;
      })
    } as any;
    const durableBot = new AtlasTelegramBot({
      config: {
        botToken: 'mock-token',
        allowedUserIds: new Set(['12345678']),
        isPolling: true
      },
      registry: defaultAgentRegistry,
      stateRepo
    });
    const update = {
      update_id: 105,
      message: {
        message_id: 5,
        from: { id: allowedUser, is_bot: false, first_name: 'Owner' },
        chat: { id: allowedUser, type: 'private' },
        text: '/agents',
        date: Math.floor(Date.now() / 1000)
      }
    };

    await durableBot.processUpdate(update);
    const duplicate = await durableBot.processUpdate(update);

    expect(duplicate.ignored).toBe(true);
    expect(stateRepo.claimUpdate).toHaveBeenCalledTimes(2);
  });

  it('handles /agents command correctly', async () => {
    const update = {
      update_id: 103,
      message: {
        message_id: 3,
        from: { id: allowedUser, is_bot: false, first_name: 'Owner' },
        chat: { id: allowedUser, type: 'private' },
        text: '/agents',
        date: Math.floor(Date.now() / 1000)
      }
    };

    const result = await bot.processUpdate(update);
    expect(result.responseText).toContain('ATLAS Core Agent Roster');
    expect(result.responseText).toContain('Chief');
    expect(result.responseText).toContain('Ned');
    expect(result.responseText).toContain('Argus');
  });

  it('handles natural language message as task creation', async () => {
    const update = {
      update_id: 104,
      message: {
        message_id: 4,
        from: { id: allowedUser, is_bot: false, first_name: 'Owner' },
        chat: { id: allowedUser, type: 'private' },
        text: 'Cari 10 prospek gym di Palembang',
        date: Math.floor(Date.now() / 1000)
      }
    };

    const result = await bot.processUpdate(update);
    expect(result.responseText).toContain('Task Created Successfully');
    expect(result.responseText).toContain('Cari 10 prospek gym di Palembang');
  });

  it('handles /emergency_stop without LLM', async () => {
    const update = {
      update_id: 105,
      message: {
        message_id: 5,
        from: { id: allowedUser, is_bot: false, first_name: 'Owner' },
        chat: { id: allowedUser, type: 'private' },
        text: '/emergency_stop',
        date: Math.floor(Date.now() / 1000)
      }
    };

    const result = await bot.processUpdate(update);
    expect(result.responseText).toContain('EMERGENCY STOP ACTIVATED');
  });

  it('routes Telegram stop and emergency stop to durable run cancellation', async () => {
    const runRepo = {
      requestCancellationForTask: vi.fn().mockResolvedValue(1),
      requestCancellationForActive: vi.fn().mockResolvedValue(3)
    } as any;
    const stateRepo = {
      claimUpdate: vi.fn().mockResolvedValue(true),
      setEmergencyStop: vi.fn().mockResolvedValue({
        paused: true,
        emergencyStop: true,
        updatedBy: '12345678',
        updatedAt: new Date()
      })
    } as any;
    const durableControlBot = new AtlasTelegramBot({
      config: {
        botToken: 'mock-token',
        allowedUserIds: new Set(['12345678']),
        isPolling: true
      },
      registry: defaultAgentRegistry,
      runRepo,
      stateRepo
    });

    await durableControlBot.processUpdate({
      update_id: 107,
      message: {
        message_id: 7,
        from: { id: allowedUser, is_bot: false, first_name: 'Owner' },
        chat: { id: allowedUser, type: 'private' },
        text: '/stop 123e4567-e89b-12d3-a456-426614174000',
        date: Math.floor(Date.now() / 1000)
      }
    });
    await durableControlBot.processUpdate({
      update_id: 108,
      message: {
        message_id: 8,
        from: { id: allowedUser, is_bot: false, first_name: 'Owner' },
        chat: { id: allowedUser, type: 'private' },
        text: '/emergency_stop',
        date: Math.floor(Date.now() / 1000)
      }
    });

    expect(runRepo.requestCancellationForTask).toHaveBeenCalledWith(
      '123e4567-e89b-12d3-a456-426614174000',
      'Stopped by user via Telegram command'
    );
    expect(runRepo.requestCancellationForActive).toHaveBeenCalledWith(
      'Emergency stop activated by Telegram owner'
    );
  });

  it('handles inline keyboard callback for approvals', async () => {
    const callbackUpdate = {
      update_id: 106,
      callback_query: {
        id: 'cq-1',
        from: { id: allowedUser, first_name: 'Owner' },
        data: 'approve:req-12345'
      }
    };

    const result = await bot.processUpdate(callbackUpdate);
    expect(result.responseText).toContain('Approval control plane is not configured');
    expect(result.responseText).toContain('req-12345');
  });

  it('renders approval cards with action buttons', () => {
    const req: ApprovalRequest = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      taskId: '123e4567-e89b-12d3-a456-426614174000',
      runId: '123e4567-e89b-12d3-a456-426614174000',
      agentId: 'hermes',
      action: 'communication.send_approved',
      target: '+628123456789',
      payload: { body: 'Hello Gym Owner' },
      payloadHash: 'hash123',
      reason: 'Outreach campaign for qualified gym lead',
      riskLevel: 'high',
      status: 'pending',
      requestedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      decidedAt: null,
      decidedBy: null,
      decisionNote: null
    };

    const card = ApprovalCardRenderer.render(req);
    expect(card.text).toContain('HUMAN APPROVAL REQUIRED');
    expect(card.text).toContain('communication.send_approved');
    expect(card.replyMarkup.inline_keyboard[0]?.length).toBe(3);
    expect(card.replyMarkup.inline_keyboard[0]?.[0]?.text).toContain('Approve');
    expect(card.replyMarkup.inline_keyboard[0]?.[1]?.text).toContain('Reject');
  });

  it('polls Telegram, sends responses, acknowledges callbacks, and stops cleanly', async () => {
    const update = {
      update_id: 200,
      message: {
        message_id: 10,
        from: { id: allowedUser, is_bot: false, first_name: 'Owner' },
        chat: { id: allowedUser, type: 'private' },
        text: '/help',
        date: Math.floor(Date.now() / 1000)
      }
    };
    const sentMessages: Array<{ chatId: number; text: string }> = [];
    const acknowledged: string[] = [];
    let polls = 0;
    const api: TelegramApiClient = {
      async getUpdates(_offset, _timeoutSeconds, signal) {
        polls += 1;
        if (polls === 1) return [update];
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, 25);
          signal.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new Error('aborted'));
          }, { once: true });
        });
        return [];
      },
      async sendMessage(chatId, text) {
        sentMessages.push({ chatId, text });
      },
      async answerCallbackQuery(callbackQueryId) {
        acknowledged.push(callbackQueryId);
      }
    };

    const transportBot = new AtlasTelegramBot({
      config: {
        botToken: 'mock-token',
        allowedUserIds: new Set(['12345678']),
        isPolling: true
      },
      registry: defaultAgentRegistry,
      apiClient: api,
      pollTimeoutSeconds: 1
    });

    await transportBot.start();
    await new Promise(resolve => setTimeout(resolve, 10));
    await transportBot.stop();

    expect(polls).toBeGreaterThan(0);
    expect(sentMessages[0]?.chatId).toBe(allowedUser);
    expect(sentMessages[0]?.text).toContain('ATLAS AI OS');
    expect(acknowledged).toEqual([]);
  });

  it('fails to start polling without a bot token', async () => {
    const invalidBot = new AtlasTelegramBot({
      config: {
        botToken: '',
        allowedUserIds: new Set(['12345678']),
        isPolling: true
      },
      registry: defaultAgentRegistry,
      apiClient: {
        getUpdates: async () => [],
        sendMessage: async () => undefined,
        answerCallbackQuery: async () => undefined
      }
    });

    await expect(invalidBot.start()).rejects.toThrow('TELEGRAM_BOT_TOKEN');
  });

  it('records approval decisions through the durable repository', async () => {
    const approvalRepo = {
      decide: vi.fn(async (id: string, status: string, decidedBy: string, note?: string) => ({
        id,
        status,
        decidedBy,
        decisionNote: note || null
      }))
    } as any;
    const approvalBot = new AtlasTelegramBot({
      config: {
        botToken: 'mock-token',
        allowedUserIds: new Set(['12345678']),
        isPolling: true
      },
      registry: defaultAgentRegistry,
      approvalRepo
    });

    const result = await approvalBot.processUpdate({
      update_id: 201,
      message: {
        message_id: 11,
        from: { id: allowedUser, is_bot: false, first_name: 'Owner' },
        chat: { id: allowedUser, type: 'private' },
        text: '/approve approval-1',
        date: Math.floor(Date.now() / 1000)
      }
    });

    expect(result.responseText).toContain('recorded as APPROVED');
    expect(approvalRepo.decide).toHaveBeenCalledWith('approval-1', 'approved', '12345678');
  });
});
