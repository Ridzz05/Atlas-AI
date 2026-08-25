import { describe, it, expect, vi } from 'vitest';
import { AtlasTelegramBot } from '../src/bot.js';
import { ApprovalCardRenderer } from '../src/cards/approval-card.js';
import { defaultAgentRegistry } from '@atlas/agents';
import { ApprovalRequest } from '@atlas/shared';

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
    expect(result.responseText).toContain('approved');
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
});
