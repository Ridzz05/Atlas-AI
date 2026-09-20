import { Task, TaskPlan, TaskPlanSchema } from '@atlas/shared';
import { ModelProvider } from '@atlas/providers';
import { AgentRegistry } from '@atlas/agents';
import { MessageRepository } from '@atlas/database';
import { rootLogger } from '@atlas/observability';
import { PlanValidator } from './plan-validator.js';
import type { AgentRunner } from '../engine/agent-runner.js';

export interface TaskPlannerOptions {
  provider: ModelProvider;
  registry: AgentRegistry;
  messageRepo?: MessageRepository;
  runner?: AgentRunner;
}

export class TaskPlanner {
  constructor(private options: TaskPlannerOptions) {}

  public async plan(task: Task, signal?: AbortSignal, onCost?: (costUsd: number) => void): Promise<TaskPlan> {
    rootLogger.info(`Planning subtasks for task ${task.id}: "${task.goal}"`);

    const availableAgents = this.options.registry
      .list()
      .map(a => `- ${a.id} (${a.name}, ${a.role}): ${a.description}`)
      .join('\n');

    const prompt = `You are Chief, the root orchestrator.
Decompose the following user goal into a structured, dependency-ordered multi-agent execution plan.

USER GOAL:
"${task.goal}"

AVAILABLE AGENTS:
${availableAgents}

You must return a valid JSON object strictly matching this schema:
{
  "goal": "...",
  "assumptions": ["..."],
  "questions": ["..."],
  "steps": [
    {
      "id": "step_1",
      "agent": "ned",
      "objective": "...",
      "depends_on": [],
      "parallelizable": true,
      "expected_artifact": "..."
    }
  ],
  "approval_points": ["..."],
  "estimated_cost_usd": 0.50
}

RULES:
1. Steps must use only available agent IDs (ned, luna, layla, hermes, argus).
2. Max steps is 8.
3. Steps with no dependencies can run in parallel.
4. If outreach or external mutation is needed, add it to approval_points.
5. Return ONLY the JSON object.`;

    let resultContent: string;
    let costUsd = 0;
    if (this.options.runner) {
      const result = await this.runThroughDurableRunner(task, prompt, signal);
      resultContent = result.content;
      costUsd = result.costUsd;
    } else {
      const result = await this.options.provider.run({
        runId: crypto.randomUUID(),
        agentId: 'chief',
        messages: [{ role: 'user', content: prompt }],
        signal
      });
      resultContent = result.content;
      costUsd = result.costUsd;
    }
    onCost?.(costUsd);

    let parsedPlan: TaskPlan;
    try {
      const cleaned = resultContent
        .replace(/```json\s*/g, '')
        .replace(/```\s*$/g, '')
        .trim();
      parsedPlan = TaskPlanSchema.parse(JSON.parse(cleaned));
    } catch (err) {
      // There is no plan to respect: the model's output was not a plan at all. The fallback applies,
      // and the disclosure below tells the operator a default plan is running.
      rootLogger.warn(`Failed to parse LLM plan output for task ${task.id}, using fallback plan`, { error: String(err) });
      return this.useFallbackPlan(task);
    }

    // Past this point the model DID produce a plan, so a rejection here is a decision about that plan
    // rather than a parse failure. This call used to sit inside the try above, where the catch
    // swallowed it: a plan rejected for a dependency cycle, an unknown agent, duplicate step ids,
    // more than eight steps, or a cost over the cap was discarded and the hardcoded fallback ran
    // instead — the rejection had no effect on what executed. docs/AGENTS.md:8 requires this to stop
    // the task instead.
    const validatedPlan = PlanValidator.assertValid(parsedPlan, { registry: this.options.registry });

    if (this.options.messageRepo) {
      await this.options.messageRepo.create({
        taskId: task.id,
        senderType: 'user',
        senderId: 'user',
        content: task.goal,
        metadata: { stage: 'intake' }
      });

      const stepSummary = validatedPlan.steps.map((s, idx) => `${idx + 1}. [${s.agent.toUpperCase()}]: ${s.objective}`).join('\n');
      const planOverview = `Menerima instruksi dari Operator: "${task.goal}"\n\nMenyusun rencana kerja ${validatedPlan.steps.length} langkah:\n${stepSummary}\n\nMemulai delegasi ke armada spesialis...`;

      await this.options.messageRepo.create({
        taskId: task.id,
        senderType: 'agent',
        senderId: 'chief',
        content: planOverview,
        metadata: { stage: 'planning', stepsCount: validatedPlan.steps.length }
      });
    }

    return validatedPlan;
  }

  /**
   * The disclosed default plan, for a model response that is not a plan at all.
   *
   * The fallback names agents and declares dependencies, so it is held to the same validator as the
   * model's plan. Without that, an edit to the fallback (a renamed agent, a broken dependency) would
   * fail later, at delegation time, instead of here.
   */
  private async useFallbackPlan(task: Task): Promise<TaskPlan> {
    const fallbackPlan = PlanValidator.assertValid(this.generateFallbackPlan(task), {
      registry: this.options.registry
    });

    if (this.options.messageRepo) {
      await this.options.messageRepo.create({
        taskId: task.id,
        senderType: 'user',
        senderId: 'user',
        content: task.goal,
        metadata: { stage: 'intake' }
      });
      await this.options.messageRepo.create({
        taskId: task.id,
        senderType: 'agent',
        senderId: 'chief',
        content: `Menerima instruksi: "${task.goal}". Menjalankan rencana kerja default.`,
        metadata: { stage: 'planning' }
      });
    }

    return fallbackPlan;
  }

  public generateFallbackPlan(task: Task): TaskPlan {
    const isLeadWorkflow = /lead|prospek|gym|klien|sales/i.test(task.goal);

    if (isLeadWorkflow) {
      return {
        goal: task.goal,
        assumptions: ['Target area and business profile specified by user'],
        questions: [],
        steps: [
          {
            id: 'step_1',
            agent: 'ned',
            objective: `Research and collect candidate businesses for: "${task.goal}"`,
            depends_on: [],
            parallelizable: true,
            expected_artifact: 'candidates.json'
          },
          {
            id: 'step_2',
            agent: 'layla',
            objective: 'Score and qualify candidate leads against ICP rubrics',
            depends_on: ['step_1'],
            parallelizable: false,
            expected_artifact: 'scored_leads.json'
          },
          {
            id: 'step_3',
            agent: 'hermes',
            objective: 'Draft personalized outreach messages for qualified prospects',
            depends_on: ['step_2'],
            parallelizable: false,
            expected_artifact: 'outreach_drafts.md'
          },
          {
            id: 'step_4',
            agent: 'argus',
            objective: 'Verify factual claims, lead scores, and compliance before presenting to user',
            depends_on: ['step_3'],
            parallelizable: false,
            expected_artifact: 'qa_verdict.json'
          }
        ],
        approval_points: ['communication.send_approved'],
        estimated_cost_usd: 0.75
      };
    }

    return {
      goal: task.goal,
      assumptions: [],
      questions: [],
      steps: [
        {
          id: 'step_1',
          agent: 'ned',
          objective: `Gather and verify information for: "${task.goal}"`,
          depends_on: [],
          parallelizable: true,
          expected_artifact: 'research_findings.md'
        },
        {
          id: 'step_2',
          agent: 'argus',
          objective: 'Verify factual findings and sources',
          depends_on: ['step_1'],
          parallelizable: false,
          expected_artifact: 'qa_report.md'
        }
      ],
      approval_points: [],
      estimated_cost_usd: 0.4
    };
  }

  private async runThroughDurableRunner(task: Task, prompt: string, signal?: AbortSignal): Promise<{ content: string; costUsd: number }> {
    const chiefAgent = this.options.registry.getOrThrow('chief');
    const summary = await this.options.runner!.run({
      task,
      agent: chiefAgent,
      initialPrompt: prompt,
      signal
    });
    if (summary.status !== 'completed') {
      throw new Error(`Planning run failed: ${summary.error || summary.status}`);
    }
    return { content: summary.finalContent, costUsd: summary.totalCostUsd };
  }
}
