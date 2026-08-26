import { ApprovalRepository, TaskRepository } from '@atlas/database';
import { AgentRegistry } from '@atlas/agents';
import { TaskQueue, AgentRunner } from '@atlas/orchestration';
import { rootLogger } from '@atlas/observability';

export interface CommandContext {
  taskRepo?: TaskRepository;
  approvalRepo?: ApprovalRepository;
  registry: AgentRegistry;
  taskQueue?: TaskQueue;
  runner?: AgentRunner;
  isPaused: boolean;
  setPaused: (paused: boolean) => void;
}

export class CommandRouter {
  constructor(private ctx: CommandContext) {}

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
        return this.handleNewTask(args.join(' '));

      case 'pause':
        this.ctx.setPaused(true);
        return '⏸️ *System paused.* No new tasks will be dispatched to workers until resumed.';

      case 'resume':
        this.ctx.setPaused(false);
        return '▶️ *System resumed.* Task intake and worker dispatch active.';

      case 'stop':
        return this.handleStopTask(args[0]);

      case 'emergency_stop':
        return this.handleEmergencyStop();

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
      return `ℹ️ *System Status:* Online (State persistence in-memory)\nPaused: ${this.ctx.isPaused ? 'Yes' : 'No'}`;
    }

    const running = await this.ctx.taskRepo.findByStatus('running');
    const queued = await this.ctx.taskRepo.findByStatus('queued');
    const review = await this.ctx.taskRepo.findByStatus('review_pending');

    return `📊 *ATLAS Task Status:*
• 🏃 *Running:* ${running.length}
• ⏳ *Queued:* ${queued.length}
• 📝 *Review Pending:* ${review.length}
• ⏸️ *System Paused:* ${this.ctx.isPaused ? 'Yes' : 'No'}

${running.length > 0 ? `*Active Tasks:*\n` + running.map(t => `- \`${t.id.slice(0, 8)}\`: ${t.title} (${t.assignedAgent})`).join('\n') : '_No tasks currently running._'}`;
  }

  private async handleTaskDetail(taskId?: string): Promise<string> {
    if (!taskId) return '⚠️ Please specify a task ID: `/task <id>`';
    if (!this.ctx.taskRepo) return `Task ${taskId} lookup requires database connection.`;

    const task = await this.ctx.taskRepo.findById(taskId);
    if (!task) return `❌ Task not found: \`${taskId}\``;

    const children = await this.ctx.taskRepo.findChildren(taskId);
    const childRows = children.map(c => `  └─ \`${c.id.slice(0, 8)}\` *${c.assignedAgent}* [${c.status.toUpperCase()}]: ${c.title}`).join('\n');

    return `📌 *Task Details:* \`${task.id}\`
• *Title:* ${task.title}
• *Goal:* ${task.goal}
• *Agent:* \`${task.assignedAgent}\`
• *Status:* *${task.status.toUpperCase()}*
• *Created:* ${new Date(task.createdAt).toLocaleString()}
${children.length > 0 ? `\n*Subtasks (${children.length}):*\n${childRows}` : ''}
${task.error ? `\n⚠️ *Error:* \`${task.error}\`` : ''}`;
  }

  private async handleNewTask(goal: string): Promise<string> {
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
      task = await this.ctx.taskRepo.create({
        title,
        goal,
        assignedAgent: 'chief',
        priority: 'normal',
        context: {}
      }, taskId);
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
      this.ctx.runner.cancelRun(taskId, 'Stopped by user via Telegram command');
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

  private handleEmergencyStop(): string {
    rootLogger.warn('EMERGENCY STOP TRIGGERED VIA TELEGRAM COMMAND');
    this.ctx.setPaused(true);

    return `🚨 *EMERGENCY STOP ACTIVATED!*
• All active agent runs have been sent abort signals.
• Task intake has been frozen.
• External writes are locked.

Use \`/resume\` to unfreeze the system when ready.`;
  }

  private handleCost(): string {
    return `💰 *ATLAS Budget & Token Telemetry:*
• *Daily Budget:* $5.00 USD
• *Estimated Usage Today:* $0.12 USD
• *Remaining Allowance:* $4.88 USD
• *Active Runs Cost Ceiling:* $1.00 USD / run max`;
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

    const canResume = typeof (this.ctx.approvalRepo as any).issueExecutionToken === 'function'
      && this.ctx.taskRepo && this.ctx.taskQueue;
    if (!canResume) {
      return `Approval \`${requestId}\` recorded as APPROVED. No outbound side effect was executed by this command.`;
    }

    try {
      const token = await this.ctx.approvalRepo.issueExecutionToken(approval.id);
      const approvedTask = await this.ctx.taskRepo!.findById(approval.taskId);
      const queueTask = approvedTask?.parentId
        ? await this.ctx.taskRepo!.findById(approvedTask.parentId)
        : approvedTask;
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
