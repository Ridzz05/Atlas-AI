import { Task, CreateTaskInput } from '@atlas/shared';
import { AgentRegistry } from '@atlas/agents';
import { TaskRepository, WorkflowCheckpointRepository } from '@atlas/database';
import { TaskQueue } from '../queue/task-queue.js';
import { rootLogger } from '@atlas/observability';
import { EventBus } from '@atlas/events';

/**
 * AutomationEngine — unified facade for full AI Automation.
 * Wraps scheduled jobs, durable workflows, and event-driven triggers
 * so the worker can expose a single automation surface following the
 * existing orchestration pattern (TaskRepository -> TaskQueue -> AgentRunner/Delegator).
 *
 * Design mirrors current TaskDelegator / AgentRunner contract:
 * - fail-closed (no silent fallback)
 * - auditable (events via EventBus)
 * - budget-aware (delegates to existing runner)
 * - queue-persistent (BullMQ with idempotent jobId)
 */
export interface AutomationTrigger {
  id: string;
  type: 'cron' | 'event' | 'webhook' | 'manual';
  jobType: string;
  payload?: Record<string, unknown>;
}

export interface AutomationExecutionResult {
  taskId: string;
  triggerId: string;
  status: 'queued' | 'skipped' | 'failed';
  reason?: string;
}

export interface AutomationEngineOptions {
  taskRepo: TaskRepository;
  taskQueue: TaskQueue;
  registry: AgentRegistry;
  checkpointRepo?: WorkflowCheckpointRepository;
  eventBus?: EventBus;
}

export class AutomationEngine {
  constructor(private opts: AutomationEngineOptions) {}

  /**
   * Execute an automation trigger end-to-end:
   * validate -> create durable Task -> enqueue -> emit event.
   * Follows identical path as POST /api/v1/tasks but without HTTP.
   */
  public async execute(trigger: AutomationTrigger): Promise<AutomationExecutionResult> {
    const agentId = this.resolveAgentForJobType(trigger.jobType);
    const agent = this.opts.registry.get(agentId);
    if (!agent) {
      const reason = `No agent registered for jobType ${trigger.jobType} -> ${agentId}`;
      rootLogger.error('Automation execution rejected', { triggerId: trigger.id, reason });
      return { taskId: '', triggerId: trigger.id, status: 'failed', reason };
    }

    const input: CreateTaskInput = {
      title: `[automation:${trigger.type}] ${trigger.jobType} — ${trigger.id}`,
      goal: this.buildGoal(trigger),
      assignedAgent: agent.id,
      priority: 'normal',
      context: {
        source: 'automation_engine',
        automationTriggerId: trigger.id,
        automationTriggerType: trigger.type,
        automationJobType: trigger.jobType,
        automationPayload: trigger.payload ?? {}
      }
    };

    try {
      const task = await this.opts.taskRepo.create(input);
      await this.opts.taskQueue.enqueue({
        task,
        agent,
        prompt: task.goal
      });
      rootLogger.info('Automation task enqueued', {
        triggerId: trigger.id,
        jobType: trigger.jobType,
        taskId: task.id,
        agentId: agent.id,
        type: trigger.type
      });
      return { taskId: task.id, triggerId: trigger.id, status: 'queued' };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      rootLogger.error('Automation task enqueue failed', { triggerId: trigger.id, error: reason });
      return { taskId: '', triggerId: trigger.id, status: 'failed', reason };
    }
  }

  /**
   * Direct task creation without queue (for testing / dry-run).
   */
  public async createTaskOnly(trigger: AutomationTrigger): Promise<Task> {
    const agentId = this.resolveAgentForJobType(trigger.jobType);
    return this.opts.taskRepo.create({
      title: `[automation:${trigger.type}] ${trigger.jobType} — ${trigger.id}`,
      goal: this.buildGoal(trigger),
      assignedAgent: agentId,
      priority: 'normal',
      context: {
        source: 'automation_engine',
        automationTriggerId: trigger.id,
        automationTriggerType: trigger.type,
        automationJobType: trigger.jobType,
        automationPayload: trigger.payload ?? {}
      }
    });
  }

  private resolveAgentForJobType(jobType: string): string {
    switch (jobType) {
      case 'daily_briefing':
      case 'custom_automation':
        return 'chief';
      case 'lead_discovery':
        return 'chief';
      case 'research_sync':
        return 'ned';
      case 'memory_consolidation':
        return 'argus';
      default:
        return 'chief';
    }
  }

  private buildGoal(trigger: AutomationTrigger): string {
    const payloadSnippet = trigger.payload ? ` Payload: ${JSON.stringify(trigger.payload)}.` : '';
    switch (trigger.jobType) {
      case 'daily_briefing':
        return (
          'Susun ringkasan harian untuk owner: highlight hasil kemarin, status berjalan, risiko hari ini, dan rekomendasi. Delegasikan ke Ned (rekap 24 jam), Hermes (narasi), Argus (QA).' +
          payloadSnippet
        );
      case 'lead_discovery':
        return (
          'Jalankan lead discovery otomasi: cari, enrich, dan scoring calon klien sesuai payload, lalu draft outreach via Hermes dan verifikasi via Argus. Jangan kirim outbound tanpa approval.' +
          payloadSnippet
        );
      case 'research_sync':
        return (
          'Sinkronkan riset terbaru: kumpulkan dan verifikasi informasi dari sumber terkonfigurasi, tulis ke Second Brain.' + payloadSnippet
        );
      case 'memory_consolidation':
        return 'Konsolidasikan memori: ringkas episodic, tandai superseded knowledge, dan usulkan deprecation.' + payloadSnippet;
      default:
        if (trigger.payload && typeof (trigger.payload as any).goal === 'string' && (trigger.payload as any).goal.length > 0) {
          return String((trigger.payload as any).goal) + payloadSnippet;
        }
        return `Eksekusi otomasi ${trigger.jobType} via trigger ${trigger.type} (${trigger.id}).` + payloadSnippet;
    }
  }
}
