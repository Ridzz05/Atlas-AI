import { WorkflowCheckpoint } from '@atlas/shared';
import { WorkflowCheckpointRepository } from '@atlas/database';
import { WorkflowRuntime } from './workflow-runtime.js';

export interface ResumeDriverOptions {
  runtime: WorkflowRuntime;
  checkpointRepo: WorkflowCheckpointRepository;
  onResume: (checkpoint: WorkflowCheckpoint) => Promise<void>;
  intervalMs?: number;
  batchSize?: number;
}

const RESUMABLE_STATES = new Set<WorkflowCheckpoint['state']>(['scheduled', 'paused', 'waiting_external_event']);

export class ResumeDriver {
  private timer: NodeJS.Timeout | null = null;
  private readonly opts: ResumeDriverOptions;

  constructor(opts: ResumeDriverOptions) {
    this.opts = opts;
  }

  public async tick(now: Date = new Date()): Promise<number> {
    const due = await this.opts.checkpointRepo.listResumable(now, this.opts.batchSize ?? 25);
    for (const cp of due) {
      try {
        await this.opts.onResume(cp);
        if (RESUMABLE_STATES.has(cp.state)) {
          await this.opts.runtime.transition({
            runId: cp.runId,
            stepId: cp.stepId,
            to: 'running',
            reason: 'Resumed by driver'
          });
        }
      } catch (err) {
        const reason = `Resume handler error: ${String(err)}`;
        // Ensure checkpoint is in a state that can transition to failed (running) before failing
        if (RESUMABLE_STATES.has(cp.state)) {
          try {
            await this.opts.runtime.transition({
              runId: cp.runId,
              stepId: cp.stepId,
              to: 'running',
              reason: 'Resume handler error: normalizing state'
            });
          } catch (transitionErr) {
            await this.opts.checkpointRepo.appendTransition(cp.runId, cp.stepId, {
              from: cp.state,
              to: cp.state,
              at: new Date(),
              reason: `${reason}; normalize failed: ${String(transitionErr)}`,
              payload: {}
            });
            continue;
          }
        }
        try {
          await this.opts.runtime.fail(cp.runId, cp.stepId, reason);
        } catch (failErr) {
          await this.opts.checkpointRepo.appendTransition(cp.runId, cp.stepId, {
            from: cp.state,
            to: cp.state,
            at: new Date(),
            reason: `${reason}; fail transition also failed: ${String(failErr)}`,
            payload: {}
          });
        }
      }
    }
    return due.length;
  }

  public start(): void {
    if (this.timer) return;
    const interval = this.opts.intervalMs ?? 30_000;
    this.timer = setInterval(() => {
      void this.tick().catch(() => undefined);
    }, interval);
    if (typeof this.timer.unref === 'function') {
      this.timer.unref();
    }
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
