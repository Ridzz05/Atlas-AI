import { SDLCInitiative, SDLCPhase, SDLC_PHASE_AGENT } from '@atlas/shared';
import { SDLCRepository, TaskRepository } from '@atlas/database';
import { AgentRegistry } from '@atlas/agents';
import { TaskQueue } from '../queue/task-queue.js';
import { rootLogger } from '@atlas/observability';
import { buildPhasePrompt, parsePhaseOutput } from './phase-prompts.js';

/**
 * SDLC coordination on top of the task pipeline.
 *
 * Each phase runs as an ordinary task: it is created through TaskRepository, enqueued
 * through TaskQueue, executed by AgentRunner (or expanded into specialist subtasks by
 * TaskDelegator when the phase belongs to chief), and therefore inherits the budget
 * reservation, run lease, heartbeat, cancellation, audit trail, event stream and tool
 * gating that every other task gets.
 *
 * The engine itself makes no model calls. It decides which phase runs next and how a
 * finished phase's output is read. The previous implementation called the provider
 * directly, seven times, inside an unawaited promise in the API process — bypassing all of
 * the above and leaving an initiative stranded mid-phase if the process restarted.
 */

export interface SDLCEngineOptions {
  sdlcRepo: SDLCRepository;
  taskRepo: TaskRepository;
  taskQueue: TaskQueue;
  registry: AgentRegistry;
}

export type PhaseOutcome = 'completed' | 'failed' | 'cancelled' | 'timed_out' | 'waiting_approval';

export interface PhaseResultInput {
  outcome: PhaseOutcome;
  output: string;
}

const TERMINAL_PHASES: readonly SDLCPhase[] = ['completed', 'failed'];

/**
 * Maps a task's status to the phase outcome the coordinator understands.
 *
 * Exported and pure so the mapping is testable without driving a whole run to each end
 * state. Returns null for non-terminal statuses (`queued`, `planning`, `running`,
 * `review_pending`): there is nothing to report until the task actually ends.
 */
export function phaseOutcomeFromTaskStatus(status: string): PhaseOutcome | null {
  switch (status) {
    case 'completed':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
    case 'approval_pending':
      return 'waiting_approval';
    default:
      return null;
  }
}

interface Transition {
  nextPhase: SDLCPhase;
  status: 'active' | 'paused' | 'failed' | 'completed';
  updates: Record<string, unknown>;
}

export class SDLCEngine {
  constructor(private options: SDLCEngineOptions) {}

  /**
   * Enqueue the task that executes the initiative's current phase.
   *
   * The task id is reserved first and claimed through a compare-and-set on the current
   * phase; only the winner creates and enqueues the task, so two concurrent callers cannot
   * both run the same phase.
   */
  public async startPhase(initiativeId: string): Promise<SDLCInitiative> {
    const initiative = await this.options.sdlcRepo.findById(initiativeId);
    if (!initiative) throw new Error(`SDLC Initiative not found: ${initiativeId}`);
    if (TERMINAL_PHASES.includes(initiative.currentPhase)) return initiative;

    const phase = initiative.currentPhase;
    const agentId = SDLC_PHASE_AGENT[phase];
    if (!agentId) {
      throw new Error(`No agent is assigned to SDLC phase '${phase}'.`);
    }

    const agent = this.options.registry.getOrThrow(agentId);
    const prompt = buildPhasePrompt(phase, initiative);
    const taskId = crypto.randomUUID();

    const claimed = await this.options.sdlcRepo.attachPhaseTask(initiativeId, phase, taskId);
    if (!claimed) {
      rootLogger.info(`[SDLC] Phase '${phase}' already has an open task for initiative ${initiativeId}; not enqueueing a second one`);
      const current = await this.options.sdlcRepo.findById(initiativeId);
      return current || initiative;
    }

    const task = await this.options.taskRepo.create(
      {
        title: `[SDLC ${phase}] ${initiative.title}`,
        goal: prompt,
        assignedAgent: agentId,
        parentId: initiative.parentTaskId,
        priority: 'high',
        context: { sdlcInitiativeId: initiativeId, sdlcPhase: phase }
      },
      taskId
    );

    await this.options.taskQueue.enqueue({ task, agent, prompt });

    rootLogger.info(`[SDLC] Enqueued phase '${phase}' for initiative ${initiativeId} as task ${task.id} (agent ${agentId})`);

    return claimed;
  }

  /**
   * Called when a phase task reaches a terminal state. Advances the initiative when the
   * phase produced a usable result, pauses it for human review when it did not, and
   * enqueues the next phase's task otherwise.
   *
   * Returns null when the task is not an SDLC phase task.
   */
  public async recordPhaseResult(taskId: string, input: PhaseResultInput): Promise<SDLCInitiative | null> {
    const initiative = await this.options.sdlcRepo.findByPhaseTaskId(taskId);
    if (!initiative) return null;

    const phase = initiative.currentPhase;

    if (input.outcome !== 'completed') {
      rootLogger.warn(`[SDLC] Phase '${phase}' ended as ${input.outcome}; pausing initiative ${initiative.id} for human review`);
      return this.options.sdlcRepo.advancePhase(initiative.id, phase, { status: 'paused' });
    }

    const parsed = parsePhaseOutput(phase, input.output);
    if (!parsed.ok) {
      rootLogger.warn(`[SDLC] ${parsed.reason} Pausing initiative ${initiative.id} for human review`);
      return this.options.sdlcRepo.advancePhase(initiative.id, phase, { status: 'paused' });
    }

    const transition = this.decideTransition(phase, parsed.artifact);
    const updated = await this.options.sdlcRepo.advancePhase(initiative.id, transition.nextPhase, {
      status: transition.status,
      ...transition.updates
    });

    rootLogger.info(`[SDLC] Phase '${phase}' -> '${transition.nextPhase}' (status ${transition.status}) for initiative ${initiative.id}`);

    if (!TERMINAL_PHASES.includes(transition.nextPhase) && transition.status === 'active') {
      return this.startPhase(initiative.id);
    }

    return updated;
  }

  /**
   * The transition table: the single place that decides what a phase outcome means. Kept
   * explicit and fail-closed — an outcome that is not an unambiguous pass pauses the
   * initiative rather than advancing it.
   */
  private decideTransition(phase: SDLCPhase, artifact: Record<string, unknown>): Transition {
    switch (phase) {
      case 'inception':
        return { nextPhase: 'architecture', status: 'active', updates: { strategicBrief: artifact } };

      case 'architecture':
        if (artifact.technicalFeasibility === 'approved') {
          return { nextPhase: 'budget_gate', status: 'active', updates: { technicalSpec: artifact } };
        }
        return { nextPhase: 'architecture', status: 'paused', updates: { technicalSpec: artifact } };

      case 'budget_gate':
        if (artifact.financialApproval === 'approved') {
          return { nextPhase: 'sprint_planning', status: 'active', updates: { budgetEnvelope: artifact } };
        }
        return { nextPhase: 'budget_gate', status: 'paused', updates: { budgetEnvelope: artifact } };

      case 'sprint_planning': {
        const subtasks = Array.isArray(artifact.subtasks) ? artifact.subtasks : [];
        if (subtasks.length === 0) {
          return { nextPhase: 'sprint_planning', status: 'paused', updates: { sprintPlan: artifact } };
        }
        return { nextPhase: 'implementation', status: 'active', updates: { sprintPlan: artifact } };
      }

      case 'implementation':
        return { nextPhase: 'qa_compliance', status: 'active', updates: {} };

      case 'qa_compliance': {
        const verdict = String(artifact.verdict || '');
        const passed = verdict === 'PASS' || verdict === 'PASS_WITH_WARNINGS';
        return passed
          ? { nextPhase: 'release_signoff', status: 'active', updates: { qaReport: artifact } }
          : { nextPhase: 'failed', status: 'failed', updates: { qaReport: artifact } };
      }

      case 'release_signoff':
        return { nextPhase: 'completed', status: 'completed', updates: {} };

      default:
        return { nextPhase: phase, status: 'paused', updates: {} };
    }
  }
}
