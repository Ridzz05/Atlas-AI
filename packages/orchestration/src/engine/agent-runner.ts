import {
  Task,
  Run,
  AgentDefinition,
  SystemEvent
} from '@atlas/shared';
import { ModelProvider, ChatMessage, ToolCallRequest } from '@atlas/providers';
import { EventBus } from '@atlas/events';
import { rootLogger } from '@atlas/observability';
import { TaskRepository, RunRepository } from '@atlas/database';

export interface ToolExecutor {
  execute(
    toolCall: ToolCallRequest,
    context: { taskId: string; runId: string; agentId: string; signal?: AbortSignal }
  ): Promise<Record<string, unknown>>;
}

export interface AgentRunnerOptions {
  provider: ModelProvider;
  eventBus: EventBus;
  taskRepo?: TaskRepository;
  runRepo?: RunRepository;
  toolExecutor?: ToolExecutor;
}

export interface RunAgentInput {
  task: Task;
  agent: AgentDefinition;
  initialPrompt: string;
  runId?: string;
  signal?: AbortSignal;
}

export interface AgentRunSummary {
  runId: string;
  taskId: string;
  agentId: string;
  status: 'completed' | 'failed' | 'cancelled' | 'timed_out';
  finalContent: string;
  turnsCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  error?: string;
}

export class AgentRunner {
  private activeRuns = new Map<string, AbortController>();

  constructor(private options: AgentRunnerOptions) {}

  public cancelRun(runId: string, reason = 'Cancelled by user'): boolean {
    const controller = this.activeRuns.get(runId);
    if (controller) {
      controller.abort(reason);
      this.activeRuns.delete(runId);
      rootLogger.info(`Run ${runId} cancelled: ${reason}`);
      return true;
    }
    return false;
  }

  public async run(input: RunAgentInput): Promise<AgentRunSummary> {
    const runId = input.runId || crypto.randomUUID();
    const taskId = input.task.id;
    const agentId = input.agent.id;

    const controller = new AbortController();
    this.activeRuns.set(runId, controller);

    // Link external abort signal if provided
    if (input.signal) {
      input.signal.addEventListener('abort', () => controller.abort(input.signal?.reason));
    }

    // Set timeout watchdog
    const timeoutSeconds = input.agent.limits.timeoutSeconds || 180;
    const timeoutTimer = setTimeout(() => {
      controller.abort(`Timeout after ${timeoutSeconds} seconds`);
    }, timeoutSeconds * 1000);

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCostUsd = 0;
    let turnsCount = 0;
    let finalContent = '';
    let status: 'completed' | 'failed' | 'cancelled' | 'timed_out' = 'completed';
    let errorMessage: string | undefined;

    const messages: ChatMessage[] = [
      { role: 'user', content: input.initialPrompt }
    ];

    try {
      // 1. Create Run in DB if repo provided
      if (this.options.runRepo) {
        await this.options.runRepo.create({ taskId, agentId }, runId);
      }
      if (this.options.taskRepo) {
        await this.options.taskRepo.updateStatus(taskId, 'running');
      }

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

      const maxTurns = input.agent.limits.maxTurns || 10;
      const maxCostUsd = input.agent.limits.maxCostUsd || 1.0;

      while (turnsCount < maxTurns) {
        if (controller.signal.aborted) {
          throw new Error(String(controller.signal.reason || 'Run aborted'));
        }

        turnsCount++;
        rootLogger.debug(`Executing turn ${turnsCount}/${maxTurns} for agent ${agentId} on task ${taskId}`);

        // Model call
        const modelResult = await this.options.provider.run({
          runId,
          agentId,
          messages,
          systemPrompt: input.agent.systemPrompt,
          signal: controller.signal
        });

        totalInputTokens += modelResult.inputTokens;
        totalOutputTokens += modelResult.outputTokens;
        totalCostUsd += modelResult.costUsd;
        finalContent = modelResult.content;

        // Record turn in DB
        if (this.options.runRepo) {
          await this.options.runRepo.recordTurn(
            runId,
            modelResult.inputTokens,
            modelResult.outputTokens,
            modelResult.costUsd
          );
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
            if (this.options.toolExecutor) {
              output = await this.options.toolExecutor.execute(tc, {
                taskId,
                runId,
                agentId,
                signal: controller.signal
              });
            }

            if (output.success === false) {
              throw new Error(String(output.error || `Tool '${tc.name}' rejected execution.`));
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

      // Update terminal status in DB
      if (this.options.runRepo) {
        await this.options.runRepo.updateStatus(runId, 'completed');
      }
      if (this.options.taskRepo) {
        await this.options.taskRepo.updateStatus(taskId, 'completed', {
          result: { summary: finalContent, turnsCount, totalCostUsd }
        });
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
      const isTimeout = String(err?.message || '').includes('Timeout');

      if (isTimeout) {
        status = 'timed_out';
        errorMessage = 'Execution timed out';
      } else if (isAbort) {
        status = 'cancelled';
        errorMessage = String(controller.signal.reason || err?.message || 'Execution cancelled');
      } else {
        status = 'failed';
        errorMessage = String(err?.message || 'Execution failed');
      }

      rootLogger.error(`Run ${runId} ended with status: ${status}`, { error: errorMessage });

      if (this.options.runRepo) {
        await this.options.runRepo.updateStatus(runId, status as any, errorMessage);
      }
      if (this.options.taskRepo) {
        await this.options.taskRepo.updateStatus(taskId, status as any, { error: errorMessage });
      }

      await this.publishEvent({
        id: crypto.randomUUID(),
        type: status === 'cancelled' ? 'run.cancelled' : 'run.failed',
        taskId,
        runId,
        agentId,
        payload: { error: errorMessage },
        timestamp: new Date().toISOString()
      });

    } finally {
      clearTimeout(timeoutTimer);
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
      error: errorMessage
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
