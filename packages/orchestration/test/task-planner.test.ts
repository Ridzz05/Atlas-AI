import { describe, expect, it, vi } from 'vitest';
import { TaskPlanner } from '../src/planner/task-planner.js';
import { PlanValidator } from '../src/planner/plan-validator.js';
import { defaultAgentRegistry } from '@atlas/agents';
import { MockModelProvider } from '@atlas/providers';
import { Task } from '@atlas/shared';

/**
 * A plan the validator REJECTED must not be replaced by a canned plan.
 *
 * `plan()` wrapped parsing, schema validation AND `PlanValidator.assertValid` in one try, and the
 * catch returned `generateFallbackPlan(task)`. So a plan rejected for a cycle, an unknown agent,
 * duplicate step ids, more than eight steps, or a cost over the cap was discarded and a hardcoded
 * plan ran instead — the rejection had no effect on what executed. `docs/AGENTS.md:8` states the rule
 * this breaks: "Fail Closed: If permissions, schemas, or approval checks are ambiguous, execution
 * stops."
 *
 * The two failure modes are not the same and are treated differently:
 *
 * - The model returned nothing usable (not JSON, or not a plan). There is no plan to respect, so the
 *   disclosed fallback still applies — the operator sees "Menjalankan rencana kerja default" in the
 *   message stream.
 * - The model returned a plan and the validator REJECTED it. That is a decision, and it must stop the
 *   task rather than be silently overridden.
 */
const task: Task = {
  id: '123e4567-e89b-12d3-a456-426614174300',
  parentId: null,
  title: 'Planner probe',
  goal: 'Find gym prospects in Palembang and draft outreach',
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

function buildPlanner(responseContent: string) {
  const provider = new MockModelProvider({ cannedResponses: [{ content: responseContent }] });
  return new TaskPlanner({ provider, registry: defaultAgentRegistry });
}

/** A plan that is structurally fine but names an agent the registry does not have. */
const planWithUnknownAgent = JSON.stringify({
  goal: 'probe',
  assumptions: [],
  questions: [],
  steps: [
    { id: 'step_1', agent: 'nonexistent-agent', objective: 'Do the thing', depends_on: [], parallelizable: true, expected_artifact: 'a.md' }
  ],
  approval_points: [],
  estimated_cost_usd: 0.1
});

/** A plan with a dependency cycle, which the validator rejects. */
const planWithCycle = JSON.stringify({
  goal: 'probe',
  assumptions: [],
  questions: [],
  steps: [
    { id: 'step_1', agent: 'ned', objective: 'A', depends_on: ['step_2'], parallelizable: false, expected_artifact: 'a.md' },
    { id: 'step_2', agent: 'argus', objective: 'B', depends_on: ['step_1'], parallelizable: false, expected_artifact: 'b.md' }
  ],
  approval_points: [],
  estimated_cost_usd: 0.1
});

/** A valid plan, to prove the happy path is unaffected. */
const validPlan = JSON.stringify({
  goal: 'probe',
  assumptions: [],
  questions: [],
  steps: [
    {
      id: 'step_1',
      agent: 'ned',
      objective: 'Research prospects',
      depends_on: [],
      parallelizable: true,
      expected_artifact: 'candidates.json'
    },
    {
      id: 'step_2',
      agent: 'argus',
      objective: 'Verify findings',
      depends_on: ['step_1'],
      parallelizable: false,
      expected_artifact: 'qa.json'
    }
  ],
  approval_points: [],
  estimated_cost_usd: 0.3
});

describe('TaskPlanner plan validation', () => {
  it('returns a valid plan unchanged', async () => {
    const plan = await buildPlanner(validPlan).plan(task);

    expect(plan.steps.map(s => s.agent)).toEqual(['ned', 'argus']);
  });

  it('fails closed when the validator rejects the plan for an unknown agent', async () => {
    const planner = buildPlanner(planWithUnknownAgent);

    await expect(planner.plan(task)).rejects.toThrow(/nonexistent-agent|unknown/i);
  });

  it('fails closed when the validator rejects the plan for a dependency cycle', async () => {
    const planner = buildPlanner(planWithCycle);

    await expect(planner.plan(task)).rejects.toThrow(/cycle/i);
  });

  it('fails closed when the plan exceeds the step limit', async () => {
    const manySteps = JSON.stringify({
      goal: 'probe',
      assumptions: [],
      questions: [],
      steps: Array.from({ length: 9 }, (_, i) => ({
        id: `step_${i + 1}`,
        agent: 'ned',
        objective: `Step ${i + 1}`,
        depends_on: [],
        parallelizable: true,
        expected_artifact: `s${i + 1}.md`
      })),
      approval_points: [],
      estimated_cost_usd: 0.1
    });

    await expect(buildPlanner(manySteps).plan(task)).rejects.toThrow(/maximum|steps/i);
  });

  // The fallback is still available when there is no plan to respect, and it is disclosed.
  it('falls back when the model returned nothing parseable, and discloses it', async () => {
    const messageRepo = { create: vi.fn(async () => ({ id: 'm1' })) };
    const provider = new MockModelProvider({ cannedResponses: [{ content: 'I am afraid I cannot help with that.' }] });
    const planner = new TaskPlanner({ provider, registry: defaultAgentRegistry, messageRepo: messageRepo as never });

    const plan = await planner.plan(task);

    expect(plan.steps.length).toBeGreaterThan(0);
    const posted = messageRepo.create.mock.calls.map(call => (call[0] as { content: string }).content);
    expect(posted.some(content => /default/i.test(content))).toBe(true);
  });

  // The fallback names agents, so it must satisfy the same validator the model's plan does.
  // Otherwise an edit to the fallback (a renamed agent, a bad dependency) fails at delegation time
  // instead of here.
  it('produces a fallback that passes the validator', async () => {
    const planner = buildPlanner('not json at all');

    const plan = await planner.plan(task);

    expect(() => PlanValidator.assertValid(plan, { registry: defaultAgentRegistry })).not.toThrow();
  });

  it('validates the fallback even for a non-lead goal', async () => {
    const planner = buildPlanner('{malformed');
    const otherTask: Task = { ...task, goal: 'Summarise the architecture decision log' };

    const plan = await planner.plan(otherTask);

    expect(() => PlanValidator.assertValid(plan, { registry: defaultAgentRegistry })).not.toThrow();
  });
});
