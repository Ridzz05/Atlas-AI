export interface CommunicationMessageRecord {
  id: string;
  taskId: string | null;
  runId: string | null;
  senderType: string;
  senderId: string;
  recipientId: string | null;
  content: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface CommunicationToolCallRecord {
  id: string;
  taskId: string;
  runId: string;
  agentId: string;
  toolName: string;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  error: string | null;
  durationMs: number | null;
  riskLevel: string;
  requiresApproval: boolean;
  approvalId: string | null;
  status: string;
  createdAt: string;
}

export interface CommunicationFeedItem {
  id: string;
  kind: 'message' | 'tool';
  sender: string;
  summary: string;
  timestamp: string;
  taskId: string | null;
  runId: string | null;
  status?: string;
  riskLevel?: string;
}

export function buildCommunicationFeed(
  messages: CommunicationMessageRecord[],
  toolCalls: CommunicationToolCallRecord[]
): CommunicationFeedItem[] {
  const messageItems = messages.map(message => ({
    id: message.id,
    kind: 'message' as const,
    sender: message.senderId,
    summary: message.content,
    timestamp: message.createdAt,
    taskId: message.taskId,
    runId: message.runId
  }));
  const toolItems = toolCalls.map(toolCall => ({
    id: toolCall.id,
    kind: 'tool' as const,
    sender: toolCall.agentId,
    summary: `${toolCall.toolName} - ${toolCall.status}`,
    timestamp: toolCall.createdAt,
    taskId: toolCall.taskId,
    runId: toolCall.runId,
    status: toolCall.status,
    riskLevel: toolCall.riskLevel
  }));

  return [...messageItems, ...toolItems].sort((left, right) => {
    const timeDifference = Date.parse(right.timestamp) - Date.parse(left.timestamp);
    return timeDifference || right.id.localeCompare(left.id);
  });
}
