import { redactSensitive } from './logger.js';

export interface AuditEventInput {
  actor: string;
  action: string;
  target?: string;
  taskId?: string;
  runId?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
}

export interface AuditRecord {
  id: string;
  timestamp: string;
  actor: string;
  action: string;
  target?: string;
  taskId?: string;
  runId?: string;
  details: Record<string, unknown>;
  ipAddress?: string;
}

export class AuditService {
  public static format(input: AuditEventInput): AuditRecord {
    return {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      actor: input.actor,
      action: input.action,
      target: input.target,
      taskId: input.taskId,
      runId: input.runId,
      details: (redactSensitive(input.details || {}) as Record<string, unknown>) || {},
      ipAddress: input.ipAddress
    };
  }
}
