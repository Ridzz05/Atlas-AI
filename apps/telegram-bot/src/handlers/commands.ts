import {
  ApprovalRepository,
  BudgetRepository,
  DatabaseClient,
  MessageRepository,
  RunRepository,
  SDLCRepository,
  TaskRepository
} from '@atlas/database';
import { AgentRegistry } from '@atlas/agents';
import { TaskQueue, AgentRunner } from '@atlas/orchestration';
import { rootLogger } from '@atlas/observability';
import { SDLCInitiative } from '@atlas/shared';

export interface CommandContext {
  db?: DatabaseClient;
  taskRepo?: TaskRepository;
  messageRepo?: MessageRepository;
  runRepo?: RunRepository;
  budgetRepo?: BudgetRepository;
  approvalRepo?: ApprovalRepository;
  sdlcRepo?: SDLCRepository;
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

      case 'initiatives':
        return this.handleInitiatives();

      case 'initiative':
        return this.handleInitiativeDetail(args[0]);

      case 'pause':
        await this.ctx.setPaused(true, actorId);
        return '⏸️ *System paused.* No new tasks will be dispatched to workers until resumed.';

      case 'resume':
        if (this.ctx.resume) await this.ctx.resume(actorId);
        else await this.ctx.setPaused(false, actorId);
        return '▶️ *System resumed.* Task intake and worker dispatch active.';

      case 'stop':
        return this.handleStopTask(args[0], actorId);

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
    return `🤖 *ATLAS AI OS: Command Reference*

• \`/new <goal>\`: Create a new task for Chief
• \`/initiatives\`: View active Executive SDLC initiatives
• \`/initiative <id>\`: View detail of an SDLC initiative
• \`/status\`: View active & queued tasks
• \`/agents\`: View core agent roster (C-Suite & Specialists)
• \`/task <id>\`: View details of a specific task
• \`/approve <id>\`: Approve a pending action
• \`/reject <id>\`: Reject a pending action
• \`/revise <id> <notes>\`: Request revisions on a pending action
• \`/pause\`: Pause taking new tasks
• \`/resume\`: Resume task processing
• \`/stop <id>\`: Cancel a specific active task
• \`/emergency_stop\`: Abort all runs & freeze external actions
• \`/cost\`: View current budget and token usage
• \`/help\`: Show this help message

_Or simply send any natural message to talk with Chief._`;
  }

  private handleAgents(): string {
    const agents = this.ctx.registry.list();
    const rows = agents.map(a => `• *${a.name}* (\`${a.id}\`): *${a.role}*\n  _${a.description}_`);
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

    const taskInput = {
      title,
      goal,
      assignedAgent: 'chief' as const,
      priority: 'normal' as const,
      context: {}
    };

    if (this.ctx.db && this.ctx.taskRepo && this.ctx.messageRepo) {
      task = await this.ctx.db.transaction(async transactionClient => {
        const createdTask = await this.ctx.taskRepo!.create(taskInput, taskId, transactionClient);
        await this.ctx.messageRepo!.create(
          {
            taskId: createdTask.id,
            senderType: 'user',
            senderId: actorId,
            content: createdTask.goal,
            metadata: { source: 'telegram' }
          },
          undefined,
          transactionClient
        );
        return createdTask;
      });
    } else {
      if (this.ctx.taskRepo) {
        task = await this.ctx.taskRepo.create(taskInput, taskId);
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

  /**
   * Stop a task, and say what actually happened.
   *
   * This used to discard the `rowCount` from both cancellation calls, swallow the `updateStatus` error,
   * and return "cancellation signal sent" unconditionally — including when nothing matched, and
   * including for a task that had already finished, which it relabelled `cancelled` and overwrote
   * `completed_at` on. A control that reports success it did not have is worse than one that fails: the
   * operator stops looking.
   */
  private async handleStopTask(taskId?: string, actorId = 'telegram-owner'): Promise<string> {
    if (!taskId) return '⚠️ Please specify a task ID: `/stop <task_id>`';

    const reason = `Stopped by ${actorId} via Telegram /stop command`;

    // A terminal task has nothing to cancel, and relabelling it falsifies the record.
    if (this.ctx.taskRepo) {
      const task = await this.ctx.taskRepo.findById(taskId);
      if (!task) return `⚠️ Task \`${taskId}\` not found.`;
      if (['completed', 'failed', 'cancelled'].includes(String(task.status))) {
        return `ℹ️ Task \`${taskId}\` is already *${task.status}* — nothing to cancel.`;
      }
    }

    let signalled = 0;
    if (this.ctx.runner) {
      signalled = await this.ctx.runner.requestTaskCancellation(taskId, reason);
    } else if (this.ctx.runRepo) {
      signalled = await this.ctx.runRepo.requestCancellationForTask(taskId, reason);
    }

    if (signalled === 0) {
      // No runner was wired at all, or no live run matched: either way nothing was signalled.
      return `⚠️ No running or active run found for task \`${taskId}\` — nothing was cancelled.`;
    }

    if (this.ctx.taskRepo) {
      try {
        await this.ctx.taskRepo.updateStatus(taskId, 'cancelled', { error: reason });
      } catch (err) {
        // The run was signalled but the row could not be updated; say so rather than hide it.
        return `🛑 Cancellation signalled for \`${taskId}\` (${signalled} run(s)), but the task row could not be updated: ${String(err)}`;
      }
    }

    return `🛑 Task \`${taskId}\` cancellation signalled for ${signalled} run(s).`;
  }

  private async handleEmergencyStop(actorId: string): Promise<string> {
    rootLogger.warn('EMERGENCY STOP TRIGGERED VIA TELEGRAM COMMAND');

    // Only claim what was actually done. The reply used to promise that every active run had been sent
    // an abort signal even when neither a runner nor a run repository was wired — in which case nothing
    // was signalled at all — and that external writes were locked, which nothing in the tool or
    // orchestration layer implements: cancellation is cooperative and polled between model turns.
    let signalled: number | null = null;
    if (this.ctx.runner) {
      signalled = await this.ctx.runner.requestAllCancellations(`Emergency stop activated by ${actorId}`);
    } else if (this.ctx.runRepo) {
      signalled = await this.ctx.runRepo.requestCancellationForActive(`Emergency stop activated by ${actorId}`);
    }

    if (this.ctx.setEmergencyStop) await this.ctx.setEmergencyStop(true, actorId);
    else await this.ctx.setPaused(true, actorId);

    const lines = ['🚨 *EMERGENCY STOP ACTIVATED!*', '• Task intake has been frozen.'];
    lines.push(
      signalled === null
        ? '• ⚠️ No run signaller is wired, so no in-flight run was signalled — cancel runs individually with `/stop`.'
        : `• Cancellation signalled for ${signalled} run(s); each stops at its next checkpoint, not immediately.`
    );
    lines.push('• ⚠️ External writes are *not* locked by this command — it only stops new intake.');
    lines.push('', 'Use `/resume` to unfreeze the system when ready.');

    return lines.join('\n');
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

  private async handleInitiatives(): Promise<string> {
    if (!this.ctx.sdlcRepo) {
      return 'ℹ️ SDLC repository is not configured; initiatives lookup unavailable.';
    }

    try {
      const initiatives = await this.ctx.sdlcRepo.list({ limit: 10 });
      if (initiatives.length === 0) {
        return 'ℹ️ No SDLC initiatives found. Create one in Dashboard > Executive Board.';
      }

      const rows = initiatives.map((i: SDLCInitiative) => {
        const phaseEmoji: Record<string, string> = {
          inception: '💡',
          architecture: '📐',
          budget_gate: '💰',
          sprint_planning: '📋',
          implementation: '⚡',
          qa_audit: '🛡️',
          release: '🚀'
        };
        const emoji = phaseEmoji[i.currentPhase] || '📌';
        return `• ${emoji} *${i.title}*\n  ID: \`${i.id.slice(0, 8)}\` | Phase: *${i.currentPhase}* | Status: \`${i.status}\``;
      });

      return `🏛️ *Executive SDLC Initiatives:*\n\n${rows.join('\n\n')}\n\n_Use \`/initiative <id>\` for detailed phase deliverables._`;
    } catch (error) {
      rootLogger.error('Telegram initiatives query failed', { error: String(error) });
      return '⚠️ Failed to load initiatives. Please try again later.';
    }
  }

  private async handleInitiativeDetail(initiativeId?: string): Promise<string> {
    if (!initiativeId) return '⚠️ Please specify an initiative ID: `/initiative <id>`';
    if (!this.ctx.sdlcRepo) return 'ℹ️ SDLC repository is not configured.';

    try {
      const all = await this.ctx.sdlcRepo.list({ limit: 50 });
      const match = all.find((i: SDLCInitiative) => i.id === initiativeId || i.id.startsWith(initiativeId));
      if (!match) return `⚠️ Initiative \`${initiativeId}\` was not found.`;

      const deliverables = [
        match.strategicBrief ? 'Strategic Brief (CEO)' : null,
        match.technicalSpec ? 'Technical Spec (CTO)' : null,
        match.budgetEnvelope ? 'Budget Envelope (CFO)' : null,
        match.sprintPlan ? 'Sprint Plan (COO)' : null,
        match.qaReport ? 'QA Report (Argus)' : null
      ].filter(Boolean);

      const delSummary = deliverables.length > 0 ? deliverables.map(d => `- ${d}: Completed`).join('\n') : '- None yet';

      return `🏛️ *Initiative Detail:*
*Title:* ${match.title}
*ID:* \`${match.id}\`
*Current Phase:* ${match.currentPhase}
*Status:* ${match.status}
*Created At:* ${new Date(match.createdAt).toISOString().slice(0, 10)}

*Deliverables:*
${delSummary}`;
    } catch (error) {
      rootLogger.error('Telegram initiative detail query failed', { error: String(error), initiativeId });
      return `⚠️ Failed to load initiative \`${initiativeId}\`.`;
    }
  }
}
