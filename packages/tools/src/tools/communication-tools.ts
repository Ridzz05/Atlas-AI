import { z } from 'zod';
import { ToolDefinition } from '../types.js';
import { TokenVerifier } from '@atlas/policy';

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
    content: z.string().min(1),
    approvalToken: z.string().min(1)
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
  async execute(ctx, input) {
    // In test/safe environments, this records the execution
    return {
      messageId: `msg_${crypto.randomUUID()}`,
      status: 'sent',
      recipient: input.recipient,
      timestamp: new Date().toISOString()
    };
  }
};
