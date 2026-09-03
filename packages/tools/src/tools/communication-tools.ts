import { z } from 'zod';
import { ToolManifest } from '@atlas/shared';
import { ToolDefinition } from '../types.js';

const createDraftManifest: ToolManifest = {
  name: 'communication.create_draft',
  version: 1,
  capability: 'communication',
  description: 'Create an outbound draft (no side effect).',
  sideEffects: ['none'],
  riskLevel: 'low',
  idempotency: 'none',
  requiredConnectionScopes: [],
  scopes: ['communication:write'],
  isIdempotentByDefault: true,
  approval: 'auto',
  timeoutMs: 3000
};

const sendApprovedManifest: ToolManifest = {
  name: 'communication.send_approved',
  version: 1,
  capability: 'communication',
  description: 'Send an approved message. External side effect; deduped by idempotency key.',
  sideEffects: ['send_message', 'write_external', 'network'],
  riskLevel: 'high',
  idempotency: 'required',
  requiredConnectionScopes: ['communication.send'],
  scopes: ['communication:send'],
  isIdempotentByDefault: false,
  approval: 'human',
  timeoutMs: 10_000
};

export const CreateDraftTool: ToolDefinition = {
  name: 'communication.create_draft',
  description: 'Create an outbound pitch or outreach draft for review without sending.',
  inputSchema: z.object({
    recipient: z.string().min(1),
    channel: z.enum(['whatsapp', 'email', 'sms']).default('whatsapp'),
    subject: z.string().optional(),
    content: z.string().min(1),
    targetAudience: z.string().optional(),
    valueProposition: z.string().optional()
  }),
  outputSchema: z.object({
    draftId: z.string(),
    channel: z.string(),
    recipient: z.string(),
    content: z.string(),
    status: z.string()
  }),
  riskLevel: 'low',
  requiresApproval: false,
  timeoutMs: 3000,
  manifest: createDraftManifest,
  async execute(_ctx, input) {
    return {
      draftId: crypto.randomUUID(),
      channel: input.channel,
      recipient: input.recipient,
      content: input.content,
      status: 'draft_created'
    };
  }
};

export const SendApprovedCommunicationTool: ToolDefinition = {
  name: 'communication.send_approved',
  description: 'Send an approved message to an external recipient with a valid cryptographic approval token.',
  inputSchema: z.object({
    recipient: z.string().min(1),
    channel: z.enum(['whatsapp', 'email', 'sms']),
    content: z.string().min(1)
  }),
  outputSchema: z.object({
    messageId: z.string(),
    status: z.string(),
    recipient: z.string(),
    timestamp: z.string()
  }),
  riskLevel: 'high',
  requiresApproval: true,
  timeoutMs: 10000,
  manifest: sendApprovedManifest,
  async execute(ctx, input) {
    if (!ctx.communicationSender) {
      throw new Error('No outbound communication connector configured.');
    }

    const result = await ctx.communicationSender(input, ctx);
    return {
      messageId: result.messageId,
      status: 'sent',
      recipient: result.recipient,
      timestamp: result.timestamp
    };
  }
};

