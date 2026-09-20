import { describe, it, expect, vi } from 'vitest';
import { AtlasTelegramBot } from '../src/bot.js';
import { ApprovalCardRenderer } from '../src/cards/approval-card.js';
import { defaultAgentRegistry } from '@atlas/agents';
import { ApprovalRequest } from '@atlas/shared';
import { TelegramApiClient } from '../src/bot.js';
import { InMemoryTaskQueue } from '@atlas/orchestration';

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

  it('handles /initiatives and /initiative commands via SDLC repository', async () => {
    const mockSdlcRepo = {
      list: vi.fn().mockResolvedValue([
        {
          id: 'init-sdlc-12345678',
          title: 'SaaS Market Expansion',
          currentPhase: 'inception',
          status: 'in_progress',
          createdAt: new Date().toISOString(),
          strategicBrief: { title: 'Strategic Brief' }
        }
      ]),
      findById: vi.fn().mockResolvedValue({
        id: 'init-sdlc-12345678',
        title: 'SaaS Market Expansion',
        currentPhase: 'inception',
        status: 'in_progress',
        createdAt: new Date().toISOString(),
        strategicBrief: { title: 'Strategic Brief' }
      })
    } as any;

    const sdlcBot = new AtlasTelegramBot({
      config: {
        botToken: 'mock-token',
        allowedUserIds: new Set(['12345678']),
        isPolling: true
      },
      registry: defaultAgentRegistry,
      sdlcRepo: mockSdlcRepo
    });

    const listResult = await sdlcBot.processUpdate({
      update_id: 104,
      message: {
        message_id: 4,
        from: { id: allowedUser, is_bot: false, first_name: 'Owner' },
        chat: { id: allowedUser, type: 'private' },
        text: '/initiatives',
        date: Math.floor(Date.now() / 1000)
      }
    });

    expect(listResult.responseText).toContain('Executive SDLC Initiatives');
    expect(listResult.responseText).toContain('SaaS Market Expansion');
    expect(listResult.responseText).toContain('inception');

    const detailResult = await sdlcBot.processUpdate({
      update_id: 105,
      message: {
        message_id: 5,
        from: { id: allowedUser, is_bot: false, first_name: 'Owner' },
        chat: { id: allowedUser, type: 'private' },
        text: '/initiative init-sdlc-12345678',
        date: Math.floor(Date.now() / 1000)
      }
    });

    expect(detailResult.responseText).toContain('Initiative Detail');
    expect(detailResult.responseText).toContain('SaaS Market Expansion');
    expect(detailResult.responseText).toContain('Strategic Brief (CEO)');
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

  it('reports durable cost and budget telemetry instead of hardcoded estimates', async () => {
    const runRepo = {
      getCostSummary: vi.fn().mockResolvedValue({
        periodStart: '2026-08-26T00:00:00.000Z',
        periodEnd: '2026-08-27T00:00:00.000Z',
        periodCostUsd: 2.5,
        totalCostUsd: 9.75,
        runCount: 12,
        activeRunCount: 2,
        completedRunCount: 8,
        failedRunCount: 2,
        byAgent: []
      })
    } as any;
    const budgetRepo = {
      getGlobalDailySummary: vi.fn().mockResolvedValue({
        limitUsd: 5,
        usedUsd: 2.5,
        reservedUsd: 0.75,
        availableUsd: 1.75,
        resetAt: '2026-08-27T00:00:00.000Z'
      })
    } as any;
    const costBot = new AtlasTelegramBot({
      config: {
        botToken: 'mock-token',
        allowedUserIds: new Set(['12345678']),
        isPolling: true
      },
      registry: defaultAgentRegistry,
      runRepo,
      budgetRepo
    });

    const result = await costBot.processUpdate({
      update_id: 109,
      message: {
        message_id: 9,
        from: { id: allowedUser, is_bot: false, first_name: 'Owner' },
        chat: { id: allowedUser, type: 'private' },
        text: '/cost',
        date: Math.floor(Date.now() / 1000)
      }
    });

    expect(result.responseText).toContain('$5.0000');
    expect(result.responseText).toContain('$2.5000');
    expect(result.responseText).toContain('$1.7500');
    expect(result.responseText).toContain('$9.7500');
    expect(result.responseText).not.toContain('$0.1200');
    expect(runRepo.getCostSummary).toHaveBeenCalledTimes(1);
    expect(budgetRepo.getGlobalDailySummary).toHaveBeenCalledTimes(1);
  });

  it('does not invent cost telemetry when durable repositories are unavailable', async () => {
    const result = await bot.processUpdate({
      update_id: 110,
      message: {
        message_id: 10,
        from: { id: allowedUser, is_bot: false, first_name: 'Owner' },
        chat: { id: allowedUser, type: 'private' },
        text: '/cost',
        date: Math.floor(Date.now() / 1000)
      }
    });

    expect(result.responseText).toContain('Cost telemetry unavailable');
    expect(result.responseText).not.toContain('$0.12');
  });

  it('includes planning and approval-pending tasks in durable status', async () => {
    const tasksByStatus: Record<string, unknown[]> = {
      planning: [{ id: 'planning-task', title: 'Planning task', assignedAgent: 'chief' }],
      running: [{ id: 'running-task', title: 'Running task', assignedAgent: 'ned' }],
      queued: [],
      review_pending: [],
      approval_pending: [{ id: 'approval-task', title: 'Approval task', assignedAgent: 'hermes' }]
    };
    const taskRepo = {
      findByStatus: vi.fn(async (status: string) => tasksByStatus[status] || [])
    } as any;
    const statusBot = new AtlasTelegramBot({
      config: {
        botToken: 'mock-token',
        allowedUserIds: new Set(['12345678']),
        isPolling: true
      },
      registry: defaultAgentRegistry,
      taskRepo
    });

    const result = await statusBot.processUpdate({
      update_id: 111,
      message: {
        message_id: 11,
        from: { id: allowedUser, is_bot: false, first_name: 'Owner' },
        chat: { id: allowedUser, type: 'private' },
        text: '/status',
        date: Math.floor(Date.now() / 1000)
      }
    });

    expect(result.responseText).toContain('Planning:* 1');
    expect(result.responseText).toContain('Approval Pending:* 1');
    expect(taskRepo.findByStatus).toHaveBeenCalledWith('planning');
    expect(taskRepo.findByStatus).toHaveBeenCalledWith('approval_pending');
  });

  it('fails closed when durable status telemetry cannot be queried', async () => {
    const taskRepo = {
      findByStatus: vi.fn().mockRejectedValue(new Error('database offline'))
    } as any;
    const statusBot = new AtlasTelegramBot({
      config: {
        botToken: 'mock-token',
        allowedUserIds: new Set(['12345678']),
        isPolling: true
      },
      registry: defaultAgentRegistry,
      taskRepo
    });

    const result = await statusBot.processUpdate({
      update_id: 112,
      message: {
        message_id: 12,
        from: { id: allowedUser, is_bot: false, first_name: 'Owner' },
        chat: { id: allowedUser, type: 'private' },
        text: '/status',
        date: Math.floor(Date.now() / 1000)
      }
    });

    expect(result.responseText).toContain('Task status temporarily unavailable');
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

  it('persists the originating Telegram message when creating a task', async () => {
    const task = {
      id: '123e4567-e89b-12d3-a456-426614174021',
      parentId: null,
      title: 'Find Palembang gyms',
      goal: 'Find Palembang gyms',
      assignedAgent: 'chief',
      depth: 0,
      status: 'queued',
      priority: 'normal',
      context: {},
      plan: null,
      result: null,
      error: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: null
    };
    const taskRepo = { create: vi.fn().mockResolvedValue(task) } as any;
    const messageRepo = { create: vi.fn().mockResolvedValue(undefined) } as any;
    const taskQueue = new InMemoryTaskQueue();
    const durableBot = new AtlasTelegramBot({
      config: {
        botToken: 'mock-token',
        allowedUserIds: new Set(['12345678']),
        isPolling: true
      },
      registry: defaultAgentRegistry,
      taskRepo,
      messageRepo,
      taskQueue
    });

    const result = await durableBot.processUpdate({
      update_id: 109,
      message: {
        message_id: 9,
        from: { id: allowedUser, is_bot: false, first_name: 'Owner' },
        chat: { id: allowedUser, type: 'private' },
        text: '/new Find Palembang gyms',
        date: Math.floor(Date.now() / 1000)
      }
    });

    expect(result.responseText).toContain('Task Created Successfully');
    expect(messageRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: task.id,
        senderType: 'user',
        senderId: String(allowedUser),
        content: task.goal,
        metadata: { source: 'telegram' }
      })
    );
  });

  it('creates the Telegram task and originating message in one transaction when durable DB is configured', async () => {
    const task = {
      id: '123e4567-e89b-12d3-a456-426614174022',
      parentId: null,
      title: 'Find Palembang gyms',
      goal: 'Find Palembang gyms atomically',
      assignedAgent: 'chief',
      depth: 0,
      status: 'queued',
      priority: 'normal',
      context: {},
      plan: null,
      result: null,
      error: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: null
    };
    const transactionClient = { query: vi.fn() };
    const db = {
      transaction: vi.fn(async (callback: (client: unknown) => Promise<unknown>) => callback(transactionClient))
    };
    const taskRepo = { create: vi.fn().mockResolvedValue(task) } as any;
    const messageRepo = { create: vi.fn().mockResolvedValue(undefined) } as any;
    const taskQueue = { enqueue: vi.fn().mockResolvedValue(task.id) } as any;
    const durableBot = new AtlasTelegramBot({
      config: {
        botToken: 'mock-token',
        allowedUserIds: new Set(['12345678']),
        isPolling: true
      },
      registry: defaultAgentRegistry,
      db: db as any,
      taskRepo,
      messageRepo,
      taskQueue
    });

    const result = await durableBot.processUpdate({
      update_id: 113,
      message: {
        message_id: 13,
        from: { id: allowedUser, is_bot: false, first_name: 'Owner' },
        chat: { id: allowedUser, type: 'private' },
        text: '/new Find Palembang gyms atomically',
        date: Math.floor(Date.now() / 1000)
      }
    });

    expect(result.responseText).toContain('Task Created Successfully');
    expect(db.transaction).toHaveBeenCalledOnce();
    expect(taskRepo.create).toHaveBeenCalledWith(expect.anything(), expect.any(String), transactionClient);
    expect(messageRepo.create).toHaveBeenCalledWith(expect.objectContaining({ taskId: task.id }), undefined, transactionClient);
    expect(taskQueue.enqueue).toHaveBeenCalledOnce();
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
    expect(runRepo.requestCancellationForActive).toHaveBeenCalledWith('Emergency stop activated by Telegram owner');
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
          signal.addEventListener(
            'abort',
            () => {
              clearTimeout(timer);
              reject(new Error('aborted'));
            },
            { once: true }
          );
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
