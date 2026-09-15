import { Task, TaskPlan, PlanStep, TaskStatus } from '@atlas/shared';
import { ModelProvider } from '@atlas/providers';
import { createTaskLifecycleEvent, EventBus } from '@atlas/events';
import { rootLogger } from '@atlas/observability';
import { DepthGuard } from '@atlas/policy';
import { AgentRegistry } from '@atlas/agents';
import { BudgetRepository, TaskRepository, RunRepository, MessageRepository, ToolCallRepository } from '@atlas/database';
import { AgentRunner, RunCancellationStore, ToolExecutor } from '../engine/agent-runner.js';
import { TaskPlanner } from '../planner/task-planner.js';
import { TaskSynthesizer } from '../synthesizer/task-synthesizer.js';
import { QAGate, QAResult } from '../qa/qa-gate.js';
import { PlanValidator } from '../planner/plan-validator.js';
import { ApprovalResumeContext } from '../queue/task-queue.js';
import type { ApprovalExecutionStore } from '@atlas/tools';

export interface MultiAgentDelegatorOptions {
  provider: ModelProvider;
  registry: AgentRegistry;
  eventBus: EventBus;
  taskRepo?: TaskRepository;
  runRepo?: RunRepository;
  messageRepo?: MessageRepository;
  toolCallRepo?: ToolCallRepository;
  budgetRepo?: BudgetRepository;
  globalDailyBudgetUsd?: number;
  toolExecutor?: ToolExecutor;
  approvalExecutionStore?: ApprovalExecutionStore;
  maxConcurrency?: number;
  maxDelegationDepth?: number;
  cancellationStore?: RunCancellationStore;
  workerId?: string;
  leaseSeconds?: number;
}

export interface DelegationResult {
  parentTaskId: string;
  plan: TaskPlan;
  subtaskResults: Map<string, { agentId: string; content: string }>;
  qaResult?: QAResult;
  finalSynthesis: string;
  totalCostUsd: number;
  status: 'completed' | 'failed' | 'cancelled' | 'waiting_approval';
  approvalId?: string;
}

export class TaskDelegator {
  private runner: AgentRunner;
  private stageRunner?: AgentRunner;
  private planner: TaskPlanner;
  private synthesizer: TaskSynthesizer;
  private qaGate: QAGate;
  private maxConcurrency: number;

  constructor(private options: MultiAgentDelegatorOptions) {
    this.runner = new AgentRunner({
      provider: options.provider,
      eventBus: options.eventBus,
      taskRepo: options.taskRepo,
      runRepo: options.runRepo,
      messageRepo: options.messageRepo,
      toolCallRepo: options.toolCallRepo,
      budgetRepo: options.budgetRepo,
      globalDailyBudgetUsd: options.globalDailyBudgetUsd,
      workerId: options.workerId,
      leaseSeconds: options.leaseSeconds,
      toolExecutor: options.toolExecutor,
      approvalExecutionStore: options.approvalExecutionStore,
      cancellationStore: options.cancellationStore
    });

    if (options.runRepo && options.budgetRepo) {
      this.stageRunner = new AgentRunner({
        provider: options.provider,
        eventBus: options.eventBus,
        runRepo: options.runRepo,
        messageRepo: options.messageRepo,
        budgetRepo: options.budgetRepo,
        globalDailyBudgetUsd: options.globalDailyBudgetUsd,
        workerId: options.workerId,
        leaseSeconds: options.leaseSeconds
      });
    }

    this.planner = new TaskPlanner({
      provider: options.provider,
      registry: options.registry,
      messageRepo: options.messageRepo,
      runner: this.stageRunner
    });

    const chiefAgent = options.registry.getOrThrow('chief');
    const argusAgent = options.registry.getOrThrow('argus');

    this.synthesizer = new TaskSynthesizer({
      provider: options.provider,
      chiefAgent,
      messageRepo: options.messageRepo,
      runner: this.stageRunner
    });

    this.qaGate = new QAGate({
      provider: options.provider,
      argusAgent,
      messageRepo: options.messageRepo,
      runner: this.stageRunner
    });

    this.maxConcurrency = options.maxConcurrency || 3;
  }

  public async executePlan(parentTask: Task, signal?: AbortSignal, approvalResume?: ApprovalResumeContext): Promise<DelegationResult> {
    rootLogger.info(`Starting multi-agent delegation for parent task ${parentTask.id}`);
    let totalCostUsd = 0;
    const addCost = (costUsd: number): void => {
      if (Number.isFinite(costUsd) && costUsd >= 0) totalCostUsd += costUsd;
    };

    // 1. Generate Structured Plan if not already attached
    let plan = parentTask.plan;
    if (!plan) {
      plan = await this.planner.plan(parentTask, signal, addCost);
      if (this.options.taskRepo) {
        await this.options.taskRepo.updatePlan(parentTask.id, plan);
        await this.publishTaskState(parentTask.id, parentTask.assignedAgent, 'running');
      }
    }
    PlanValidator.assertValid(plan, { registry: this.options.registry });

    const subtaskResults = new Map<string, { agentId: string; content: string }>();
    const completedStepIds = new Set<string>();
    const existingChildren =
      this.options.taskRepo && typeof (this.options.taskRepo as any).findChildren === 'function'
        ? await this.options.taskRepo.findChildren(parentTask.id)
        : [];
    const existingChildrenByStep = new Map<string, Task>();
    for (const child of existingChildren) {
      const stepId = typeof child.context.stepId === 'string' ? child.context.stepId : undefined;
      if (!stepId) continue;
      existingChildrenByStep.set(stepId, child);
      if (child.status === 'completed') {
        const summary = typeof child.result?.summary === 'string' ? child.result.summary : '';
        subtaskResults.set(stepId, { agentId: child.assignedAgent, content: summary });
        completedStepIds.add(stepId);
        totalCostUsd += Number(child.result?.totalCostUsd || 0);
      }
    }

    if (approvalResume && !existingChildren.some(child => child.id === approvalResume.taskId)) {
      throw new Error(`Approval resume target task not found under parent ${parentTask.id}.`);
    }

    const pendingSteps = plan.steps.filter(step => !completedStepIds.has(step.id));

    // 2. Execute Dependency Graph iteratively
    while (pendingSteps.length > 0) {
      if (signal?.aborted) {
        throw new Error('Multi-agent execution aborted');
      }

      // Find steps whose dependencies are fully satisfied
      const readySteps = pendingSteps.filter(step => step.depends_on.every(dep => completedStepIds.has(dep)));

      if (readySteps.length === 0) {
        throw new Error(`Deadlock in task plan dependencies: [${pendingSteps.map(s => s.id).join(', ')}]`);
      }

      // Batch ready steps up to maxConcurrency
      const batch = readySteps.slice(0, this.maxConcurrency);

      rootLogger.info(`Executing delegation batch of ${batch.length} steps: [${batch.map(s => `${s.id} (${s.agent})`).join(', ')}]`);

      const batchPromises = batch.map(async step => {
        // Enforce depth guard
        const depthValidation = DepthGuard.validateDelegation({
          parentAgentId: parentTask.assignedAgent,
          targetAgentId: step.agent,
          currentDepth: parentTask.depth,
          maxAllowedDepth: this.options.maxDelegationDepth
        });

        if (!depthValidation.allowed) {
          throw new Error(`Delegation rejected for step ${step.id}: ${depthValidation.reason}`);
        }

        const agent = this.options.registry.getOrThrow(step.agent);

        // Construct enriched subtask prompt with prior step dependencies
        const priorContext = step.depends_on.map(dep => `[Prior Output ${dep}]:\n${subtaskResults.get(dep)?.content || ''}`).join('\n\n');

        const prompt = priorContext
          ? `OBJECTIVE: ${step.objective}\n\nDEPENDENT CONTEXT FROM PRIOR STEPS:\n${priorContext}`
          : `OBJECTIVE: ${step.objective}`;

        // Create child task record in DB if repository available
        const existingChild = existingChildrenByStep.get(step.id);
        const resumableChild = existingChild && approvalResume && existingChild.id === approvalResume.taskId ? existingChild : undefined;
        let childTask: Task = resumableChild || {
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

        if (this.options.taskRepo && !existingChild) {
          childTask = await this.options.taskRepo.create(
            {
              title: childTask.title,
              goal: childTask.goal,
              assignedAgent: childTask.assignedAgent,
              parentId: parentTask.id,
              priority: childTask.priority,
              context: childTask.context
            },
            childTask.id
          );
          await this.publishTaskState(
            childTask.id,
            childTask.assignedAgent,
            'queued',
            { title: childTask.title, assignedAgent: childTask.assignedAgent },
            'task.created'
          );
        }

        // Publish transparent delegation dialogue
        await this.publishDialogue(
          parentTask.id,
          'chief',
          `[Chief ➔ ${agent.name}]: Melimpahkan subtask "${step.id}" kepada ${agent.name} (${agent.role}).\nFokus: ${step.objective}`,
          step.agent,
          { stage: 'delegation', stepId: step.id }
        );

        // Run agent
        const summary = await this.runner.run({
          task: childTask,
          agent,
          initialPrompt: prompt,
          signal,
          runId: approvalResume?.taskId === childTask.id ? approvalResume.runId : undefined,
          approvalToken: approvalResume?.taskId === childTask.id ? approvalResume.token : undefined
        });

        if (summary.status === 'waiting_approval') {
          totalCostUsd += summary.totalCostUsd;
          return {
            stepId: step.id,
            agentId: step.agent,
            content: '',
            status: 'waiting_approval' as const,
            approvalId: summary.approvalId
          };
        }

        if (summary.status !== 'completed') {
          throw new Error(`Subtask ${step.id} (${step.agent}) failed: ${summary.error || 'Unknown error'}`);
        }

        // Publish transparent completion dialogue
        await this.publishDialogue(
          parentTask.id,
          step.agent,
          `[${agent.name} ➔ Chief]: Subtask "${step.id}" tuntas dilaksanakan.\n\nRingkasan Hasil:\n${summary.finalContent || 'Eksekusi subtask tuntas.'}`,
          'chief',
          { stage: 'subtask_completed', stepId: step.id }
        );

        totalCostUsd += summary.totalCostUsd;
        return {
          stepId: step.id,
          agentId: step.agent,
          content: summary.finalContent,
          status: 'completed' as const
        };
      });

      const batchResults = await Promise.all(batchPromises);
      const waitingResult = batchResults.find(result => result.status === 'waiting_approval');
      if (waitingResult) {
        const finalSynthesis = `Task is waiting for human approval${waitingResult.approvalId ? ` (${waitingResult.approvalId})` : ''} before continuing.`;
        if (this.options.taskRepo) {
          await this.options.taskRepo.updateStatus(parentTask.id, 'approval_pending', {
            error: finalSynthesis,
            result: {
              approvalId: waitingResult.approvalId,
              subtaskCount: subtaskResults.size,
              totalCostUsd
            }
          });
          await this.publishTaskState(parentTask.id, parentTask.assignedAgent, 'approval_pending', {
            approvalId: waitingResult.approvalId,
            error: finalSynthesis
          });
        }
        return {
          parentTaskId: parentTask.id,
          plan,
          subtaskResults,
          finalSynthesis,
          totalCostUsd,
          status: 'waiting_approval',
          approvalId: waitingResult.approvalId
        };
      }

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
    const argusAgent = this.options.registry.getOrThrow('argus');
    await this.publishDialogue(
      parentTask.id,
      'chief',
      `[Chief ➔ Argus]: Seluruh subtask spesialis telah selesai dikerjakan. Mengajukan deliverable kepada Argus (${argusAgent.role}) untuk inspeksi QA dan gerbang risiko.`,
      'argus',
      { stage: 'qa_submission' }
    );

    let qaResult: QAResult | undefined;
    try {
      qaResult = await this.qaGate.evaluate(parentTask, subtaskResults, signal, addCost);
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
      ? await this.synthesizer.synthesize(parentTask, subtaskResults, qaResult, signal, addCost)
      : `Task blocked by Argus QA gate (${qaResult.verdict}). ${qaResult.findings.join(' ')}`;

    // 5. Update Parent Task only after a passing QA gate.
    if (this.options.taskRepo) {
      const finalStatus: TaskStatus = qaResult.passed ? 'completed' : 'failed';
      await this.options.taskRepo.updateStatus(parentTask.id, finalStatus, {
        error: qaResult.passed ? undefined : qaResult.findings.join(' '),
        result: {
          synthesis: finalSynthesis,
          qaVerdict: qaResult?.verdict || 'PASS',
          subtaskCount: subtaskResults.size,
          totalCostUsd
        }
      });
      await this.publishTaskState(parentTask.id, parentTask.assignedAgent, finalStatus, {
        qaVerdict: qaResult.verdict,
        totalCostUsd
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

  private async publishTaskState(
    taskId: string,
    agentId: string,
    status: TaskStatus,
    payload?: Record<string, unknown>,
    type?: 'task.created' | 'task.updated' | 'task.completed' | 'task.failed' | 'task.cancelled'
  ): Promise<void> {
    try {
      await this.options.eventBus.publish(createTaskLifecycleEvent({ taskId, agentId, status, payload, type }));
    } catch (error) {
      rootLogger.error('Failed to publish task lifecycle event', { taskId, status, error: String(error) });
    }
  }

  private async publishDialogue(
    taskId: string,
    senderId: string,
    content: string,
    recipientId?: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    if (this.options.messageRepo) {
      try {
        await this.options.messageRepo.create({
          taskId,
          senderType: 'agent',
          senderId,
          recipientId,
          content,
          metadata
        });
      } catch (err) {
        rootLogger.warn('Failed to persist dialogue message', { taskId, senderId, error: String(err) });
      }
    }

    try {
      await this.options.eventBus.publish({
        id: crypto.randomUUID(),
        type: 'message.created',
        taskId,
        agentId: senderId,
        payload: {
          senderType: 'agent',
          senderId,
          recipientId,
          content,
          metadata: metadata || {}
        },
        timestamp: new Date().toISOString()
      });
    } catch (err) {
      rootLogger.warn('Failed to publish message.created event', { taskId, senderId, error: String(err) });
    }
  }
}
