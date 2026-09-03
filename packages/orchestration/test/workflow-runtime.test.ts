import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { WorkflowCheckpoint, WorkflowState, WorkflowTransition } from '@atlas/shared';
import { WorkflowCheckpointRepository, WorkflowCheckpointUpsertInput } from '@atlas/database';
import { WorkflowRuntime, WorkflowEvent, WorkflowEventBus, ResumeDriver } from '../src/workflow/index.js';

class InMemoryCheckpointRepo {
  private rows = new Map<string, WorkflowCheckpoint>();

  private key(runId: string, stepId: string): string {
    return `${runId}:${stepId}`;
  }

  async upsert(input: WorkflowCheckpointUpsertInput): Promise<WorkflowCheckpoint> {
    const key = this.key(input.runId, input.stepId);
    const existing = this.rows.get(key);
    const now = new Date();
    const cp: WorkflowCheckpoint = {
      id: existing?.id ?? randomUUID(),
      runId: input.runId,
      taskId: input.taskId,
      agentId: input.agentId,
      stepId: input.stepId,
      state: input.state,
      resumeAfter: input.resumeAfter ?? null,
      payload: input.payload ?? {},
      history: existing?.history ?? [],
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };
    this.rows.set(key, cp);
    return cp;
  }

  async appendTransition(runId: string, stepId: string, transition: WorkflowTransition): Promise<WorkflowCheckpoint | null> {
    const key = this.key(runId, stepId);
    const existing = this.rows.get(key);
    if (!existing) return null;
    const updated: WorkflowCheckpoint = {
      ...existing,
      history: [...existing.history, transition],
      updatedAt: new Date()
    };
    this.rows.set(key, updated);
    return updated;
  }

  async findByRunAndStep(runId: string, stepId: string): Promise<WorkflowCheckpoint | null> {
    return this.rows.get(this.key(runId, stepId)) ?? null;
  }

  async listByRun(runId: string): Promise<WorkflowCheckpoint[]> {
    return Array.from(this.rows.values()).filter(cp => cp.runId === runId);
  }

  async listResumable(now: Date, limit = 50): Promise<WorkflowCheckpoint[]> {
    const due: WorkflowCheckpoint[] = [];
    for (const cp of this.rows.values()) {
      if (
        (cp.state === 'scheduled' || cp.state === 'paused' || cp.state === 'waiting_external_event') &&
        cp.resumeAfter !== null &&
        cp.resumeAfter <= now
      ) {
        due.push(cp);
      }
    }
    due.sort((a, b) => {
      const ta = a.resumeAfter?.getTime() ?? 0;
      const tb = b.resumeAfter?.getTime() ?? 0;
      return ta - tb;
    });
    return due.slice(0, Math.min(500, Math.max(1, limit)));
  }
}

class RecordingEventBus implements WorkflowEventBus {
  public events: WorkflowEvent[] = [];
  public failNext = false;
  async publish(event: WorkflowEvent): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('boom');
    }
    this.events.push(event);
  }
}

interface Fixture {
  repo: InMemoryCheckpointRepo;
  runtime: WorkflowRuntime;
  bus: RecordingEventBus;
  runId: string;
  taskId: string;
  agentId: string;
  stepId: string;
}

function makeFixture(opts?: { now?: () => Date; withBus?: boolean }): Fixture {
  const repo = new InMemoryCheckpointRepo();
  const bus = new RecordingEventBus();
  const now = opts?.now ?? (() => new Date('2026-01-01T00:00:00Z'));
  const runtime = new WorkflowRuntime({
    checkpointRepo: repo as unknown as WorkflowCheckpointRepository,
    eventBus: opts?.withBus === false ? undefined : bus,
    now
  });
  return {
    repo,
    runtime,
    bus,
    runId: randomUUID(),
    taskId: randomUUID(),
    agentId: 'agent-1',
    stepId: 'step-1'
  };
}

describe('WorkflowRuntime', () => {
  let fx: Fixture;
  beforeEach(() => {
    fx = makeFixture();
  });

  it('starts a new checkpoint in "running" state', async () => {
    const cp = await fx.runtime.start({
      runId: fx.runId,
      taskId: fx.taskId,
      agentId: fx.agentId,
      stepId: fx.stepId,
      payload: { foo: 'bar' }
    });
    expect(cp.state).toBe('running');
    expect(cp.payload).toEqual({ foo: 'bar' });
    expect(cp.resumeAfter).toBeNull();
    expect(cp.history).toEqual([]);
  });

  it('transitions through legal states (running -> waiting_approval -> running -> completed)', async () => {
    await fx.runtime.start({
      runId: fx.runId,
      taskId: fx.taskId,
      agentId: fx.agentId,
      stepId: fx.stepId
    });
    const waiting = await fx.runtime.waitForApproval(fx.runId, fx.stepId, 'approval-123');
    expect(waiting.state).toBe('waiting_approval');
    expect(waiting.payload).toMatchObject({ approvalId: 'approval-123' });

    const running = await fx.runtime.resume(fx.runId, fx.stepId, 'Approved');
    expect(running.state).toBe('running');

    const done = await fx.runtime.complete(fx.runId, fx.stepId, { result: 'ok' });
    expect(done.state).toBe('completed');
    expect(done.payload).toMatchObject({ result: 'ok' });
  });

  it('rejects illegal transitions (completed -> running must throw)', async () => {
    await fx.runtime.start({
      runId: fx.runId,
      taskId: fx.taskId,
      agentId: fx.agentId,
      stepId: fx.stepId
    });
    await fx.runtime.complete(fx.runId, fx.stepId);
    await expect(fx.runtime.transition({ runId: fx.runId, stepId: fx.stepId, to: 'running' })).rejects.toThrow(
      /Illegal workflow transition/
    );
  });

  it('completed is terminal - no transitions out', async () => {
    await fx.runtime.start({
      runId: fx.runId,
      taskId: fx.taskId,
      agentId: fx.agentId,
      stepId: fx.stepId
    });
    await fx.runtime.complete(fx.runId, fx.stepId);
    for (const to of ['running', 'paused', 'failed', 'cancelled', 'waiting_approval'] as WorkflowState[]) {
      await expect(fx.runtime.transition({ runId: fx.runId, stepId: fx.stepId, to })).rejects.toThrow(/Illegal workflow transition/);
    }
  });

  it('cancelled is terminal', async () => {
    await fx.runtime.start({
      runId: fx.runId,
      taskId: fx.taskId,
      agentId: fx.agentId,
      stepId: fx.stepId
    });
    await fx.runtime.cancel(fx.runId, fx.stepId, 'user cancelled');
    const cp = await fx.runtime.get(fx.runId, fx.stepId);
    expect(cp?.state).toBe('cancelled');
    await expect(fx.runtime.transition({ runId: fx.runId, stepId: fx.stepId, to: 'running' })).rejects.toThrow(
      /Illegal workflow transition/
    );
  });

  it('failed is terminal', async () => {
    await fx.runtime.start({
      runId: fx.runId,
      taskId: fx.taskId,
      agentId: fx.agentId,
      stepId: fx.stepId
    });
    await fx.runtime.fail(fx.runId, fx.stepId, 'oops');
    const cp = await fx.runtime.get(fx.runId, fx.stepId);
    expect(cp?.state).toBe('failed');
    await expect(fx.runtime.transition({ runId: fx.runId, stepId: fx.stepId, to: 'running' })).rejects.toThrow(
      /Illegal workflow transition/
    );
  });

  it('schedule + resumeAfter persists and listResumable returns it once the time has passed', async () => {
    let current = new Date('2026-01-01T00:00:00Z');
    const fx2 = makeFixture({ now: () => current });

    await fx2.runtime.start({
      runId: fx2.runId,
      taskId: fx2.taskId,
      agentId: fx2.agentId,
      stepId: fx2.stepId
    });
    const scheduledAt = new Date('2026-01-01T00:00:10Z');
    const cp = await fx2.runtime.schedule(fx2.runId, fx2.stepId, scheduledAt);
    expect(cp.state).toBe('scheduled');
    expect(cp.resumeAfter?.toISOString()).toBe(scheduledAt.toISOString());

    let due = await fx2.repo.listResumable(new Date('2026-01-01T00:00:05Z'));
    expect(due).toHaveLength(0);

    current = new Date('2026-01-01T00:00:11Z');
    due = await fx2.repo.listResumable(current);
    expect(due).toHaveLength(1);
    expect(due[0].stepId).toBe(fx2.stepId);
  });

  it('pause and resume round-trip preserves history', async () => {
    await fx.runtime.start({
      runId: fx.runId,
      taskId: fx.taskId,
      agentId: fx.agentId,
      stepId: fx.stepId
    });
    await fx.runtime.pause(fx.runId, fx.stepId, 'manual pause');
    await fx.runtime.resume(fx.runId, fx.stepId, 'manual resume');

    const cp = await fx.runtime.get(fx.runId, fx.stepId);
    expect(cp?.state).toBe('running');
    expect(cp?.history.map(h => `${h.from}->${h.to}`)).toEqual(['running->paused', 'paused->running']);
  });

  it('appendTransition stores from/to/at/reason on the checkpoint history', async () => {
    await fx.runtime.start({
      runId: fx.runId,
      taskId: fx.taskId,
      agentId: fx.agentId,
      stepId: fx.stepId
    });
    await fx.runtime.transition({
      runId: fx.runId,
      stepId: fx.stepId,
      to: 'paused',
      reason: 'paused for review'
    });

    const cp = await fx.runtime.get(fx.runId, fx.stepId);
    expect(cp?.history).toHaveLength(1);
    const t = cp!.history[0];
    expect(t.from).toBe('running');
    expect(t.to).toBe('paused');
    expect(t.reason).toBe('paused for review');
    expect(t.at).toBeInstanceOf(Date);
  });

  it('emits workflow.<state> events via the event bus', async () => {
    await fx.runtime.start({
      runId: fx.runId,
      taskId: fx.taskId,
      agentId: fx.agentId,
      stepId: fx.stepId
    });
    await fx.runtime.transition({
      runId: fx.runId,
      stepId: fx.stepId,
      to: 'paused',
      reason: 'hold'
    });
    expect(fx.bus.events).toHaveLength(1);
    const evt = fx.bus.events[0];
    expect(evt.type).toBe('workflow.paused');
    expect(evt.runId).toBe(fx.runId);
    expect(evt.taskId).toBe(fx.taskId);
    expect(evt.agentId).toBe(fx.agentId);
    expect(evt.payload).toMatchObject({
      from: 'running',
      to: 'paused',
      reason: 'hold',
      stepId: fx.stepId
    });
    expect(evt.id).toBeTypeOf('string');
    expect(evt.timestamp).toBeTypeOf('string');
  });

  it('does not throw when event bus fails', async () => {
    fx.bus.failNext = true;
    await fx.runtime.start({
      runId: fx.runId,
      taskId: fx.taskId,
      agentId: fx.agentId,
      stepId: fx.stepId
    });
    await expect(
      fx.runtime.transition({
        runId: fx.runId,
        stepId: fx.stepId,
        to: 'paused',
        reason: 'still works'
      })
    ).resolves.toBeDefined();
    const cp = await fx.runtime.get(fx.runId, fx.stepId);
    expect(cp?.state).toBe('paused');
  });

  it('throws when checkpoint not found', async () => {
    await expect(
      fx.runtime.transition({
        runId: fx.runId,
        stepId: 'nope',
        to: 'running'
      })
    ).rejects.toThrow(/Workflow checkpoint not found/);
  });
});

describe('ResumeDriver', () => {
  it('tick calls onResume for each due checkpoint and transitions them to "running"', async () => {
    let current = new Date('2026-01-01T00:00:00Z');
    const fx2 = makeFixture({ now: () => current });
    await fx2.runtime.start({
      runId: fx2.runId,
      taskId: fx2.taskId,
      agentId: fx2.agentId,
      stepId: fx2.stepId
    });
    await fx2.runtime.schedule(fx2.runId, fx2.stepId, new Date('2026-01-01T00:00:05Z'));

    const driver = new ResumeDriver({
      runtime: fx2.runtime,
      checkpointRepo: fx2.repo as unknown as WorkflowCheckpointRepository,
      onResume: async () => {
        /* no-op */
      }
    });

    current = new Date('2026-01-01T00:00:10Z');
    const handled = await driver.tick(current);
    expect(handled).toBe(1);
    const cp = await fx2.runtime.get(fx2.runId, fx2.stepId);
    expect(cp?.state).toBe('running');
  });

  it('tick.fail: if onResume throws, the checkpoint ends up in "failed" with the error in history', async () => {
    let current = new Date('2026-01-01T00:00:00Z');
    const fx2 = makeFixture({ now: () => current });
    await fx2.runtime.start({
      runId: fx2.runId,
      taskId: fx2.taskId,
      agentId: fx2.agentId,
      stepId: fx2.stepId
    });
    await fx2.runtime.schedule(fx2.runId, fx2.stepId, new Date('2026-01-01T00:00:05Z'));

    const driver = new ResumeDriver({
      runtime: fx2.runtime,
      checkpointRepo: fx2.repo as unknown as WorkflowCheckpointRepository,
      onResume: async () => {
        throw new Error('handler kaput');
      }
    });

    current = new Date('2026-01-01T00:00:10Z');
    const handled = await driver.tick(current);
    expect(handled).toBe(1);
    const cp = await fx2.runtime.get(fx2.runId, fx2.stepId);
    expect(cp?.state).toBe('failed');
    const last = cp!.history[cp!.history.length - 1];
    expect(last.to).toBe('failed');
    expect(last.reason).toContain('handler kaput');
  });
});
