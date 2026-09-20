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

  /**
   * `review.requiredAgent` is declared by seven agent definitions and read by nothing. The QA gate
   * always runs Argus, so for the six agents that declare `argus` the declaration agrees with the
   * pipeline by luck rather than by construction — and `ceo` declares `cfo`, which no stage runs.
   *
   * The gate cannot honour an arbitrary reviewer: its prompt is Argus's own checklist, so running
   * the CFO through it would be theatre. What it can do is stop ignoring the declaration and say, in
   * the verdict a human reads, that the declared reviewer was not run.
   */
  const passResponse = JSON.stringify({ verdict: 'PASS', findings: [], recommendations: [] });

  it('reports a declared reviewer the gate cannot honour', async () => {
    const ceoTask: Task = { ...task, assignedAgent: 'ceo' };
    const gate = new QAGate({
      provider: new MockModelProvider({ cannedResponses: [{ content: passResponse }] }),
      argusAgent: defaultAgentRegistry.getOrThrow('argus'),
      resolveAgent: id => defaultAgentRegistry.get(id)
    });

    const result = await gate.evaluate(ceoTask, new Map());

    expect(result.findings.join(' ')).toContain('cfo');
    expect(result.findings.join(' ')).toContain('requiredAgent');
  });

  it('stays quiet when the declared reviewer is the one it ran', async () => {
    const gate = new QAGate({
      provider: new MockModelProvider({ cannedResponses: [{ content: passResponse }] }),
      argusAgent: defaultAgentRegistry.getOrThrow('argus'),
      resolveAgent: id => defaultAgentRegistry.get(id)
    });

    // `chief` declares `argus`, which is exactly who the gate runs.
    const result = await gate.evaluate(task, new Map());

    expect(result.findings.join(' ')).not.toContain('requiredAgent');
  });

  it('stays quiet when the caller supplies no way to resolve the declaring agent', async () => {
    const ceoTask: Task = { ...task, assignedAgent: 'ceo' };
    const gate = new QAGate({
      provider: new MockModelProvider({ cannedResponses: [{ content: passResponse }] }),
      argusAgent: defaultAgentRegistry.getOrThrow('argus')
    });

    const result = await gate.evaluate(ceoTask, new Map());

    expect(result.findings.join(' ')).not.toContain('requiredAgent');
  });
});
