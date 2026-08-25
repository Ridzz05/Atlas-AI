import { describe, it, expect, vi } from 'vitest';
import { redactSensitive, Logger, AuditService } from '../src/index.js';

describe('@atlas/observability tests', () => {
  it('redacts sensitive keys from objects', () => {
    const raw = {
      user: 'alice',
      apiKey: 'secret-12345',
      nested: {
        password: 'super-secret-pw',
        regular: 'ok'
      },
      list: [{ token: 'jwt-token-val' }, { normal: 1 }]
    };

    const redacted = redactSensitive(raw) as any;
    expect(redacted.user).toBe('alice');
    expect(redacted.apiKey).toBe('[REDACTED]');
    expect(redacted.nested.password).toBe('[REDACTED]');
    expect(redacted.nested.regular).toBe('ok');
    expect(redacted.list[0].token).toBe('[REDACTED]');
    expect(redacted.list[1].normal).toBe(1);
  });

  it('formats audit records with redaction', () => {
    const record = AuditService.format({
      actor: 'user-1',
      action: 'communication.send_approved',
      taskId: 'task-123',
      details: {
        bot_token: 'secret_token_123',
        recipient: '+62812345'
      }
    });

    expect(record.id).toBeDefined();
    expect(record.actor).toBe('user-1');
    expect(record.details.bot_token).toBe('[REDACTED]');
    expect(record.details.recipient).toBe('+62812345');
  });

  it('logs structured messages without crashing', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const logger = new Logger({ service: 'agent-service' });

    logger.info('Server started', { port: 4000 });
    expect(consoleSpy).toHaveBeenCalledTimes(1);

    const logOutput = JSON.parse(consoleSpy.mock.calls[0]?.[0] as string);
    expect(logOutput.level).toBe('info');
    expect(logOutput.message).toBe('Server started');
    expect(logOutput.context.service).toBe('agent-service');
    expect(logOutput.context.port).toBe(4000);

    consoleSpy.mockRestore();
  });
});
