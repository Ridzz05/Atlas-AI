import { ApprovalRequest } from '@atlas/shared';

export interface TelegramInlineButton {
  text: string;
  callback_data: string;
}

export interface FormattedApprovalCard {
  text: string;
  replyMarkup: {
    inline_keyboard: TelegramInlineButton[][];
  };
}

export class ApprovalCardRenderer {
  public static render(req: ApprovalRequest): FormattedApprovalCard {
    const expiresAtDate = new Date(req.expiresAt).toLocaleTimeString();
    const payloadPreview = JSON.stringify(req.payload, null, 2);

    const text = `⚠️ *HUMAN APPROVAL REQUIRED*

*Action:* \`${req.action}\`
*Target:* \`${req.target}\`
*Agent:* \`${req.agentId}\`
*Risk Level:* *${req.riskLevel.toUpperCase()}*
*Reason:* ${req.reason}
*Expires:* ${expiresAtDate}

*Payload Preview:*
\`\`\`json
${payloadPreview.length > 500 ? payloadPreview.slice(0, 500) + '...' : payloadPreview}
\`\`\`

Please choose an action below:`;

    const replyMarkup = {
      inline_keyboard: [
        [
          { text: '✅ Approve', callback_data: `approve:${req.id}` },
          { text: '❌ Reject', callback_data: `reject:${req.id}` },
          { text: '✍️ Revise', callback_data: `revise:${req.id}` }
        ]
      ]
    };

    return { text, replyMarkup };
  }
}
