import { ScheduledJobRepository, TaskRepository } from '@atlas/database';
import { AgentDefinition, CreateTaskInput, ScheduledJob } from '@atlas/shared';
import { AgentRegistry } from '@atlas/agents';
import { rootLogger } from '@atlas/observability';
import { TaskQueue } from '../queue/task-queue.js';

export interface ScheduledJobTriggerContext {
  job: ScheduledJob;
  firedAt: Date;
}

export type ScheduledJobTriggerHandler = (context: ScheduledJobTriggerContext) => Promise<void>;

export type NextRunCalculator = (job: ScheduledJob) => Date | null;

const defaultNextRunCalculator: NextRunCalculator = job => {
  try {
    const dynamicRequire = (0, eval)('require') as NodeRequire;
    const CronExpressionParser = dynamicRequire('cron-parser') as {
      parseExpression: (expr: string, opts?: { tz?: string }) => { next: () => { toDate: () => Date } };
    };
    const interval = CronExpressionParser.parseExpression(job.cronPattern, { tz: job.timezone });
    return interval.next().toDate();
  } catch {
    return null;
  }
};

export interface ScheduledJobSchedulerOptions {
  scheduledJobRepo: ScheduledJobRepository;
  taskRepo: TaskRepository;
  registry: AgentRegistry;
  triggerHandler: ScheduledJobTriggerHandler;
  taskQueue?: TaskQueue;
  nextRunCalculator?: NextRunCalculator;
  syncIntervalSeconds?: number;
}

const DEFAULT_SYNC_INTERVAL_SECONDS = 30;

export class ScheduledJobScheduler {
  private syncTimer: NodeJS.Timeout | null = null;
  private syncInFlight = false;
  private readonly intervalSeconds: number;
  private readonly handler: ScheduledJobTriggerHandler;
  private readonly scheduledJobRepo: ScheduledJobRepository;
  private readonly taskRepo: TaskRepository;
  private readonly registry: AgentRegistry;
  private readonly nextRunCalculator: NextRunCalculator;
  private readonly taskQueue?: TaskQueue;
  private readonly trackedJobIds = new Set<string>();
  private running = false;

  constructor(options: ScheduledJobSchedulerOptions) {
    this.scheduledJobRepo = options.scheduledJobRepo;
    this.taskRepo = options.taskRepo;
    this.registry = options.registry;
    this.handler = options.triggerHandler;
    this.taskQueue = options.taskQueue;
    this.nextRunCalculator = options.nextRunCalculator ?? defaultNextRunCalculator;
    this.intervalSeconds = options.syncIntervalSeconds ?? DEFAULT_SYNC_INTERVAL_SECONDS;
  }

  public async start(): Promise<void> {
    this.running = true;
    await this.syncOnce().catch(error => {
      rootLogger.error('Initial scheduled job sync failed', { error: String(error) });
    });
    this.syncTimer = setInterval(() => {
      void this.syncInBackground();
    }, this.intervalSeconds * 1000);
    this.syncTimer.unref?.();
  }

  public stop(): void {
    this.running = false;
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }

  public getTrackedJobIds(): string[] {
    return Array.from(this.trackedJobIds);
  }

  public async runJobNow(jobId: string): Promise<{ executed: boolean; reason?: string }> {
    const job = await this.scheduledJobRepo.findById(jobId);
    if (!job) return { executed: false, reason: 'not_found' };
    if (!job.enabled) return { executed: false, reason: 'disabled' };
    await this.dispatch(job, { manual: true });
    return { executed: true };
  }

  async syncInBackground(): Promise<void> {
    if (!this.running || this.syncInFlight) return;
    this.syncInFlight = true;
    try {
      await this.syncOnce();
    } catch (error) {
      rootLogger.error('Scheduled job sync failed', { error: String(error) });
    } finally {
      this.syncInFlight = false;
    }
  }

  async syncOnce(): Promise<void> {
    const enabledJobs = await this.scheduledJobRepo.list({ enabled: true });
    const seenIds = new Set<string>();
    for (const job of enabledJobs) {
      seenIds.add(job.id);
      if (!this.trackedJobIds.has(job.id)) {
        this.trackedJobIds.add(job.id);
        rootLogger.info('Scheduled job registered', {
          id: job.id,
          jobType: job.jobType,
          cron: job.cronPattern,
          tz: job.timezone
        });
      }
    }
    for (const staleId of Array.from(this.trackedJobIds)) {
      if (!seenIds.has(staleId)) {
        this.trackedJobIds.delete(staleId);
        rootLogger.info('Scheduled job unregistered', { id: staleId });
      }
    }
  }

  private async dispatch(job: ScheduledJob, _meta: { manual: boolean }): Promise<void> {
    const agent = this.registry.get(job.assignedAgent);
    if (!agent) {
      const error = `Assigned agent not found: ${job.assignedAgent}`;
      await this.scheduledJobRepo.recordRun(job.id, null, error);
      rootLogger.error('Scheduled job has no matching agent', { id: job.id, agentId: job.assignedAgent });
      return;
    }
    try {
      const input: CreateTaskInput = {
        title: `[scheduled] ${job.name}`,
        goal: this.buildGoalForJob(job),
        assignedAgent: job.assignedAgent,
        priority: 'normal',
        context: {
          source: 'scheduled_job',
          scheduledJobId: job.id,
          scheduledJobType: job.jobType,
          scheduledJobPayload: job.payload
        }
      };
      const task = await this.taskRepo.create(input);
      if (this.taskQueue) {
        try {
          await this.taskQueue.enqueue({ task, agent, prompt: task.goal });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          rootLogger.error('Scheduled job enqueue failed', { id: job.id, error: message });
          await this.scheduledJobRepo.recordRun(job.id, null, `enqueue failed: ${message}`);
          return;
        }
      }
      await this.handler({ job, firedAt: new Date() });
      await this.scheduledJobRepo.recordRun(job.id, this.nextRunCalculator(job), undefined);
      rootLogger.info('Scheduled job dispatched', {
        id: job.id,
        taskId: task.id,
        agentId: job.assignedAgent,
        queued: Boolean(this.taskQueue)
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.scheduledJobRepo.recordRun(job.id, null, message);
      rootLogger.error('Scheduled job dispatch failed', { id: job.id, error: message });
    }
  }

  private buildGoalForJob(job: ScheduledJob): string {
    switch (job.jobType) {
      case 'daily_briefing':
        return [
          'Susun ringkasan harian (daily briefing) untuk owner.',
          'Tujuan: highlight hasil kemarin, status berjalan, risiko hari ini, dan rekomendasi.',
          'Delegasikan ke Ned untuk rekap memory/episodic 24 jam terakhir, Hermes untuk menyusun narasi, Argus untuk QA.',
          'Jangan kirim apa pun lewat Telegram; cukup tampilkan di dashboard dan tulis artifact briefing.'
        ].join(' ');
      default:
        return `Run scheduled job ${job.id} of type ${job.jobType}`;
    }
  }
}
