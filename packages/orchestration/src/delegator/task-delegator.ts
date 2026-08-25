import {
  Task,
  TaskPlan,
  PlanStep,
  SystemEvent
} from '@atlas/shared';
import { ModelProvider } from '@atlas/providers';
import { EventBus } from '@atlas/events';
import { rootLogger } from '@atlas/observability';
import { DepthGuard } from '@atlas/policy';
import { AgentRegistry } from '@atlas/agents';
import { TaskRepository, RunRepository } from '@atlas/database';
import { AgentRunner } from '../engine/agent-runner.js';
import { TaskPlanner } from '../planner/task-planner.js';
import { TaskSynthesizer } from '../synthesizer/task-synthesizer.js';
import { QAGate, QAResult } from '../qa/qa-gate.js';

export interface MultiAgentDelegatorOptions {
  provider: ModelProvider;
  registry: AgentRegistry;
  eventBus: EventBus;
  taskRepo?: TaskRepository;
  runRepo?: RunRepository;
  maxConcurrency?: number;
}

export interface DelegationResult {
  parentTaskId: string;
  plan: TaskPlan;
  subtaskResults: Map<string, { agentId: string; content: string }>;
  qaResult?: QAResult;
  finalSynthesis: string;
  totalCostUsd: number;
  status: 'completed' | 'failed' | 'cancelled';
}

export class TaskDelegator {
  private runner: AgentRunner;
  private planner: TaskPlanner;
  private synthesizer: TaskSynthesizer;
  private qaGate: QAGate;
  private maxConcurrency: number;

  constructor(private options: MultiAgentDelegatorOptions) {
    this.runner = new AgentRunner({
      provider: options.provider,
      eventBus: options.eventBus,
      taskRepo: options.taskRepo,
      runRepo: options.runRepo
    });

    this.planner = new TaskPlanner({
      provider: options.provider,
      registry: options.registry
    });

    const chiefAgent = options.registry.getOrThrow('chief');
    const argusAgent = options.registry.getOrThrow('argus');

    this.synthesizer = new TaskSynthesizer({
      provider: options.provider,
      chiefAgent
    });

    this.qaGate = new QAGate({
      provider: options.provider,
      argusAgent
    });

    this.maxConcurrency = options.maxConcurrency || 3;
  }

  public async executePlan(parentTask: Task, signal?: AbortSignal): Promise<DelegationResult> {
    rootLogger.info(`Starting multi-agent delegation for parent task ${parentTask.id}`);

    // 1. Generate Structured Plan if not already attached
    let plan = parentTask.plan;
    if (!plan) {
      plan = await this.planner.plan(parentTask, signal);
      if (this.options.taskRepo) {
        await this.options.taskRepo.updatePlan(parentTask.id, plan);
      }
    }

    const subtaskResults = new Map<string, { agentId: string; content: string }>();
    const completedStepIds = new Set<string>();
    const pendingSteps = [...plan.steps];
    let totalCostUsd = 0;

    // 2. Execute Dependency Graph iteratively
    while (pendingSteps.length > 0) {
      if (signal?.aborted) {
        throw new Error('Multi-agent execution aborted');
      }

      // Find steps whose dependencies are fully satisfied
      const readySteps = pendingSteps.filter(step =>
        step.depends_on.every(dep => completedStepIds.has(dep))
      );

      if (readySteps.length === 0) {
        throw new Error(`Deadlock in task plan dependencies: [${pendingSteps.map(s => s.id).join(', ')}]`);
      }

      // Batch ready steps up to maxConcurrency
      const batch = readySteps.slice(0, this.maxConcurrency);

      rootLogger.info(`Executing delegation batch of ${batch.length} steps: [${batch.map(s => `${s.id} (${s.agent})`).join(', ')}]`);

      const batchPromises = batch.map(async (step) => {
        // Enforce depth guard
        const depthValidation = DepthGuard.validateDelegation({
          parentAgentId: parentTask.assignedAgent,
          targetAgentId: step.agent,
          currentDepth: parentTask.depth
        });

        if (!depthValidation.allowed) {
          throw new Error(`Delegation rejected for step ${step.id}: ${depthValidation.reason}`);
        }

        const agent = this.options.registry.getOrThrow(step.agent);

        // Construct enriched subtask prompt with prior step dependencies
        const priorContext = step.depends_on
          .map(dep => `[Prior Output ${dep}]:\n${subtaskResults.get(dep)?.content || ''}`)
          .join('\n\n');

        const prompt = priorContext
          ? `OBJECTIVE: ${step.objective}\n\nDEPENDENT CONTEXT FROM PRIOR STEPS:\n${priorContext}`
          : `OBJECTIVE: ${step.objective}`;

        // Create child task record in DB if repository available
        let childTask: Task = {
          id: crypto.randomUUID(),
          parentId: parentTask.id,
          title: `Subtask: ${step.id} (${step.agent})`,
          goal: step.objective,
          assignedAgent: step.agent,
          depth: parentTask.depth + 1,
          status: 'queued',
          priority: parentTask.priority,
          context: { stepId: step.id, parentGoal: parentTask.goal },
          plan: null,
          result: null,
          error: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          completedAt: null
        };

        if (this.options.taskRepo) {
          childTask = await this.options.taskRepo.create({
            title: childTask.title,
            goal: childTask.goal,
            assignedAgent: childTask.assignedAgent,
            parentId: parentTask.id,
            priority: childTask.priority,
            context: childTask.context
          }, childTask.id);
        }

        // Run agent
        const summary = await this.runner.run({
          task: childTask,
          agent,
          initialPrompt: prompt,
          signal
        });

        if (summary.status !== 'completed') {
          throw new Error(`Subtask ${step.id} (${step.agent}) failed: ${summary.error || 'Unknown error'}`);
        }

        totalCostUsd += summary.totalCostUsd;
        return {
          stepId: step.id,
          agentId: step.agent,
          content: summary.finalContent
        };
      });

      const batchResults = await Promise.all(batchPromises);

      for (const res of batchResults) {
        subtaskResults.set(res.stepId, { agentId: res.agentId, content: res.content });
        completedStepIds.add(res.stepId);

        // Remove from pending
        const idx = pendingSteps.findIndex(s => s.id === res.stepId);
        if (idx !== -1) {
          pendingSteps.splice(idx, 1);
        }
      }
    }

    // 3. Argus QA Gate Verification
    let qaResult: QAResult | undefined;
    try {
      qaResult = await this.qaGate.evaluate(parentTask, subtaskResults, signal);
      rootLogger.info(`QA Gate result for task ${parentTask.id}: ${qaResult.verdict}`);
    } catch (err) {
      rootLogger.error('QA Gate execution failed; task is blocked', { error: String(err) });
      qaResult = {
        verdict: 'BLOCKED',
        findings: ['Argus QA execution failed before a trustworthy verdict was produced.'],
        recommendations: ['Retry QA after the provider or orchestration error is resolved.'],
        passed: false
      };
    }

    // 4. Chief Final Synthesis
    const finalSynthesis = qaResult.passed
      ? await this.synthesizer.synthesize(parentTask, subtaskResults, qaResult, signal)
      : `Task blocked by Argus QA gate (${qaResult.verdict}). ${qaResult.findings.join(' ')}`;

    // 5. Update Parent Task only after a passing QA gate.
    if (this.options.taskRepo) {
      await this.options.taskRepo.updateStatus(parentTask.id, qaResult.passed ? 'completed' : 'failed', {
        error: qaResult.passed ? undefined : qaResult.findings.join(' '),
        result: {
          synthesis: finalSynthesis,
          qaVerdict: qaResult?.verdict || 'PASS',
          subtaskCount: subtaskResults.size,
          totalCostUsd
        }
      });
    }

    return {
      parentTaskId: parentTask.id,
      plan,
      subtaskResults,
      qaResult,
      finalSynthesis,
      totalCostUsd,
      status: qaResult.passed ? 'completed' : 'failed'
    };
  }
}
