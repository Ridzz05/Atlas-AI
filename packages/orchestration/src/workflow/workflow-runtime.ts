import { randomUUID } from 'node:crypto';
import {
  WorkflowCheckpoint,
  WorkflowState,
  WorkflowTransition,
  canTransition
} from '@atlas/shared';
import {
  WorkflowCheckpointRepository,
  WorkflowCheckpointUpsertInput
} from '@atlas/database';
import { rootLogger } from '@atlas/observability';

export type WorkflowEvent = {
  id: string;
  type: `workflow.${WorkflowState}`;
  taskId: string;
  runId: string;
  agentId: string;
  payload: Record<string, unknown>;
  timestamp: string;
};

export interface WorkflowEventBus {
  publish(event: WorkflowEvent): Promise<void>;
}

export interface WorkflowRuntimeOptions {
  checkpointRepo: WorkflowCheckpointRepository;
  eventBus?: WorkflowEventBus;
  now?: () => Date;
}

export interface WorkflowStartInput {
  runId: string;
  taskId: string;
  agentId: string;
  stepId: string;
  initialState?: WorkflowState;
  payload?: Record<string, unknown>;
}

export interface WorkflowTransitionInput {
  runId: string;
  stepId: string;
  to: WorkflowState;
  reason?: string;
  payload?: Record<string, unknown>;
  resumeAfter?: Date | null;
}

export class WorkflowRuntime {
  private readonly checkpointRepo: WorkflowCheckpointRepository;
  private readonly eventBus?: WorkflowEventBus;
  private readonly now: () => Date;

  constructor(opts: WorkflowRuntimeOptions) {
    this.checkpointRepo = opts.checkpointRepo;
    this.eventBus = opts.eventBus;
    this.now = opts.now ?? (() => new Date());
  }

  public async start(input: WorkflowStartInput): Promise<WorkflowCheckpoint> {
    const upsertInput: WorkflowCheckpointUpsertInput = {
      runId: input.runId,
      taskId: input.taskId,
      agentId: input.agentId,
      stepId: input.stepId,
      state: input.initialState ?? 'running',
      resumeAfter: null,
      payload: input.payload ?? {}
    };
    return this.checkpointRepo.upsert(upsertInput);
  }

  public async transition(input: WorkflowTransitionInput): Promise<WorkflowCheckpoint> {
    const current = await this.checkpointRepo.findByRunAndStep(input.runId, input.stepId);
    if (!current) {
      throw new Error('Workflow checkpoint not found');
    }
    if (!canTransition(current.state, input.to)) {
      throw new Error(`Illegal workflow transition: ${current.state} -> ${input.to}`);
    }

    const updated = await this.checkpointRepo.upsert({
      runId: current.runId,
      taskId: current.taskId,
      agentId: current.agentId,
      stepId: current.stepId,
      state: input.to,
      resumeAfter: input.resumeAfter ?? null,
      payload: input.payload ?? current.payload
    });

    const transitionRecord: WorkflowTransition = {
      from: current.state,
      to: input.to,
      at: this.now(),
      reason: input.reason,
      payload: input.payload ?? {}
    };
    await this.checkpointRepo.appendTransition(input.runId, input.stepId, transitionRecord);

    if (this.eventBus) {
      const event: WorkflowEvent = {
        id: randomUUID(),
        type: `workflow.${input.to}`,
        taskId: current.taskId,
        runId: current.runId,
        agentId: current.agentId,
        payload: {
          from: current.state,
          to: input.to,
          reason: input.reason,
          stepId: current.stepId
        },
        timestamp: this.now().toISOString()
      };
      try {
        await this.eventBus.publish(event);
      } catch (err) {
        rootLogger.error('Failed to publish workflow event', {
          error: String(err),
          type: event.type,
          runId: event.runId,
          stepId: current.stepId
        });
      }
    }

    return updated;
  }

  public async waitForApproval(
    runId: string,
    stepId: string,
    approvalId: string
  ): Promise<WorkflowCheckpoint> {
    return this.transition({
      runId,
      stepId,
      to: 'waiting_approval',
      reason: `Waiting for approval ${approvalId}`,
      payload: { approvalId }
    });
  }

  public async waitForExternalEvent(
    runId: string,
    stepId: string,
    resumeAfter?: Date
  ): Promise<WorkflowCheckpoint> {
    return this.transition({
      runId,
      stepId,
      to: 'waiting_external_event',
      reason: 'Waiting for external event',
      resumeAfter: resumeAfter ?? null
    });
  }

  public async schedule(
    runId: string,
    stepId: string,
    resumeAfter: Date
  ): Promise<WorkflowCheckpoint> {
    return this.transition({
      runId,
      stepId,
      to: 'scheduled',
      reason: 'Scheduled for later execution',
      resumeAfter
    });
  }

  public async pause(runId: string, stepId: string, reason: string): Promise<WorkflowCheckpoint> {
    return this.transition({ runId, stepId, to: 'paused', reason });
  }

  public async resume(runId: string, stepId: string, reason?: string): Promise<WorkflowCheckpoint> {
    return this.transition({ runId, stepId, to: 'running', reason: reason ?? 'Resumed' });
  }

  public async retry(runId: string, stepId: string, reason: string): Promise<WorkflowCheckpoint> {
    return this.transition({ runId, stepId, to: 'retrying', reason });
  }

  public async fail(runId: string, stepId: string, reason: string): Promise<WorkflowCheckpoint> {
    return this.transition({ runId, stepId, to: 'failed', reason });
  }

  public async complete(
    runId: string,
    stepId: string,
    payload?: Record<string, unknown>
  ): Promise<WorkflowCheckpoint> {
    return this.transition({ runId, stepId, to: 'completed', reason: 'Completed', payload });
  }

  public async cancel(runId: string, stepId: string, reason: string): Promise<WorkflowCheckpoint> {
    return this.transition({ runId, stepId, to: 'cancelled', reason });
  }

  public async get(runId: string, stepId: string): Promise<WorkflowCheckpoint | null> {
    return this.checkpointRepo.findByRunAndStep(runId, stepId);
  }

  public async listByRun(runId: string): Promise<WorkflowCheckpoint[]> {
    return this.checkpointRepo.listByRun(runId);
  }
}