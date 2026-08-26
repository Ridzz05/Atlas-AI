import { describe, expect, it } from 'vitest';
import { QAGate } from '../src/index.js';
import { MockModelProvider } from '@atlas/providers';
import { defaultAgentRegistry } from '@atlas/agents';
import { Task } from '@atlas/shared';

const task: Task = {
  id: 'parent-task-1234-5678-90ab-cdef12345678',
  parentId: null,
  title: 'QA test task',
  goal: 'Verify specialist output',
  assignedAgent: 'chief',
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

describe('QAGate', () => {
  it('blocks malformed model output instead of treating it as PASS', async () => {
    const gate = new QAGate({
      provider: new MockModelProvider({ cannedResponses: [{ content: '{not-json' }] }),
      argusAgent: defaultAgentRegistry.getOrThrow('argus')
    });

    const result = await gate.evaluate(task, new Map([['step-1', { agentId: 'ned', content: 'Unverified output' }]]));

    expect(result.verdict).toBe('BLOCKED');
    expect(result.passed).toBe(false);
    expect(result.findings.join(' ')).toContain('valid JSON');
  });

  it('blocks unknown QA verdicts', async () => {
    const gate = new QAGate({
      provider: new MockModelProvider({
        cannedResponses: [{ content: JSON.stringify({ verdict: 'MAYBE', findings: [], recommendations: [] }) }]
      }),
      argusAgent: defaultAgentRegistry.getOrThrow('argus')
    });

    const result = await gate.evaluate(task, new Map());

    expect(result.verdict).toBe('BLOCKED');
    expect(result.passed).toBe(false);
  });
});
