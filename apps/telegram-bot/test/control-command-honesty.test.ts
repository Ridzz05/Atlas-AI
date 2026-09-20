import { describe, expect, it, vi } from 'vitest';
import { CommandRouter } from '../src/handlers/commands.js';
import { AtlasTelegramBot } from '../src/bot.js';
import { defaultAgentRegistry } from '@atlas/agents';

/**
 * A control command must report what it did, and record who did it.
 *
 * `/stop` discarded the `rowCount` from both cancellation calls, swallowed the `updateStatus` error, and
 * returned "cancellation signal sent" unconditionally — including when nothing matched and including for
 * a task that had already finished, which it relabelled `cancelled` and overwrote `completed_at` on.
 *
 * `/pause` passed the actor id to a callback wired with one parameter, so it was dropped and the row was
 * written with the default `telegram-owner`. `/emergency_stop` forwards its actor correctly and its own
 * test asserts the real id, so the two control commands disagreed about who acts.
 */
function buildRouter(overrides: Record<string, unknown> = {}) {
  const taskRepo = {
    updateStatus: vi.fn().mockResolvedValue(undefined),
    findById: vi.fn().mockResolvedValue({ id: 'task-1', status: 'running', goal: 'Do the thing' }),
    findByStatus: vi.fn().mockResolvedValue([])
  };
  const runRepo = {
    requestCancellationForTask: vi.fn().mockResolvedValue(1),
    requestCancellationForActive: vi.fn().mockResolvedValue(2)
  };
  const setPaused = vi.fn().mockResolvedValue(undefined);
  const setEmergencyStop = vi.fn().mockResolvedValue(undefined);

  const router = new CommandRouter({
    taskRepo,
    runRepo,
    setPaused,
    setEmergencyStop,
    ...overrides
  } as never);

  return { router, taskRepo, runRepo, setPaused, setEmergencyStop };
}

describe('/stop honesty', () => {
  it('does not claim a signal was sent when nothing matched the task', async () => {
    const { router, runRepo } = buildRouter();
    runRepo.requestCancellationForTask.mockResolvedValue(0);

    const reply = await router.handle('stop', ['task-1']);

    expect(reply).not.toMatch(/signal sent/i);
    expect(reply).toMatch(/no (running|active) run|nothing/i);
  });

  it('does not relabel a task that already finished', async () => {
    const { router, taskRepo } = buildRouter();
    taskRepo.findById.mockResolvedValue({ id: 'task-1', status: 'completed', goal: 'Done' });

    const reply = await router.handle('stop', ['task-1']);

    expect(taskRepo.updateStatus).not.toHaveBeenCalled();
    expect(reply).toMatch(/completed|already/i);
  });

  it('reports a cancellation when one really happened', async () => {
    const { router, taskRepo, runRepo } = buildRouter();

    const reply = await router.handle('stop', ['task-1']);

    expect(runRepo.requestCancellationForTask).toHaveBeenCalled();
    expect(taskRepo.updateStatus).toHaveBeenCalledWith('task-1', 'cancelled', expect.anything());
    expect(reply).toMatch(/cancel/i);
  });

  it('says so when the task does not exist', async () => {
    const { router, taskRepo } = buildRouter();
    taskRepo.findById.mockResolvedValue(null);

    const reply = await router.handle('stop', ['missing-task']);

    expect(reply).toMatch(/not found/i);
  });
});

describe('control commands record their actor', () => {
  /**
   * The router always passed the actor; the bug was one layer up, in the bot's wiring, which took a
   * single parameter and dropped it. So this drives the whole chain the way Telegram does: a message
   * through the guard, the router, the wiring and into the repository.
   */
  it('records the real Telegram user id when /pause is used', async () => {
    const setPaused = vi.fn().mockResolvedValue({ paused: true, emergencyStop: false, updatedBy: '12345678' });
    const bot = new AtlasTelegramBot({
      config: { botToken: 'mock-token', allowedUserIds: new Set(['12345678']), isPolling: true },
      registry: defaultAgentRegistry,
      stateRepo: {
        claimUpdate: vi.fn().mockResolvedValue(true),
        setPaused,
        setEmergencyStop: vi.fn(),
        resume: vi.fn(),
        getControlState: vi.fn().mockResolvedValue({ paused: false, emergencyStop: false })
      } as never
    });

    await bot.processUpdate({
      update_id: 9001,
      message: {
        message_id: 1,
        from: { id: 12345678, is_bot: false, first_name: 'Owner' },
        chat: { id: 12345678, type: 'private' },
        text: '/pause',
        date: Math.floor(Date.now() / 1000)
      }
    });

    expect(setPaused).toHaveBeenCalledWith(true, '12345678');
  });

  it('passes the actor id to setPaused', async () => {
    const { router, setPaused } = buildRouter();

    await router.handle('pause', [], '555001');

    expect(setPaused).toHaveBeenCalledWith(true, '555001');
  });

  it('passes the actor id to setEmergencyStop', async () => {
    const { router, setEmergencyStop } = buildRouter();

    await router.handle('emergency_stop', [], '555001');

    expect(setEmergencyStop).toHaveBeenCalledWith(true, '555001');
  });

  it('passes the actor id when cancelling a task', async () => {
    const { router, runRepo } = buildRouter();

    await router.handle('stop', ['task-1'], '555001');

    expect(runRepo.requestCancellationForTask).toHaveBeenCalledWith('task-1', expect.stringContaining('555001'));
  });
});

describe('/emergency_stop claims only what it did', () => {
  it('does not promise abort signals when no runner or run repository is wired', async () => {
    const setEmergencyStop = vi.fn().mockResolvedValue(undefined);
    const router = new CommandRouter({ setEmergencyStop } as never);

    const reply = await router.handle('emergency_stop', [], '555001');

    // The stop itself really happened, so that part must stay.
    expect(reply).toMatch(/frozen|stopped/i);
    expect(reply).not.toMatch(/abort signals/i);
  });

  it('does not promise that external writes are locked', async () => {
    const { router } = buildRouter();

    const reply = await router.handle('emergency_stop', [], '555001');

    // Nothing in the tool or orchestration layer reads the control state, so no write is "locked".
    expect(reply).not.toMatch(/external writes are locked/i);
  });
});
