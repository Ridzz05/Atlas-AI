import { describe, it, expect } from 'vitest';
import { SDLCEngine, phaseOutcomeFromTaskStatus } from '../src/sdlc/sdlc-engine.js';
import { extractJsonObject, parsePhaseOutput, buildPhasePrompt } from '../src/sdlc/phase-prompts.js';
import { defaultAgentRegistry } from '@atlas/agents';
import { SDLCInitiative, SDLCPhase } from '@atlas/shared';

/**
 * In-memory doubles. The SDLC repository double implements the same compare-and-set
 * contract as the SQL repository (`attachPhaseTask` returns null when the phase has moved
 * on or a task is already attached), because that contract is what stops a phase from being
 * executed twice.
 */
class InMemorySDLCRepository {
  private initiatives = new Map<string, SDLCInitiative>();

  public async create(params: any): Promise<SDLCInitiative> {
    const id = params.id || crypto.randomUUID();
    const initiative: SDLCInitiative = {
      id,
      title: params.title,
      intent: params.intent,
      status: 'active',
      currentPhase: 'inception',
      phaseAttempt: 0,
      artifacts: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    this.initiatives.set(id, initiative);
    return initiative;
  }

  public async findById(id: string): Promise<SDLCInitiative | null> {
    return this.initiatives.get(id) || null;
  }

  public async findByPhaseTaskId(taskId: string): Promise<SDLCInitiative | null> {
    for (const initiative of this.initiatives.values()) {
      if (initiative.phaseTaskId === taskId) return initiative;
    }
    return null;
  }

  public async attachPhaseTask(id: string, phase: SDLCPhase, taskId: string): Promise<SDLCInitiative | null> {
    const current = this.initiatives.get(id);
    if (!current) return null;
    if (current.currentPhase !== phase) return null;
    if (current.phaseTaskId && current.phaseTaskId !== taskId) return null;

    const updated = { ...current, phaseTaskId: taskId, phaseAttempt: current.phaseAttempt + 1 };
    this.initiatives.set(id, updated);
    return updated;
  }

  public async advancePhase(id: string, nextPhase: SDLCPhase, updates: any = {}): Promise<SDLCInitiative> {
    const current = this.initiatives.get(id);
    if (!current) throw new Error(`SDLC Initiative not found: ${id}`);

    const updated: SDLCInitiative = {
      ...current,
      currentPhase: nextPhase,
      status: updates.status || current.status,
      strategicBrief: updates.strategicBrief || current.strategicBrief,
      technicalSpec: updates.technicalSpec || current.technicalSpec,
      budgetEnvelope: updates.budgetEnvelope || current.budgetEnvelope,
      sprintPlan: updates.sprintPlan || current.sprintPlan,
      qaReport: updates.qaReport || current.qaReport,
      phaseTaskId: undefined,
      updatedAt: new Date().toISOString()
    };
    this.initiatives.set(id, updated);
    return updated;
  }
}

class InMemoryTaskRepository {
  public tasks = new Map<string, any>();

  public async create(input: any, id?: string): Promise<any> {
    const taskId = id || crypto.randomUUID();
    const task = {
      id: taskId,
      parentId: input.parentId ?? null,
      title: input.title,
      goal: input.goal,
      assignedAgent: input.assignedAgent,
      status: 'queued',
      priority: input.priority || 'normal',
      context: input.context || {},
      result: null
    };
    this.tasks.set(taskId, task);
    return task;
  }

  public async findById(id: string): Promise<any> {
    return this.tasks.get(id) || null;
  }
}

class RecordingTaskQueue {
  public enqueued: Array<{ taskId: string; agentId: string; prompt: string }> = [];

  public async enqueue(data: any): Promise<string> {
    this.enqueued.push({ taskId: data.task.id, agentId: data.agent.id, prompt: data.prompt });
    return data.runId || data.task.id;
  }
}

function buildEngine() {
  const sdlcRepo = new InMemorySDLCRepository();
  const taskRepo = new InMemoryTaskRepository();
  const taskQueue = new RecordingTaskQueue();
  const engine = new SDLCEngine({
    sdlcRepo: sdlcRepo as any,
    taskRepo: taskRepo as any,
    taskQueue: taskQueue as any,
    registry: defaultAgentRegistry
  });
  return { engine, sdlcRepo, taskRepo, taskQueue };
}

const brief = {
  title: 'Initiative',
  executiveSummary: 'Summary',
  problemStatement: 'Problem',
  targetAudience: 'Ops',
  keyObjectives: ['Objective'],
  acceptanceCriteria: ['Criterion'],
  strategicPriority: 'high' as const,
  authorAgent: 'ceo',
  createdAt: new Date().toISOString()
};

const spec = {
  architectureSummary: 'Architecture',
  requiredCapabilities: ['research'],
  allowedTools: ['web.search'],
  disallowedTools: [],
  securityConsiderations: ['No credential exposure'],
  technicalFeasibility: 'approved' as const,
  authorAgent: 'cto',
  createdAt: new Date().toISOString()
};

const envelope = {
  estimatedCostUsd: 0.4,
  maxAuthorizedCostUsd: 1.0,
  estimatedTokenCount: 40000,
  roiRationale: 'Justified',
  financialApproval: 'approved' as const,
  authorAgent: 'cfo',
  createdAt: new Date().toISOString()
};

const sprintPlan = {
  decompositionStrategy: 'Sequential',
  maxConcurrency: 2,
  subtasks: [
    {
      stepId: 'step-1',
      title: 'Research',
      assignedAgent: 'ned',
      goal: 'Gather evidence',
      dependencies: [],
      depth: 1
    }
  ],
  authorAgent: 'coo',
  createdAt: new Date().toISOString()
};

const qaReport = {
  verificationScore: 92,
  complianceChecks: [{ name: 'Scope Fidelity', passed: true, notes: 'ok' }],
  riskAssessment: 'low' as const,
  verdict: 'PASS' as const,
  critique: 'Clean',
  authorAgent: 'argus',
  createdAt: new Date().toISOString()
};

describe('@atlas/orchestration SDLCEngine (coordinator over the task pipeline)', () => {
  it('enqueues the inception phase as a task assigned to the CEO', async () => {
    const { engine, sdlcRepo, taskQueue } = buildEngine();
    const initiative = await sdlcRepo.create({ title: 'T', intent: 'I' });

    const updated = await engine.startPhase(initiative.id);

    expect(taskQueue.enqueued).toHaveLength(1);
    expect(taskQueue.enqueued[0].agentId).toBe('ceo');
    expect(updated.currentPhase).toBe('inception');
    expect(updated.phaseTaskId).toBe(taskQueue.enqueued[0].taskId);
    expect(updated.phaseAttempt).toBe(1);
  });

  it('does not enqueue a second task when a phase already has one open', async () => {
    const { engine, sdlcRepo, taskQueue } = buildEngine();
    const initiative = await sdlcRepo.create({ title: 'T', intent: 'I' });

    await engine.startPhase(initiative.id);
    await engine.startPhase(initiative.id);

    expect(taskQueue.enqueued).toHaveLength(1);
  });

  it('enqueues only one task when two callers start the same phase concurrently', async () => {
    const { engine, sdlcRepo, taskQueue } = buildEngine();
    const initiative = await sdlcRepo.create({ title: 'T', intent: 'I' });

    await Promise.all([engine.startPhase(initiative.id), engine.startPhase(initiative.id)]);

    expect(taskQueue.enqueued).toHaveLength(1);
  });

  it('pauses the initiative instead of advancing when a phase output cannot be parsed', async () => {
    const { engine, sdlcRepo, taskQueue } = buildEngine();
    const initiative = await sdlcRepo.create({ title: 'T', intent: 'I' });
    const started = await engine.startPhase(initiative.id);

    const result = await engine.recordPhaseResult(started.phaseTaskId as string, {
      outcome: 'completed',
      output: 'I am unable to produce a JSON object for this request.'
    });

    expect(result?.currentPhase).toBe('inception');
    expect(result?.status).toBe('paused');
    // No further phase may be enqueued from an unparsable result.
    expect(taskQueue.enqueued).toHaveLength(1);
  });

  it('pauses the initiative when the phase task itself failed', async () => {
    const { engine, sdlcRepo, taskQueue } = buildEngine();
    const initiative = await sdlcRepo.create({ title: 'T', intent: 'I' });
    const started = await engine.startPhase(initiative.id);

    const result = await engine.recordPhaseResult(started.phaseTaskId as string, {
      outcome: 'failed',
      output: ''
    });

    expect(result?.status).toBe('paused');
    expect(taskQueue.enqueued).toHaveLength(1);
  });

  it('advances inception -> architecture and enqueues the CTO phase', async () => {
    const { engine, sdlcRepo, taskQueue } = buildEngine();
    const initiative = await sdlcRepo.create({ title: 'T', intent: 'I' });
    const started = await engine.startPhase(initiative.id);

    const result = await engine.recordPhaseResult(started.phaseTaskId as string, {
      outcome: 'completed',
      output: `\`\`\`json\n${JSON.stringify(brief)}\n\`\`\``
    });

    expect(result?.currentPhase).toBe('architecture');
    expect(result?.status).toBe('active');
    expect(result?.strategicBrief?.executiveSummary).toBe('Summary');
    expect(taskQueue.enqueued).toHaveLength(2);
    expect(taskQueue.enqueued[1].agentId).toBe('cto');
  });

  it('holds at the budget gate when the CFO does not approve', async () => {
    const { engine, sdlcRepo, taskQueue } = buildEngine();
    const initiative = await sdlcRepo.create({ title: 'T', intent: 'I' });
    await sdlcRepo.advancePhase(initiative.id, 'budget_gate', { strategicBrief: brief, technicalSpec: spec });
    const started = await engine.startPhase(initiative.id);

    expect(taskQueue.enqueued[0].agentId).toBe('cfo');

    const result = await engine.recordPhaseResult(started.phaseTaskId as string, {
      outcome: 'completed',
      output: JSON.stringify({ ...envelope, financialApproval: 'escalated_to_human' })
    });

    expect(result?.currentPhase).toBe('budget_gate');
    expect(result?.status).toBe('paused');
    expect(taskQueue.enqueued).toHaveLength(1);
  });

  it('fails the initiative when Argus does not pass the compliance audit', async () => {
    const { engine, sdlcRepo, taskQueue } = buildEngine();
    const initiative = await sdlcRepo.create({ title: 'T', intent: 'I' });
    await sdlcRepo.advancePhase(initiative.id, 'qa_compliance', { sprintPlan });
    const started = await engine.startPhase(initiative.id);

    expect(taskQueue.enqueued[0].agentId).toBe('argus');

    const result = await engine.recordPhaseResult(started.phaseTaskId as string, {
      outcome: 'completed',
      output: JSON.stringify({ ...qaReport, verdict: 'REVISE' })
    });

    expect(result?.currentPhase).toBe('failed');
    expect(result?.status).toBe('failed');
    expect(taskQueue.enqueued).toHaveLength(1);
  });

  it('runs the whole lifecycle to completion across separate task executions', async () => {
    const { engine, sdlcRepo, taskRepo, taskQueue } = buildEngine();
    const initiative = await sdlcRepo.create({ title: 'T', intent: 'I' });

    const outputs: Record<string, string> = {
      inception: JSON.stringify(brief),
      architecture: JSON.stringify(spec),
      budget_gate: JSON.stringify(envelope),
      sprint_planning: JSON.stringify(sprintPlan),
      implementation: 'Sprint executed; deliverables written.',
      qa_compliance: JSON.stringify(qaReport),
      release_signoff: 'Release package prepared.'
    };

    let current = await engine.startPhase(initiative.id);
    const visited: string[] = [];

    for (let step = 0; step < 8; step += 1) {
      if (current.currentPhase === 'completed' || current.currentPhase === 'failed') break;
      const phaseTaskId = current.phaseTaskId as string;
      expect(phaseTaskId).toBeTruthy();

      visited.push(current.currentPhase);
      // Simulate the worker writing the terminal status and result before reporting back.
      const task = taskRepo.tasks.get(phaseTaskId);
      task.status = 'completed';
      task.result = { summary: outputs[current.currentPhase] };

      const next = await engine.recordPhaseResult(phaseTaskId, {
        outcome: 'completed',
        output: outputs[current.currentPhase]
      });
      expect(next).not.toBeNull();
      current = next as SDLCInitiative;
    }

    expect(visited).toEqual([
      'inception',
      'architecture',
      'budget_gate',
      'sprint_planning',
      'implementation',
      'qa_compliance',
      'release_signoff'
    ]);
    expect(current.currentPhase).toBe('completed');
    expect(current.status).toBe('completed');
    // Seven phases -> exactly seven tasks, one per phase, no duplicates.
    expect(taskQueue.enqueued).toHaveLength(7);
  });

  it('ignores tasks that are not SDLC phase tasks', async () => {
    const { engine } = buildEngine();
    const result = await engine.recordPhaseResult(crypto.randomUUID(), { outcome: 'completed', output: '{}' });
    expect(result).toBeNull();
  });
});

describe('@atlas/orchestration SDLC phase prompts', () => {
  it('extracts JSON from fenced and unfenced responses, and rejects prose', () => {
    expect(extractJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJsonObject('here you go {"a":2} done')).toEqual({ a: 2 });
    expect(extractJsonObject('no json here')).toBeNull();
    expect(extractJsonObject('["not","an","object"]')).toBeNull();
  });

  it('fails validation rather than substituting a default verdict', () => {
    const bad = parsePhaseOutput('qa_compliance', '{"verdict":"PASS"}');
    expect(bad.ok).toBe(false);

    const good = parsePhaseOutput('qa_compliance', JSON.stringify(qaReport));
    expect(good.ok).toBe(true);
  });

  it('treats implementation and release sign-off as free-form work', () => {
    expect(parsePhaseOutput('implementation', 'anything').ok).toBe(true);
    expect(parsePhaseOutput('release_signoff', 'anything').ok).toBe(true);
  });

  it('names the initiative in the phase prompt', () => {
    const initiative: SDLCInitiative = {
      id: crypto.randomUUID(),
      title: 'Acme',
      intent: 'Grow revenue',
      status: 'active',
      currentPhase: 'budget_gate',
      phaseAttempt: 0,
      artifacts: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const prompt = buildPhasePrompt('budget_gate', initiative);
    expect(prompt).toContain('Acme');
    expect(prompt).toContain('financialApproval');
  });
});

describe('@atlas/orchestration phase outcome mapping', () => {
  it('maps every terminal task status to a phase outcome', () => {
    expect(phaseOutcomeFromTaskStatus('completed')).toBe('completed');
    expect(phaseOutcomeFromTaskStatus('failed')).toBe('failed');
    expect(phaseOutcomeFromTaskStatus('cancelled')).toBe('cancelled');
    expect(phaseOutcomeFromTaskStatus('approval_pending')).toBe('waiting_approval');
  });

  it('reports nothing for a task that has not ended', () => {
    for (const status of ['queued', 'planning', 'running', 'review_pending']) {
      expect(phaseOutcomeFromTaskStatus(status)).toBeNull();
    }
  });
});
