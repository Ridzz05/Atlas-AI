import { describe, it, expect, vi } from 'vitest';
import { AgentWorkerRunner } from '../src/worker.js';
import { EnvConfigSchema, Task, AgentDefinition } from '@atlas/shared';
import { MockModelProvider } from '@atlas/providers';

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
});
