import { describe, it, expect, vi } from 'vitest';
import { AgentWorkerRunner } from '../src/worker.js';
import { EnvConfigSchema, Task, AgentDefinition } from '@atlas/shared';
import { MockModelProvider } from '@atlas/providers';
import { InMemoryMemoryStore } from '@atlas/memory';

describe('worker lifecycle and task execution tests', () => {
  const config = EnvConfigSchema.parse({ NODE_ENV: 'test' });

  const mockTask: Task = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    parentId: null,
    title: 'Worker Test Task',
    goal: 'Test worker pipeline',
    assignedAgent: 'chief',
    depth: 0,
    status: 'queued',
    priority: 'normal',
    context: {},
    plan: null,
    result: null,
    error: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null
  };

  const mockAgent: AgentDefinition = {
    id: 'chief',
    name: 'Chief',
    role: 'orchestrator',
    version: 1,
    description: 'Chief agent',
    systemPrompt: 'You are Chief',
    limits: { maxTurns: 5, maxDelegationDepth: 2, timeoutSeconds: 5, maxCostUsd: 1.0 },
    permissions: { tools: [], dataScopes: [], externalWrites: false },
    modelPolicy: { preferredTier: 'balanced', fallbackTier: 'fast', temperature: 0.2 },
    review: { humanApprovalFor: [] }
  };

  it('starts, processes queued tasks, and stops gracefully', async () => {
    const provider = new MockModelProvider({
      cannedResponses: [{ content: 'Worker processed job successfully.' }]
    });

    const runner = new AgentWorkerRunner({ config, provider });
    expect(runner.getStatus().isRunning).toBe(false);

    await runner.start();
    expect(runner.getStatus().isRunning).toBe(true);

    // Enqueue a job
    const queue = runner.getQueue();
    await queue.enqueue({
      task: mockTask,
      agent: mockAgent,
      prompt: 'Execute task'
    });

    // Wait briefly for job to finish
    await new Promise(r => setTimeout(r, 50));

    await runner.stop();
    expect(runner.getStatus().isRunning).toBe(false);
  });

  it('recovers expired run leases before accepting queue work', async () => {
    const runRepo = {
      recoverStaleRuns: vi.fn().mockResolvedValue(2)
    } as any;
    const taskQueue = {
      process: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined)
    } as any;
    const runner = new AgentWorkerRunner({ config, runRepo, taskQueue });

    await runner.start();

    expect(runRepo.recoverStaleRuns).toHaveBeenCalledWith();
    expect(taskQueue.process).toHaveBeenCalled();
    await runner.stop();
  });

  it.each([
    { name: 'paused', paused: true, emergencyStop: false },
    { name: 'emergency stop', paused: true, emergencyStop: true }
  ])('does not start a provider run while control state is $name', async ({ paused, emergencyStop }) => {
    const provider = { run: vi.fn() } as any;
    const controlStateRepo = {
      getControlState: vi.fn().mockResolvedValue({
        paused,
        emergencyStop,
        updatedBy: 'telegram-owner',
        updatedAt: new Date()
      })
    };
    let handler: ((job: any) => Promise<unknown>) | undefined;
    const taskQueue = {
      enqueue: vi.fn().mockResolvedValue('job-1'),
      defer: vi.fn().mockResolvedValue('deferred-job-1'),
      process: vi.fn((_concurrency: number, jobHandler: (job: any) => Promise<unknown>) => {
        handler = jobHandler;
      }),
      close: vi.fn().mockResolvedValue(undefined)
    } as any;
    const runner = new AgentWorkerRunner({
      config,
      provider,
      taskQueue,
      controlStateRepo
    });

    await runner.start();
    await handler!({ task: mockTask, agent: mockAgent, prompt: 'must be deferred' });

    expect(provider.run).not.toHaveBeenCalled();
    expect(taskQueue.defer).toHaveBeenCalledWith(
      expect.objectContaining({ task: mockTask }),
      expect.any(Number)
    );
    await runner.stop();
  });

  it('executes an allowed memory tool through the worker gateway', async () => {
    const provider = {
      run: vi.fn()
        .mockResolvedValueOnce({
          content: 'Searching approved memory.',
          toolCalls: [{ id: crypto.randomUUID(), name: 'memory.search', arguments: { query: 'approved' } }],
          inputTokens: 1,
          outputTokens: 1,
          costUsd: 0.001,
          finishReason: 'tool_calls'
        })
        .mockResolvedValueOnce({
          content: 'Memory search completed.',
          inputTokens: 1,
          outputTokens: 1,
          costUsd: 0.001,
          finishReason: 'stop'
        })
    } as any;
    const memoryStore = new InMemoryMemoryStore();
    const now = new Date().toISOString();
    await memoryStore.save({
      id: crypto.randomUUID(),
      type: 'semantic',
      status: 'verified',
      content: 'Approved research memory',
      scope: 'approved_research',
      author: 'ned',
      source: 'test',
      confidence: 0.9,
      taskId: null,
      artifactId: null,
      metadata: {},
      expiresAt: null,
      createdAt: now,
      updatedAt: now
    });
    const agent = {
      ...mockAgent,
      id: 'ned',
      role: 'researcher' as const,
      permissions: {
        ...mockAgent.permissions,
        tools: ['memory.search'],
        dataScopes: ['approved_research']
      }
    };
    const runner = new AgentWorkerRunner({ config, provider, memoryStore });

    await runner.start();
    await runner.getQueue().enqueue({ task: mockTask, agent, prompt: 'Search memory' });
    await new Promise(r => setTimeout(r, 50));
    await runner.stop();

    expect(provider.run).toHaveBeenCalledTimes(2);
  });
});
