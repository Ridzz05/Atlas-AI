import cronParser from 'cron-parser';
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
    const parser = (cronParser as unknown as { default?: typeof cronParser }).default || cronParser;
    const interval = parser.parseExpression(job.cronPattern, { tz: job.timezone });
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
  tickIntervalSeconds?: number;
  automationEnabled?: boolean;
  nowProvider?: () => Date;
}

const DEFAULT_SYNC_INTERVAL_SECONDS = 30;
const DEFAULT_TICK_INTERVAL_SECONDS = 60;

export class ScheduledJobScheduler {
  private syncTimer: NodeJS.Timeout | null = null;
  private tickTimer: NodeJS.Timeout | null = null;
  private syncInFlight = false;
  private tickInFlight = false;
  private readonly intervalSeconds: number;
  private readonly tickIntervalSeconds: number;
  private readonly automationEnabled: boolean;
  private readonly nowProvider: () => Date;
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
    this.tickIntervalSeconds = options.tickIntervalSeconds ?? DEFAULT_TICK_INTERVAL_SECONDS;
    this.automationEnabled = options.automationEnabled ?? true;
    this.nowProvider = options.nowProvider ?? (() => new Date());
  }

  public async start(): Promise<void> {
    this.running = true;
    await this.syncOnce().catch(error => {
      rootLogger.error('Initial scheduled job sync failed', { error: String(error) });
    });
    // Automation tick: if jobs are due (nextRunAt <= now || null), dispatch immediately on start
    if (this.automationEnabled) {
      await this.tickDueJobs().catch(error => {
        rootLogger.error('Initial automation tick failed', { error: String(error) });
      });
    }
    this.syncTimer = setInterval(() => {
      void this.syncInBackground();
    }, this.intervalSeconds * 1000);
    this.syncTimer.unref?.();
    if (this.automationEnabled) {
      this.tickTimer = setInterval(() => {
        void this.tickInBackground();
      }, this.tickIntervalSeconds * 1000);
      this.tickTimer.unref?.();
    }
  }

  public stop(): void {
    this.running = false;
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
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

  public async tickDueJobs(now: Date = this.nowProvider()): Promise<number> {
    if (!this.automationEnabled || !this.running) return 0;
    const enabledJobs = await this.scheduledJobRepo.list({ enabled: true });
    let dispatched = 0;
    for (const job of enabledJobs) {
      if (!this.isDue(job, now)) continue;
      // dispatch claims the job before it does anything, so a job another replica already took is
      // not double-fired and is not counted as dispatched here.
      try {
        if (await this.dispatch(job, { manual: false })) dispatched++;
      } catch (error) {
        rootLogger.error('Automation tick dispatch failed', { id: job.id, error: String(error) });
      }
    }
    if (dispatched > 0) {
      rootLogger.info('Automation tick dispatched due jobs', { dispatched, now: now.toISOString() });
    }
    return dispatched;
  }

  public isDue(job: ScheduledJob, now: Date = this.nowProvider()): boolean {
    // A job that has never run is due immediately so the first tick fires it. A job that HAS run
    // but whose next run is unknown is not due: `null` used to mean "due now", and every
    // dispatch-failure path persisted `null`, so one transient failure turned the job into a
    // duplicate-task generator on every tick, forever.
    if (!job.nextRunAt) return !job.lastRunAt;
    const nextRun = new Date(job.nextRunAt);
    if (Number.isNaN(nextRun.getTime())) return !job.lastRunAt;
    return nextRun <= now;
  }

  /**
   * Where to point the schedule after a failed dispatch.
   *
   * The failure paths used to persist `null`, which read as "due now" and re-fired the job on
   * every tick. A retry horizon keeps the retry but stops the hot loop.
   */
  private retryHorizon(): Date {
    return new Date(this.nowProvider().getTime() + this.tickIntervalSeconds * 1000);
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

  async tickInBackground(): Promise<void> {
    if (!this.running || this.tickInFlight || !this.automationEnabled) return;
    this.tickInFlight = true;
    try {
      await this.tickDueJobs();
    } catch (error) {
      rootLogger.error('Automation tick failed', { error: String(error) });
    } finally {
      this.tickInFlight = false;
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
      // Initialize nextRunAt for newly enabled jobs that have never been scheduled
      if (!job.nextRunAt && !job.lastRunAt) {
        const next = this.nextRunCalculator(job);
        if (next) {
          await this.scheduledJobRepo.recordRun(job.id, next, undefined).catch(() => undefined);
          rootLogger.info('Initialized nextRunAt for automation job', { id: job.id, nextRunAt: next.toISOString() });
        }
      }
    }
    for (const staleId of Array.from(this.trackedJobIds)) {
      if (!seenIds.has(staleId)) {
        this.trackedJobIds.delete(staleId);
        rootLogger.info('Scheduled job unregistered', { id: staleId });
      }
    }
  }

  private async dispatch(job: ScheduledJob, _meta: { manual: boolean }): Promise<boolean> {
    // Claim BEFORE any side effect. The tick read the job, decided it was due, created a task and
    // enqueued it, and only then advanced the schedule with a blind UPDATE — no compare-and-set
    // anywhere. Two worker replicas ticking in the same minute both read the same next_run_at,
    // both passed isDue, and both dispatched, each minting its own task id, so one cron tick ran
    // twice and nothing downstream could deduplicate the two runs.
    const expectedNextRunAt = job.nextRunAt && !Number.isNaN(new Date(job.nextRunAt).getTime()) ? new Date(job.nextRunAt) : null;
    const nextRunAt = this.nextRunCalculator(job) ?? this.retryHorizon();

    const claimed = await this.scheduledJobRepo.claimRun(job.id, expectedNextRunAt, nextRunAt);
    if (!claimed) {
      rootLogger.info('Scheduled job was already claimed for this run', { id: job.id });
      return false;
    }

    const agent = this.registry.get(job.assignedAgent);
    if (!agent) {
      const error = `Assigned agent not found: ${job.assignedAgent}`;
      await this.scheduledJobRepo.recordError(job.id, error);
      rootLogger.error('Scheduled job has no matching agent', { id: job.id, agentId: job.assignedAgent });
      return false;
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
          await this.scheduledJobRepo.recordError(job.id, `enqueue failed: ${message}`);
          return false;
        }
      }
      await this.handler({ job, firedAt: new Date() });
      rootLogger.info('Scheduled job dispatched', {
        id: job.id,
        taskId: task.id,
        agentId: job.assignedAgent,
        queued: Boolean(this.taskQueue)
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.scheduledJobRepo.recordError(job.id, message);
      rootLogger.error('Scheduled job dispatch failed', { id: job.id, error: message });
      return false;
    }

    return true;
  }

  private buildGoalForJob(job: ScheduledJob): string {
    const payloadHint = job.payload && Object.keys(job.payload).length > 0 ? ` Payload: ${JSON.stringify(job.payload)}.` : '';
    switch (job.jobType) {
      case 'daily_briefing':
        return [
          'Susun ringkasan harian (daily briefing) untuk owner.',
          'Tujuan: highlight hasil kemarin, status berjalan, risiko hari ini, dan rekomendasi.',
          'Delegasikan ke Ned untuk rekap memory/episodic 24 jam terakhir, Hermes untuk menyusun narasi, Argus untuk QA.',
          'Jangan kirim apa pun lewat Telegram; cukup tampilkan di dashboard dan tulis artifact briefing.'
        ].join(' ');
      case 'lead_discovery':
        return (
          [
            'Jalankan otomasi lead discovery: cari calon klien potensial berdasarkan payload dan konteks terakhir.',
            'Delegasikan ke Ned untuk research/enrichment, Layla untuk scoring rubric, Hermes untuk draft outreach, Argus untuk QA.',
            'Simpan hasil sebagai artifact CSV/Markdown dan jangan kirim outbound tanpa approval.'
          ].join(' ') + payloadHint
        );
      case 'research_sync':
        return (
          [
            'Sinkronkan riset dan knowledge: kumpulkan update terbaru dari sumber yang terkonfigurasi.',
            'Ned memverifikasi sumber dan menulis ke Second Brain, Argus memvalidasi factuality.'
          ].join(' ') + payloadHint
        );
      case 'memory_consolidation':
        return (
          [
            'Lakukan konsolidasi memori: review episodic memory, ringkas keputusan penting, dan usulkan deprecation untuk stale knowledge.',
            'Gunakan MemoryTools dengan expiry enforcement; hanya verified memory yang dipromosikan.'
          ].join(' ') + payloadHint
        );
      case 'workflow_resume':
        return (
          [
            'Lanjutkan workflow tertunda: periksa checkpoint scheduled/waiting_external_event yang sudah jatuh tempo dan resume task terkait.'
          ].join(' ') + payloadHint
        );
      case 'custom_automation':
        return (
          (typeof job.payload.goal === 'string' && job.payload.goal.length > 0
            ? String(job.payload.goal)
            : `Jalankan otomasi kustom ${job.name}: ${job.jobType}.`) + payloadHint
        );
      default:
        return `Run scheduled job ${job.id} of type ${job.jobType}` + payloadHint;
    }
  }
}
