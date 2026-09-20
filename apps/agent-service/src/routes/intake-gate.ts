import { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { TelegramStateRepository } from '@atlas/database';
import { rootLogger } from '@atlas/observability';

/**
 * The operator's "stop intake" control, as a route preHandler.
 *
 * `POST /api/v1/tasks` read the control state and answered 423 while paused or in emergency stop,
 * but the four other routes that create a task and enqueue it did not: the automation trigger, the
 * manual scheduled-job run, and both SDLC initiative routes. The invariant an operator believes
 * they bought with emergency stop — "nothing new enters the system" — was therefore violated on
 * four of five intake paths. Execution was still deferred by the queue processors, so this was not
 * an execution bypass, but rows and queue entries piled up during a stop.
 *
 * It is a preHandler rather than a helper the handler calls, so attaching it is part of declaring
 * the route: a new intake route that forgets it is visible in the route list instead of silently
 * missing from the handler body.
 */
export function createIntakeGate(options: { controlStateRepo?: TelegramStateRepository }): preHandlerHookHandler {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!options.controlStateRepo) return;

    try {
      const controlState = await options.controlStateRepo.getControlState();
      if (controlState.emergencyStop || controlState.paused) {
        return reply.status(423).send({
          error: controlState.emergencyStop ? 'Task intake is locked by emergency stop' : 'Task intake is paused',
          state: controlState.emergencyStop ? 'emergency_stop' : 'paused'
        });
      }
    } catch (err) {
      rootLogger.error('Failed to read execution control state', { error: String(err), url: request.url });
      return reply.status(503).send({ error: 'Execution control state unavailable' });
    }
  };
}
