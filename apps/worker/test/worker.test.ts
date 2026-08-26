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

  it('requeues persisted queued tasks when a prior enqueue was interrupted', async () => {
    const taskRepo = {
      list: vi.fn().mockResolvedValue([mockTask])
    } as any;
    const taskQueue = {
      enqueue: vi.fn().mockResolvedValue(mockTask.id),
      process: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined)
    } as any;
    const runner = new AgentWorkerRunner({ config, taskRepo, taskQueue });

    await runner.start();

    expect(taskRepo.list).toHaveBeenCalledWith({ status: 'queued', limit: 1000 });
    expect(taskQueue.enqueue).toHaveBeenCalledWith({
      task: mockTask,
      agent: expect.objectContaining({ id: 'chief' }),
      prompt: mockTask.goal
    });
    await runner.stop();
  });

  it('runs memory maintenance when the worker starts', async () => {
    const memoryStore = new InMemoryMemoryStore();
    const expiredId = crypto.randomUUID();
    const now = Date.now();
    await memoryStore.save({
      id: expiredId,
      type: 'semantic',
      status: 'deprecated',
      content: 'Expired memory ready for deletion',
      scope: 'global',
      author: 'system',
      source: 'test',
      confidence: 1,
      taskId: null,
      artifactId: null,
      metadata: {},
      expiresAt: new Date(now - 2 * 86_400_000).toISOString(),
      createdAt: new Date(now - 10 * 86_400_000).toISOString(),
      updatedAt: new Date(now - 9 * 86_400_000).toISOString()
    });

    const runner = new AgentWorkerRunner({
      config: {
        ...config,
        MEMORY_MAINTENANCE_INTERVAL_SECONDS: 3600,
        MEMORY_DELETION_GRACE_DAYS: 7
      } as any,
      memoryStore
    });

    await runner.start();

    expect(await memoryStore.findById(expiredId)).toBeNull();
    expect(await memoryStore.listExpired({ now: new Date(now) })).toEqual([]);
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
    expect(taskQueue.defer).toHaveBeenCalledWith(expect.objectContaining({ task: mockTask }), expect.any(Number));
    await runner.stop();
  });

  it('executes an allowed memory tool through the worker gateway', async () => {
    const provider = {
      run: vi
        .fn()
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

  it('executes deterministic lead scoring through the worker gateway', async () => {
    const provider = {
      run: vi
        .fn()
        .mockResolvedValueOnce({
          content: 'Scoring the lead with the registered rubric.',
          toolCalls: [
            {
              id: crypto.randomUUID(),
              name: 'lead.score',
              arguments: {
                leadId: 'gym-worker-1',
                name: 'Worker Gym',
                category: 'Fitness Center',
                location: 'Palembang',
                scores: {
                  businessTypeFit: 15,
                  channelCount: 10,
                  customerVolume: 10,
                  memberRetentionNeed: 15,
                  digitalPresenceQuality: 8,
                  responsiveness: 8,
                  csAutomationPotential: 10,
                  broadcastPotential: 8,
                  decisionMakerEase: 6,
                  dataFreshness: 10
                },
                evidence: {
                  businessTypeFit: 'Fitness center confirmed',
                  channelCount: 'WhatsApp and Instagram confirmed',
                  customerVolume: '600 members reported',
                  memberRetentionNeed: 'Retention program identified',
                  digitalPresenceQuality: 'Active digital profiles',
                  responsiveness: 'Response time observed',
                  csAutomationPotential: 'Manual support workflow identified',
                  broadcastPotential: 'Broadcast audience confirmed',
                  decisionMakerEase: 'Owner contact identified',
                  dataFreshness: 'Observed this week'
                }
              }
            }
          ],
          inputTokens: 1,
          outputTokens: 1,
          costUsd: 0.001,
          finishReason: 'tool_calls'
        })
        .mockResolvedValueOnce({
          content: 'Lead scoring completed with deterministic validation.',
          inputTokens: 1,
          outputTokens: 1,
          costUsd: 0.001,
          finishReason: 'stop'
        })
    } as any;
    const agent = {
      ...mockAgent,
      id: 'layla',
      role: 'lead_scoring' as const,
      permissions: {
        ...mockAgent.permissions,
        tools: ['lead.score']
      }
    };
    const runner = new AgentWorkerRunner({ config, provider });

    await runner.start();
    await runner.getQueue().enqueue({ task: mockTask, agent, prompt: 'Score this lead' });
    await new Promise(r => setTimeout(r, 50));
    await runner.stop();

    expect(provider.run).toHaveBeenCalledTimes(2);
    expect(provider.run.mock.calls[1]?.[0].messages.at(-1)?.content).toContain('qualified');
  });
});
