import { ApprovalRepository, BudgetRepository, MessageRepository, RunRepository, TaskRepository } from '@atlas/database';
import { AgentRegistry } from '@atlas/agents';
import { TaskQueue, AgentRunner } from '@atlas/orchestration';
import { rootLogger } from '@atlas/observability';

export interface CommandContext {
  taskRepo?: TaskRepository;
  messageRepo?: MessageRepository;
  runRepo?: RunRepository;
  budgetRepo?: BudgetRepository;
  approvalRepo?: ApprovalRepository;
  registry: AgentRegistry;
  taskQueue?: TaskQueue;
  runner?: AgentRunner;
  isPaused: boolean;
  setPaused: (paused: boolean, actorId?: string) => Promise<void> | void;
  setEmergencyStop?: (active: boolean, actorId?: string) => Promise<void> | void;
  resume?: (actorId?: string) => Promise<void> | void;
}

export class CommandRouter {
  constructor(private ctx: CommandContext) {}

  public setPausedState(paused: boolean): void {
    this.ctx.isPaused = paused;
  }

  public async handle(command: string, args: string[], actorId = 'telegram-owner'): Promise<string> {
    const cmd = command.toLowerCase().replace(/^\//, '');

    switch (cmd) {
      case 'help':
      case 'start':
        return this.handleHelp();

      case 'agents':
        return this.handleAgents();

      case 'status':
        return this.handleStatus();

      case 'task':
        return this.handleTaskDetail(args[0]);

      case 'new':
        return this.handleNewTask(args.join(' '), actorId);

      case 'pause':
        await this.ctx.setPaused(true, actorId);
        return '⏸️ *System paused.* No new tasks will be dispatched to workers until resumed.';

      case 'resume':
        if (this.ctx.resume) await this.ctx.resume(actorId);
        else await this.ctx.setPaused(false, actorId);
        return '▶️ *System resumed.* Task intake and worker dispatch active.';

      case 'stop':
        return this.handleStopTask(args[0]);

      case 'emergency_stop':
        return this.handleEmergencyStop(actorId);

      case 'cost':
        return this.handleCost();

      case 'approve':
        return this.handleApproveDurable(args[0], actorId);

      case 'reject':
        return this.handleRejectDurable(args[0], actorId);

      case 'revise':
        return this.handleReviseDurable(args[0], args.slice(1).join(' '), actorId);

      default:
        return `Unknown command: \`/${cmd}\`. Use \`/help\` to see available commands.`;
    }
  }

  private handleHelp(): string {
    return `🤖 *ATLAS AI OS — Command Reference*

• \`/new <goal>\` — Create a new task for Chief
• \`/status\` — View active & queued tasks
• \`/agents\` — View core specialist agent roster
• \`/task <id>\` — View details of a specific task
• \`/approve <id>\` — Approve a pending action
• \`/reject <id>\` — Reject a pending action
• \`/revise <id> <notes>\` — Request revisions on a pending action
• \`/pause\` — Pause taking new tasks
• \`/resume\` — Resume task processing
• \`/stop <id>\` — Cancel a specific active task
• \`/emergency_stop\` — Abort all runs & freeze external actions
• \`/cost\` — View current budget and token usage
• \`/help\` — Show this help message

_Or simply send any natural message to talk with Chief._`;
  }

  private handleAgents(): string {
    const agents = this.ctx.registry.list();
    const rows = agents.map(a => `• *${a.name}* (\`${a.id}\`) — *${a.role}*\n  _${a.description}_`);
    return `👥 *ATLAS Core Agent Roster:*\n\n${rows.join('\n\n')}`;
  }

  private async handleStatus(): Promise<string> {
    if (!this.ctx.taskRepo) {
      return `ℹ️ *System Status:* Durable task database is unavailable; only in-process control state is available.\nPaused: ${this.ctx.isPaused ? 'Yes' : 'No'}`;
    }

    try {
      const [planning, running, queued, review, approval] = await Promise.all([
        this.ctx.taskRepo.findByStatus('planning'),
        this.ctx.taskRepo.findByStatus('running'),
        this.ctx.taskRepo.findByStatus('queued'),
        this.ctx.taskRepo.findByStatus('review_pending'),
        this.ctx.taskRepo.findByStatus('approval_pending')
      ]);
      const activeTasks = [...planning, ...running, ...review, ...approval];

      return `📊 *ATLAS Task Status:*
• 🧠 *Planning:* ${planning.length}
• 🏃 *Running:* ${running.length}
• ⏳ *Queued:* ${queued.length}
• 📝 *Review Pending:* ${review.length}
• 🔐 *Approval Pending:* ${approval.length}
• ⏸️ *System Paused:* ${this.ctx.isPaused ? 'Yes' : 'No'}

${activeTasks.length > 0 ? `*Active Tasks:*\n` + activeTasks.map(t => `- \`${t.id.slice(0, 8)}\`: ${t.title} (${t.assignedAgent})`).join('\n') : '_No non-terminal tasks currently active._'}`;
    } catch (error) {
      rootLogger.error('Telegram task status query failed', { error: String(error) });
      return '⚠️ *Task status temporarily unavailable.* Retry after the database service is ready.';
    }
  }

  private async handleTaskDetail(taskId?: string): Promise<string> {
    if (!taskId) return '⚠️ Please specify a task ID: `/task <id>`';
    if (!this.ctx.taskRepo) return `Task ${taskId} lookup requires database connection.`;

    const task = await this.ctx.taskRepo.findById(taskId);
    if (!task) return `❌ Task not found: \`${taskId}\``;

    const children = await this.ctx.taskRepo.findChildren(taskId);
    const childRows = children
      .map(c => `  └─ \`${c.id.slice(0, 8)}\` *${c.assignedAgent}* [${c.status.toUpperCase()}]: ${c.title}`)
      .join('\n');

    return `📌 *Task Details:* \`${task.id}\`
• *Title:* ${task.title}
• *Goal:* ${task.goal}
• *Agent:* \`${task.assignedAgent}\`
• *Status:* *${task.status.toUpperCase()}*
• *Created:* ${new Date(task.createdAt).toLocaleString()}
${children.length > 0 ? `\n*Subtasks (${children.length}):*\n${childRows}` : ''}
${task.error ? `\n⚠️ *Error:* \`${task.error}\`` : ''}`;
  }

  private async handleNewTask(goal: string, actorId: string): Promise<string> {
    if (!goal.trim()) {
      return '⚠️ Please provide a goal: `/new <description of what you want Chief to do>`';
    }

    if (this.ctx.isPaused) {
      return '⏸️ System is currently paused. Use `/resume` before starting new tasks.';
    }

    const title = goal.length > 50 ? goal.slice(0, 50) + '...' : goal;
    const taskId = crypto.randomUUID();
    let task: any = {
      id: taskId,
      parentId: null,
      title,
      goal,
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

    if (this.ctx.taskRepo) {
      task = await this.ctx.taskRepo.create(
        {
          title,
          goal,
          assignedAgent: 'chief',
          priority: 'normal',
          context: {}
        },
        taskId
      );
    }

    if (this.ctx.messageRepo) {
      try {
        await this.ctx.messageRepo.create({
          taskId: task.id,
          senderType: 'user',
          senderId: actorId,
          content: task.goal,
          metadata: { source: 'telegram' }
        });
      } catch (error) {
        rootLogger.error('Failed to persist Telegram task intake message', { taskId: task.id, error: String(error) });
      }
    }

    if (this.ctx.taskQueue) {
      const chiefAgent = this.ctx.registry.getOrThrow('chief');
      await this.ctx.taskQueue.enqueue({
        task,
        agent: chiefAgent,
        prompt: goal
      });
    }

    return `🚀 *Task Created Successfully!*
• *ID:* \`${task.id}\`
• *Assigned to:* *Chief*
• *Goal:* ${goal}

Chief is preparing the multi-agent execution plan. You can check status with \`/task ${task.id}\`.`;
  }

  private async handleStopTask(taskId?: string): Promise<string> {
    if (!taskId) return '⚠️ Please specify a task ID: `/stop <task_id>`';

    if (this.ctx.runner) {
      await this.ctx.runner.requestTaskCancellation(taskId, 'Stopped by user via Telegram command');
    } else if (this.ctx.runRepo) {
      await this.ctx.runRepo.requestCancellationForTask(taskId, 'Stopped by user via Telegram command');
    }
    if (this.ctx.taskRepo) {
      try {
        await this.ctx.taskRepo.updateStatus(taskId, 'cancelled', {
          error: 'Cancelled via Telegram /stop command'
        });
      } catch {
        // Ignored if not found
      }
    }

    return `🛑 Task \`${taskId}\` cancellation signal sent.`;
  }

  private async handleEmergencyStop(actorId: string): Promise<string> {
    rootLogger.warn('EMERGENCY STOP TRIGGERED VIA TELEGRAM COMMAND');
    if (this.ctx.runner) {
      await this.ctx.runner.requestAllCancellations('Emergency stop activated by Telegram owner');
    } else if (this.ctx.runRepo) {
      await this.ctx.runRepo.requestCancellationForActive('Emergency stop activated by Telegram owner');
    }
    if (this.ctx.setEmergencyStop) await this.ctx.setEmergencyStop(true, actorId);
    else await this.ctx.setPaused(true, actorId);

    return `🚨 *EMERGENCY STOP ACTIVATED!*
• All active agent runs have been sent abort signals.
• Task intake has been frozen.
• External writes are locked.

Use \`/resume\` to unfreeze the system when ready.`;
  }

  private async handleCost(): Promise<string> {
    if (!this.ctx.runRepo && !this.ctx.budgetRepo) {
      return 'ℹ️ *Cost telemetry unavailable.* Durable cost and budget repositories are not configured; no estimates are shown.';
    }

    try {
      const [costs, budget] = await Promise.all([this.ctx.runRepo?.getCostSummary(), this.ctx.budgetRepo?.getGlobalDailySummary()]);

      if (!costs && !budget) {
        return 'ℹ️ *Cost telemetry unavailable.* No durable cost or budget record is available yet.';
      }

      const lines = ['💰 *ATLAS Budget & Token Telemetry:*'];
      if (budget) {
        lines.push(
          `• *Daily Budget:* ${this.formatUsd(budget.limitUsd)} USD`,
          `• *Used Today:* ${this.formatUsd(budget.usedUsd)} USD`,
          `• *Reserved:* ${this.formatUsd(budget.reservedUsd)} USD`,
          `• *Remaining Allowance:* ${this.formatUsd(budget.availableUsd)} USD`
        );
        if (budget.resetAt) lines.push(`• *Budget Resets:* ${new Date(budget.resetAt).toISOString()}`);
      }
      if (costs) {
        lines.push(
          `• *Run Cost Today:* ${this.formatUsd(costs.periodCostUsd)} USD`,
          `• *Total Run Cost:* ${this.formatUsd(costs.totalCostUsd)} USD`,
          `• *Runs:* ${costs.runCount} total (${costs.activeRunCount} active, ${costs.completedRunCount} completed, ${costs.failedRunCount} failed/cancelled/timed out)`
        );
      }
      return lines.join('\n');
    } catch (error) {
      rootLogger.error('Telegram cost telemetry query failed', { error: String(error) });
      return '⚠️ *Cost telemetry temporarily unavailable.* Retry after the database and budget services are ready.';
    }
  }

  private formatUsd(value: number): string {
    return `$${(Number.isFinite(value) ? Math.max(0, value) : 0).toFixed(4)}`;
  }

  private async handleApproveDurable(requestId: string | undefined, actorId: string): Promise<string> {
    if (!requestId) return 'Please specify an approval request ID: `/approve <id>`';
    if (!this.ctx.approvalRepo) return `Approval control plane is not configured for \`${requestId}\`; no decision was recorded.`;
    let approval = await this.ctx.approvalRepo.decide(requestId, 'approved', actorId);
    if (!approval && typeof (this.ctx.approvalRepo as any).findById === 'function') {
      const existing = await this.ctx.approvalRepo.findById(requestId);
      if (existing?.status === 'approved') approval = existing;
    }
    if (!approval) return `Approval \`${requestId}\` was not changed. It may be missing, expired, or already decided.`;

    const canResume = typeof (this.ctx.approvalRepo as any).issueExecutionToken === 'function' && this.ctx.taskRepo && this.ctx.taskQueue;
    if (!canResume) {
      return `Approval \`${requestId}\` recorded as APPROVED. No outbound side effect was executed by this command.`;
    }

    try {
      const token = await this.ctx.approvalRepo.issueExecutionToken(approval.id);
      const approvedTask = await this.ctx.taskRepo!.findById(approval.taskId);
      const queueTask = approvedTask?.parentId ? await this.ctx.taskRepo!.findById(approvedTask.parentId) : approvedTask;
      if (!token || !approvedTask || approvedTask.status !== 'approval_pending' || !queueTask) {
        return `Approval \`${requestId}\` was recorded, but the paused task could not be resumed safely. Retry after the worker and database are ready.`;
      }

      await this.ctx.taskQueue!.enqueue({
        task: queueTask,
        agent: this.ctx.registry.getOrThrow(queueTask.assignedAgent),
        prompt: queueTask.goal,
        runId: approvedTask.parentId ? undefined : approval.runId,
        approvalResume: {
          taskId: approval.taskId,
          runId: approval.runId,
          token
        }
      });
      return `Approval \`${requestId}\` recorded as APPROVED and the paused task was queued for one-time execution.`;
    } catch (error) {
      rootLogger.error('Telegram approval resume enqueue failed', { error: String(error), approvalId: approval.id });
      return `Approval \`${requestId}\` was recorded, but the paused task could not be resumed safely. Retry the command.`;
    }
  }

  private async handleRejectDurable(requestId: string | undefined, actorId: string): Promise<string> {
    if (!requestId) return 'Please specify an approval request ID: `/reject <id>`';
    if (!this.ctx.approvalRepo) return `Approval control plane is not configured for \`${requestId}\`; no decision was recorded.`;
    const approval = await this.ctx.approvalRepo.decide(requestId, 'rejected', actorId);
    if (!approval) return `Approval \`${requestId}\` was not changed. It may be missing, expired, or already decided.`;
    return `Approval \`${requestId}\` recorded as REJECTED. No side effect was executed.`;
  }

  private async handleReviseDurable(requestId: string | undefined, notes: string, actorId: string): Promise<string> {
    if (!requestId) return 'Please specify an approval request ID: `/revise <id> <notes>`';
    if (!this.ctx.approvalRepo) return `Approval control plane is not configured for \`${requestId}\`; no decision was recorded.`;
    const approval = await this.ctx.approvalRepo.decide(requestId, 'revision_requested', actorId, notes || 'Please adjust parameters.');
    if (!approval) return `Approval \`${requestId}\` was not changed. It may be missing, expired, or already decided.`;
    return `Revision requested for \`${requestId}\`: "${notes || 'Please adjust parameters.'}"`;
  }

  private handleApprove(requestId?: string): string {
    if (!requestId) return '⚠️ Please specify an approval request ID: `/approve <id>`';
    return `✅ Action \`${requestId}\` approved. Executing one-time approved mutation.`;
  }

  private handleReject(requestId?: string): string {
    if (!requestId) return '⚠️ Please specify an approval request ID: `/reject <id>`';
    return `❌ Action \`${requestId}\` rejected. Side effect aborted.`;
  }

  private handleRevise(requestId?: string, notes?: string): string {
    if (!requestId) return '⚠️ Please specify an approval request ID: `/revise <id> <notes>`';
    return `✍️ Revision requested for \`${requestId}\`: "${notes || 'Please adjust parameters.'}"`;
  }
}
