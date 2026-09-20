import { describe, it, expect, vi } from 'vitest';
import { AgentRunner } from '../src/engine/agent-runner.js';
import { Task, AgentDefinition } from '@atlas/shared';
import { ModelProvider, ModelRunRequest, ModelRunResult } from '@atlas/providers';
import { rootLogger } from '@atlas/observability';

/**
 * Characterisation tests for the run-lease invariants.
 *
 * The failure these pin down: a worker that FAILS to acquire the lease still runs the
 * catch block, which writes a terminal status for the run. Because `RunRepository.updateStatus`
 * matched on `id` alone and clears `worker_id` / `heartbeat_at` / `lease_expires_at` on a
 * terminal status, that write clobbered the run belonging to the worker that legitimately
 * held the lease. The victim's next heartbeat then returned false and it aborted a healthy
 * run.
 *
 * The in-memory double below models the repository contract, including the worker guard
 * that `updateStatus` now applies when it is given a `workerId`.
 */

class CountingProvider implements ModelProvider {
  public readonly id = 'counting';
  public readonly name = 'Counting Provider';
  public calls = 0;
  public readonly requests: ModelRunRequest[] = [];

  public estimateCost(): number {
    return 0;
  }

  public async run(request: ModelRunRequest): Promise<ModelRunResult> {
    this.calls += 1;
    this.requests.push(request);
    return {
      content: `run ${this.calls}`,
      toolCalls: [],
      inputTokens: 10,
      outputTokens: 5,
      costUsd: 0,
      finishReason: 'stop'
    };
  }
}

interface FakeRunRow {
  id: string;
  taskId: string;
  status: string;
  workerId: string | null;
  leaseExpiresAt: number | null;
  error: string | null;
}

/**
 * Models `runs` plus the lease columns. `updateStatus` honours the same guard as the SQL
 * repository: when a workerId is supplied, a row owned by a different worker is left alone.
 */
function buildRunRepo(rows: FakeRunRow[]) {
  const byId = new Map(rows.map(row => [row.id, { ...row }]));

  return {
    rows: byId,
    acquireLease: vi.fn(async (runId: string, workerId: string, leaseSeconds = 60) => {
      const row = byId.get(runId);
      if (!row) return null;
      const leaseFree = row.workerId === null || (row.leaseExpiresAt !== null && row.leaseExpiresAt < Date.now());
      if (row.workerId !== workerId && !leaseFree) return null;

      row.workerId = workerId;
      row.leaseExpiresAt = Date.now() + leaseSeconds * 1000;
      return row;
    }),
    heartbeat: vi.fn(async (runId: string, workerId: string, leaseSeconds = 60) => {
      const row = byId.get(runId);
      if (!row || row.workerId !== workerId) return false;
      row.leaseExpiresAt = Date.now() + leaseSeconds * 1000;
      return true;
    }),
    releaseLease: vi.fn(async (runId: string, workerId?: string) => {
      const row = byId.get(runId);
      if (!row) return false;
      if (workerId && row.workerId !== workerId) return false;
      row.workerId = null;
      row.leaseExpiresAt = null;
      return true;
    }),
    create: vi.fn(async (input: { taskId: string; agentId: string }, id?: string) => {
      const runId = id || crypto.randomUUID();
      // Faithful to the SQL repository: `runs.id` is a primary key and `create` is a plain
      // INSERT, so creating an existing run is a duplicate-key error, not an overwrite.
      if (byId.has(runId)) throw new Error(`duplicate key value violates unique constraint "runs_pkey"`);
      byId.set(runId, { id: runId, taskId: input.taskId, status: 'active', workerId: null, leaseExpiresAt: null, error: null });
      return byId.get(runId);
    }),
    updateStatus: vi.fn(async (runId: string, status: string, error?: string, workerId?: string) => {
      const row = byId.get(runId);
      if (!row) return null;
      // The worker guard: a run owned by someone else must not be touched.
      if (workerId && row.workerId !== null && row.workerId !== workerId) return null;

      row.status = status;
      row.error = error ?? row.error;
      if (['completed', 'failed', 'cancelled', 'timed_out'].includes(status)) {
        row.workerId = null;
        row.leaseExpiresAt = null;
      }
      return row;
    }),
    recordTurn: vi.fn(async () => undefined),
    requestCancellation: vi.fn(async () => null),
    isCancellationRequested: vi.fn(async () => false)
  };
}

const task: Task = {
  id: '123e4567-e89b-12d3-a456-426614174100',
  parentId: null,
  title: 'Lease invariant task',
  goal: 'Exercise the run lease',
  assignedAgent: 'ned',
  depth: 0,
  status: 'running',
  priority: 'normal',
  context: {},
  plan: null,
  result: null,
  error: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  completedAt: null
};

const agent: AgentDefinition = {
  id: 'ned',
  name: 'Ned',
  role: 'researcher',
  version: 1,
  description: 'Research specialist',
  systemPrompt: 'You are Ned',
  limits: { maxTurns: 2, maxDelegationDepth: 1, timeoutSeconds: 30, maxCostUsd: 0.75 },
  permissions: { tools: [], dataScopes: [], externalWrites: false },
  modelPolicy: { preferredTier: 'balanced', fallbackTier: 'fast', temperature: 0.1 },
  review: { humanApprovalFor: [] }
};

describe('AgentRunner run-lease invariants', () => {
  it('does not clobber a run that another worker legitimately holds', async () => {
    const runId = '123e4567-e89b-12d3-a456-426614174200';
    const runRepo = buildRunRepo([
      { id: runId, taskId: task.id, status: 'active', workerId: 'worker-a', leaseExpiresAt: Date.now() + 60_000, error: null }
    ]);

    // The approval-resume path: the run already exists, so the runner takes the
    // `updateStatus(runId, 'active')` branch instead of creating a new run. Two workers can
    // receive the same resume (a BullMQ retry, or Telegram and the dashboard both approving),
    // and only one of them may hold the lease.
    const runnerB = new AgentRunner({
      provider: new CountingProvider(),
      runRepo: runRepo as any,
      workerId: 'worker-b'
    });

    const summary = await runnerB.run({
      task,
      agent,
      initialPrompt: 'go',
      runId,
      approvalToken: { requestId: 'req-1', action: 'communication.send_approved', payloadHash: 'h', signature: 's', expiresAt: 0 } as any
    });

    expect(summary.runId).toBe(runId);

    // Worker B could not take the lease, so worker A's run must be untouched: still owned,
    // still active, lease intact.
    const row = runRepo.rows.get(runId)!;
    expect(row.workerId).toBe('worker-a');
    expect(row.status).toBe('active');
    expect(row.leaseExpiresAt).not.toBeNull();
  });

  it('writes the terminal status when the worker does own the lease', async () => {
    const runId = '123e4567-e89b-12d3-a456-426614174201';
    const runRepo = buildRunRepo([]);

    const runnerA = new AgentRunner({
      provider: new CountingProvider(),
      runRepo: runRepo as any,
      workerId: 'worker-a'
    });

    await runnerA.run({ task, agent, initialPrompt: 'go', runId });

    // The run was created, leased by worker-a, and completed under that same guard.
    expect(runRepo.acquireLease).toHaveBeenCalledWith(runId, 'worker-a', expect.any(Number));
    const row = runRepo.rows.get(runId)!;
    expect(row.status).toBe('completed');
    expect(row.workerId).toBeNull();
  });

  it('still completes a run when the repository has no lease support', async () => {
    const runId = '123e4567-e89b-12d3-a456-426614174202';
    const full = buildRunRepo([]);
    // A repository without acquireLease/heartbeat: the runner must not require a lease.
    const runRepo = { create: full.create, updateStatus: full.updateStatus, recordTurn: full.recordTurn } as any;

    const runner = new AgentRunner({
      provider: new CountingProvider(),
      runRepo,
      workerId: 'worker-a'
    });

    await runner.run({ task, agent, initialPrompt: 'go', runId });

    expect(full.rows.get(runId)!.status).toBe('completed');
  });

  it('warns once when durable budget enforcement is unavailable', async () => {
    // Production wires runRepo + budgetRepo + GLOBAL_DAILY_BUDGET_USD together. If a caller
    // forgets one, the global daily cap silently stops existing; warn so that is visible.
    const warnSpy = vi.spyOn(rootLogger, 'warn');
    try {
      const runner = new AgentRunner({
        provider: new CountingProvider(),
        workerId: 'worker-a'
        // no budgetRepo / globalDailyBudgetUsd
      });

      await runner.run({ task, agent, initialPrompt: 'go' });
      await runner.run({ task, agent, initialPrompt: 'go' });

      const budgetWarnings = warnSpy.mock.calls.filter(call => String(call[0]).includes('Durable budget enforcement is disabled'));
      expect(budgetWarnings).toHaveLength(1);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('does not warn when the durable budget is wired', async () => {
    const warnSpy = vi.spyOn(rootLogger, 'warn');
    try {
      const runRepo = buildRunRepo([]);
      const budgetRepo = {
        reserve: vi.fn(async () => ({ id: 'reservation-1' })),
        commit: vi.fn(async () => true)
      };

      const runner = new AgentRunner({
        provider: new CountingProvider(),
        runRepo: runRepo as any,
        budgetRepo: budgetRepo as any,
        globalDailyBudgetUsd: 5,
        workerId: 'worker-a'
      });

      await runner.run({ task, agent, initialPrompt: 'go' });

      const budgetWarnings = warnSpy.mock.calls.filter(call => String(call[0]).includes('Durable budget enforcement is disabled'));
      expect(budgetWarnings).toHaveLength(0);
      expect(budgetRepo.reserve).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  // modelPolicy was persisted into the agents row and rendered in the dashboard, but no runtime code
  // read it, so the only model call site sent no temperature and the adapter's default 0.2 applied
  // to every agent — Argus asked for 0.0 (deterministic QA verdicts) and got 0.2.
  it('sends the agent declared temperature with the request', async () => {
    const provider = new CountingProvider();
    const runner = new AgentRunner({ provider, workerId: 'worker-a' });

    await runner.run({ task, agent, initialPrompt: 'go' });

    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0]?.temperature).toBe(0.1);
  });
});
