import { ApprovalToken, Task, TaskStatus, Run, AgentDefinition, SystemEvent } from '@atlas/shared';
import { ModelProvider, ChatMessage, ToolCallRequest } from '@atlas/providers';
import { createTaskLifecycleEvent, EventBus } from '@atlas/events';
import { rootLogger } from '@atlas/observability';
import { BudgetRepository, TaskRepository, RunRepository, MessageRepository, ToolCallRepository } from '@atlas/database';
import type { ApprovalExecutionStore } from '@atlas/tools';

export interface ToolExecutor {
  execute(
    toolCall: ToolCallRequest,
    context: {
      taskId: string;
      runId: string;
      agentId: string;
      grantedScopes?: string[];
      allowedTools?: string[];
      approvalToken?: ApprovalToken;
      signal?: AbortSignal;
    }
  ): Promise<Record<string, unknown>>;
  getToolDefinitions?(allowedTools?: string[]): Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }>;
}

export interface AgentRunnerOptions {
  provider: ModelProvider;
  eventBus: EventBus;
  taskRepo?: TaskRepository;
  runRepo?: RunRepository;
  messageRepo?: MessageRepository;
  toolCallRepo?: ToolCallRepository;
  budgetRepo?: BudgetRepository;
  globalDailyBudgetUsd?: number;
  toolExecutor?: ToolExecutor;
  approvalExecutionStore?: ApprovalExecutionStore;
  cancellationStore?: RunCancellationStore;
  workerId?: string;
  leaseSeconds?: number;
}

export interface RunCancellationStore {
  isCancellationRequested?(runId: string): Promise<{ requested: boolean; reason?: string }>;
  /**
   * Task-level cancellation. A delegation graph is driven by the parent orchestrator task,
   * which has no Run row of its own, so `isCancellationRequested(runId)` cannot see a cancel
   * aimed at it. Without this the planner, every specialist, the QA gate and the synthesiser
   * all ran to completion after an emergency stop.
   */
  isCancellationRequestedForTask?(taskId: string): Promise<{ requested: boolean; reason?: string }>;
  requestCancellation?(runId: string, reason: string): Promise<unknown | null>;
  requestCancellationForTask?(taskId: string, reason: string): Promise<number>;
  requestCancellationForActive?(reason: string): Promise<number>;
}

export interface RunAgentInput {
  task: Task;
  agent: AgentDefinition;
  initialPrompt: string;
  runId?: string;
  approvalToken?: ApprovalToken;
  signal?: AbortSignal;
}

export interface AgentRunSummary {
  runId: string;
  taskId: string;
  agentId: string;
  status: 'completed' | 'failed' | 'cancelled' | 'timed_out' | 'waiting_approval';
  finalContent: string;
  turnsCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  error?: string;
  approvalId?: string;
}

export class AgentRunner {
  private activeRuns = new Map<string, { controller: AbortController; taskId: string }>();
  private readonly workerId: string;
  private durableBudgetWarningLogged = false;

  constructor(private options: AgentRunnerOptions) {
    this.workerId = options.workerId || `${process.env.HOSTNAME || 'atlas'}:${process.pid}`;
  }

  public cancelRun(runId: string, reason = 'Cancelled by user'): boolean {
    const activeRun = this.activeRuns.get(runId);
    if (activeRun) {
      activeRun.controller.abort(reason);
      this.activeRuns.delete(runId);
      rootLogger.info(`Run ${runId} cancelled: ${reason}`);
      return true;
    }
    return false;
  }

  public async requestCancellation(runId: string, reason = 'Cancelled by user'): Promise<boolean> {
    const durableRequest = this.options.cancellationStore?.requestCancellation
      ? await this.options.cancellationStore.requestCancellation(runId, reason)
      : null;
    const localRequest = this.cancelRun(runId, reason);
    return Boolean(durableRequest) || localRequest;
  }

  public async requestTaskCancellation(taskId: string, reason = 'Cancelled by user'): Promise<number> {
    const durableCount = this.options.cancellationStore?.requestCancellationForTask
      ? await this.options.cancellationStore.requestCancellationForTask(taskId, reason)
      : 0;
    let localCount = 0;
    for (const [runId, activeRun] of this.activeRuns.entries()) {
      if (activeRun.taskId !== taskId) continue;
      activeRun.controller.abort(reason);
      this.activeRuns.delete(runId);
      localCount++;
    }
    return durableCount + localCount;
  }

  public async requestAllCancellations(reason = 'Emergency stop'): Promise<number> {
    const durableCount = this.options.cancellationStore?.requestCancellationForActive
      ? await this.options.cancellationStore.requestCancellationForActive(reason)
      : 0;
    let localCount = 0;
    for (const [runId, activeRun] of this.activeRuns.entries()) {
      activeRun.controller.abort(reason);
      this.activeRuns.delete(runId);
      localCount++;
    }
    return durableCount + localCount;
  }

  public async run(input: RunAgentInput): Promise<AgentRunSummary> {
    const runId = input.runId || crypto.randomUUID();
    const taskId = input.task.id;
    const agentId = input.agent.id;

    const controller = new AbortController();
    this.activeRuns.set(runId, { controller, taskId });

    // Link external abort signal if provided
    if (input.signal) {
      input.signal.addEventListener('abort', () => controller.abort(input.signal?.reason));
    }

    // Set timeout watchdog
    const timeoutSeconds = input.agent.limits.timeoutSeconds || 180;
    let timedOut = false;
    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      controller.abort(`Timeout after ${timeoutSeconds} seconds`);
    }, timeoutSeconds * 1000);
    const leaseSeconds = this.options.leaseSeconds || 60;
    let leaseHeartbeatTimer: NodeJS.Timeout | undefined;

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCostUsd = 0;
    let turnsCount = 0;
    let finalContent = '';
    let status: 'completed' | 'failed' | 'cancelled' | 'timed_out' | 'waiting_approval' = 'completed';
    let errorMessage: string | undefined;
    let approvalId: string | undefined;
    const maxTurns = input.agent.limits.maxTurns || 10;
    const maxCostUsd = input.agent.limits.maxCostUsd || 1.0;
    let budgetReservationId: string | undefined;
    let budgetSettled = false;

    const messages: ChatMessage[] = [{ role: 'user', content: input.initialPrompt }];

    const persistMessage = async (message: {
      senderType: 'user' | 'agent' | 'system' | 'tool';
      senderId: string;
      content: string;
      metadata?: Record<string, unknown>;
    }): Promise<void> => {
      if (this.options.messageRepo) {
        await this.options.messageRepo.create({
          taskId,
          runId,
          ...message
        });
      }
      await this.publishEvent({
        id: crypto.randomUUID(),
        type: 'message.created',
        taskId,
        runId,
        agentId: message.senderId,
        payload: {
          senderType: message.senderType,
          senderId: message.senderId,
          content: message.content,
          metadata: message.metadata || {}
        },
        timestamp: new Date().toISOString()
      });
    };

    const refreshDurableCancellation = async (): Promise<void> => {
      if (!this.options.cancellationStore?.isCancellationRequested) return;

      const cancellation = await this.options.cancellationStore.isCancellationRequested(runId);
      if (cancellation.requested && !controller.signal.aborted) {
        controller.abort(cancellation.reason || 'Cancellation requested by another process');
      }
    };

    const settleBudget = async (): Promise<void> => {
      if (!budgetReservationId || budgetSettled || !this.options.budgetRepo) return;
      const settled = await this.options.budgetRepo.commit(budgetReservationId, totalCostUsd);
      if (!settled) throw new Error('Durable budget reservation could not be settled.');
      budgetSettled = true;
    };

    const acquireRunLease = async (): Promise<void> => {
      const runRepo = this.options.runRepo as
        | (RunRepository & {
            acquireLease?: RunRepository['acquireLease'];
            heartbeat?: RunRepository['heartbeat'];
          })
        | undefined;
      if (!runRepo || typeof runRepo.acquireLease !== 'function') return;

      const lease = await runRepo.acquireLease(runId, this.workerId, leaseSeconds);
      if (!lease) {
        throw new Error(`RUN_LEASE_UNAVAILABLE: run ${runId} is owned by another worker.`);
      }

      if (typeof runRepo.heartbeat !== 'function') return;
      const heartbeatIntervalMs = Math.max(1000, Math.min(30000, Math.floor((leaseSeconds * 1000) / 2)));
      leaseHeartbeatTimer = setInterval(() => {
        void runRepo.heartbeat!(runId, this.workerId, leaseSeconds)
          .then(renewed => {
            if (!renewed && !controller.signal.aborted) {
              controller.abort('Run lease lost');
            }
          })
          .catch(error => {
            rootLogger.error(`Run ${runId} lease heartbeat failed`, { error: String(error) });
            if (!controller.signal.aborted) controller.abort('Run lease heartbeat failed');
          });
      }, heartbeatIntervalMs);
    };

    try {
      // 1. Create Run in DB if repo provided
      if (this.options.runRepo) {
        if (input.approvalToken && input.runId) {
          await this.options.runRepo.updateStatus(runId, 'active');
        } else {
          await this.options.runRepo.create({ taskId, agentId }, runId);
        }
      }

      await acquireRunLease();

      if (this.options.budgetRepo && this.options.runRepo && this.options.globalDailyBudgetUsd) {
        let priorRunCost = 0;
        if (input.runId && typeof this.options.runRepo.findById === 'function') {
          priorRunCost = Number((await this.options.runRepo.findById(runId))?.costUsd || 0);
        }
        const reserveAmount = Math.max(0, maxCostUsd - priorRunCost);
        if (reserveAmount <= 0) {
          throw new Error(`BUDGET_EXCEEDED: run ${runId} has no remaining per-run budget.`);
        }
        const reservation = await this.options.budgetRepo.reserve({
          runId,
          taskId,
          agentId,
          amountUsd: reserveAmount,
          globalDailyLimitUsd: this.options.globalDailyBudgetUsd,
          perRunLimitUsd: maxCostUsd
        });
        if (!reservation) {
          throw new Error(`BUDGET_EXCEEDED: durable budget is unavailable for run ${runId}.`);
        }
        budgetReservationId = reservation.id;
      } else if (!this.durableBudgetWarningLogged) {
        // The global daily cap is enforced by the durable reservation. When the repositories
        // or the configured limit are missing, only the in-memory per-run ceiling applies, so
        // the daily budget silently does not exist. Production always wires all three; warn
        // once so a caller that forgets is not left believing the cap is in force.
        this.durableBudgetWarningLogged = true;
        rootLogger.warn('Durable budget enforcement is disabled: only the per-run cost ceiling applies', {
          runId,
          taskId,
          hasBudgetRepo: Boolean(this.options.budgetRepo),
          hasRunRepo: Boolean(this.options.runRepo),
          hasGlobalDailyBudget: Boolean(this.options.globalDailyBudgetUsd)
        });
      }

      if (this.options.taskRepo) {
        await this.options.taskRepo.updateStatus(taskId, 'running');
        await this.publishEvent(createTaskLifecycleEvent({ taskId, runId, agentId, status: 'running' }));
      }
      await persistMessage({
        senderType: 'user',
        senderId: 'user',
        content: input.initialPrompt,
        metadata: { runId, agentId }
      });

      // 2. Publish run.started event
      await this.publishEvent({
        id: crypto.randomUUID(),
        type: 'run.started',
        taskId,
        runId,
        agentId,
        payload: { prompt: input.initialPrompt },
        timestamp: new Date().toISOString()
      });

      while (turnsCount < maxTurns) {
        await refreshDurableCancellation();
        if (controller.signal.aborted) {
          throw new Error(String(controller.signal.reason || 'Run aborted'));
        }

        turnsCount++;
        rootLogger.debug(`Executing turn ${turnsCount}/${maxTurns} for agent ${agentId} on task ${taskId}`);

        // Extract available tool definitions matching agent permissions
        const availableTools = this.options.toolExecutor?.getToolDefinitions?.(input.agent.permissions.tools);

        // Model call
        const modelResult = await this.options.provider.run({
          runId,
          agentId,
          messages,
          systemPrompt: input.agent.systemPrompt,
          tools: availableTools && availableTools.length > 0 ? availableTools : undefined,
          signal: controller.signal
        });

        await refreshDurableCancellation();
        if (controller.signal.aborted) {
          throw new Error(String(controller.signal.reason || 'Run aborted'));
        }

        await persistMessage({
          senderType: 'agent',
          senderId: agentId,
          content: modelResult.content,
          metadata: {
            turn: turnsCount,
            finishReason: modelResult.finishReason,
            toolCallCount: modelResult.toolCalls?.length || 0
          }
        });

        totalInputTokens += modelResult.inputTokens;
        totalOutputTokens += modelResult.outputTokens;
        totalCostUsd += modelResult.costUsd;
        finalContent = modelResult.content;

        // Record turn in DB
        if (this.options.runRepo) {
          await this.options.runRepo.recordTurn(runId, modelResult.inputTokens, modelResult.outputTokens, modelResult.costUsd);
        }

        // Publish turn completed event
        await this.publishEvent({
          id: crypto.randomUUID(),
          type: 'run.turn_completed',
          taskId,
          runId,
          agentId,
          payload: {
            turn: turnsCount,
            finishReason: modelResult.finishReason,
            costUsd: modelResult.costUsd
          },
          timestamp: new Date().toISOString()
        });

        // Check cost ceiling
        if (totalCostUsd >= maxCostUsd) {
          throw new Error(`Cost ceiling reached: $${totalCostUsd.toFixed(4)} >= $${maxCostUsd.toFixed(4)}`);
        }

        // If assistant provided tools, execute them
        if (modelResult.toolCalls && modelResult.toolCalls.length > 0) {
          messages.push({
            role: 'assistant',
            content: modelResult.content,
            toolCalls: modelResult.toolCalls
          });

          for (const tc of modelResult.toolCalls) {
            let output: Record<string, unknown> = { success: true };
            const toolCallRecordId = this.options.toolCallRepo
              ? (
                  await this.options.toolCallRepo.create({
                    runId,
                    taskId,
                    agentId,
                    toolName: tc.name,
                    input: tc.arguments
                  })
                ).id
              : undefined;
            const toolStartedAt = Date.now();

            if (this.options.toolExecutor) {
              try {
                output = await this.options.toolExecutor.execute(tc, {
                  taskId,
                  runId,
                  agentId,
                  grantedScopes: input.agent.permissions.dataScopes,
                  allowedTools: input.agent.permissions.tools,
                  approvalToken: input.approvalToken,
                  signal: controller.signal
                });
              } catch (err: any) {
                if (toolCallRecordId && this.options.toolCallRepo) {
                  await this.options.toolCallRepo.complete(toolCallRecordId, {
                    status: 'failed',
                    error: String(err?.message || 'Tool execution failed'),
                    durationMs: Date.now() - toolStartedAt
                  });
                }
                throw err;
              }
            }

            if (toolCallRecordId && this.options.toolCallRepo) {
              const blockedApproval = output.approvalPending === true;
              await this.options.toolCallRepo.complete(toolCallRecordId, {
                status: output.success === false ? (blockedApproval ? 'blocked_approval' : 'failed') : 'success',
                output,
                error: typeof output.error === 'string' ? output.error : null,
                durationMs: Date.now() - toolStartedAt,
                approvalId: typeof output.approvalId === 'string' ? output.approvalId : null
              });
            }

            await persistMessage({
              senderType: 'tool',
              senderId: tc.name,
              content: JSON.stringify(output),
              metadata: { turn: turnsCount, providerToolCallId: tc.id }
            });

            if (output.success === false) {
              const toolError = new Error(String(output.error || `Tool '${tc.name}' rejected execution.`));
              if (output.approvalPending === true) {
                (toolError as Error & { approvalPending?: boolean; approvalId?: string }).approvalPending = true;
                (toolError as Error & { approvalPending?: boolean; approvalId?: string }).approvalId =
                  typeof output.approvalId === 'string' ? output.approvalId : undefined;
              }
              throw toolError;
            }

            messages.push({
              role: 'tool',
              name: tc.name,
              toolCallId: tc.id,
              content: JSON.stringify(output)
            });
          }
        } else {
          // No more tool calls, execution completed
          break;
        }
      }

      // If turns exhausted without stopping
      if (turnsCount >= maxTurns && !finalContent) {
        finalContent = 'Task completed: Maximum turns reached.';
      }

      if (input.approvalToken && this.options.approvalExecutionStore) {
        const executionStatus = await this.options.approvalExecutionStore.getExecutionStatus(input.approvalToken.requestId);
        if (executionStatus !== 'executed') {
          const approvalError = new Error('Approved execution was not claimed and finalized by the protected tool.');
          (approvalError as Error & { approvalPending?: boolean; approvalId?: string }).approvalPending = true;
          (approvalError as Error & { approvalPending?: boolean; approvalId?: string }).approvalId = input.approvalToken.requestId;
          throw approvalError;
        }
      }

      await refreshDurableCancellation();
      if (controller.signal.aborted) {
        throw new Error(String(controller.signal.reason || 'Run aborted'));
      }

      await settleBudget();

      // Update terminal status in DB
      if (this.options.runRepo) {
        await this.options.runRepo.updateStatus(runId, 'completed', undefined, this.workerId);
      }
      if (this.options.taskRepo) {
        await this.options.taskRepo.updateStatus(taskId, 'completed', {
          result: { summary: finalContent, turnsCount, totalCostUsd }
        });
        await this.publishEvent(
          createTaskLifecycleEvent({ taskId, runId, agentId, status: 'completed', payload: { turnsCount, totalCostUsd } })
        );
      }

      await this.publishEvent({
        id: crypto.randomUUID(),
        type: 'run.completed',
        taskId,
        runId,
        agentId,
        payload: {
          turnsCount,
          totalCostUsd,
          totalInputTokens,
          totalOutputTokens,
          finalContent
        },
        timestamp: new Date().toISOString()
      });
    } catch (err: any) {
      const isAbort = controller.signal.aborted || String(err?.message || '').includes('aborted');
      const isTimeout = timedOut || String(err?.message || '').includes('Timeout');
      const isApprovalPending = err?.approvalPending === true;

      if (isTimeout) {
        status = 'timed_out';
        errorMessage = 'Execution timed out';
      } else if (isApprovalPending) {
        status = 'waiting_approval';
        approvalId = typeof err?.approvalId === 'string' ? err.approvalId : undefined;
        errorMessage = String(err?.message || 'Execution is waiting for human approval');
      } else if (isAbort) {
        status = 'cancelled';
        errorMessage = String(controller.signal.reason || err?.message || 'Execution cancelled');
      } else {
        status = 'failed';
        errorMessage = String(err?.message || 'Execution failed');
      }

      try {
        await settleBudget();
      } catch (budgetError) {
        status = 'failed';
        errorMessage = `Durable budget settlement failed: ${String(budgetError)}`;
      }

      rootLogger.error(`Run ${runId} ended with status: ${status}`, { error: errorMessage });

      if (this.options.runRepo) {
        // Guarded by workerId: if this worker lost the lease (for example because
        // acquireRunLease returned null), it must not write a terminal status for a run
        // that another worker now owns — a terminal write clears the lease columns.
        await this.options.runRepo.updateStatus(runId, status as any, errorMessage, this.workerId);
        if (status === 'waiting_approval' && typeof (this.options.runRepo as any).releaseLease === 'function') {
          await (this.options.runRepo as any).releaseLease(runId, this.workerId);
        }
      }
      if (this.options.taskRepo) {
        const taskStatus: TaskStatus =
          status === 'waiting_approval'
            ? 'approval_pending'
            : status === 'cancelled'
              ? 'cancelled'
              : status === 'failed' || status === 'timed_out'
                ? 'failed'
                : 'failed';
        await this.options.taskRepo.updateStatus(taskId, taskStatus, { error: errorMessage });
        await this.publishEvent(
          createTaskLifecycleEvent({
            taskId,
            runId,
            agentId,
            status: taskStatus,
            payload: { runStatus: status, error: errorMessage, approvalId }
          })
        );
      }

      await this.publishEvent({
        id: crypto.randomUUID(),
        type: status === 'waiting_approval' ? 'approval.requested' : status === 'cancelled' ? 'run.cancelled' : 'run.failed',
        taskId,
        runId,
        agentId,
        payload: { error: errorMessage, approvalId },
        timestamp: new Date().toISOString()
      });
    } finally {
      clearTimeout(timeoutTimer);
      if (leaseHeartbeatTimer) clearInterval(leaseHeartbeatTimer);
      this.activeRuns.delete(runId);
    }

    return {
      runId,
      taskId,
      agentId,
      status,
      finalContent,
      turnsCount,
      totalInputTokens,
      totalOutputTokens,
      totalCostUsd,
      error: errorMessage,
      approvalId
    };
  }

  private async publishEvent(event: SystemEvent): Promise<void> {
    try {
      await this.options.eventBus.publish(event);
    } catch (err) {
      rootLogger.error('Failed to publish system event', { error: String(err) });
    }
  }
}
