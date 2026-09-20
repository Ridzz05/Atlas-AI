/**
 * One question, asked in three places: is this run still alive?
 *
 * It was answered three times with three different predicates, and they disagreed about the one status
 * that matters most:
 *
 *   recoverStaleRuns            status IN (created, active, waiting_tool, waiting_child)   -> waiting_approval is ALIVE
 *   recoverStaleRuns' task pass NOT EXISTS (... IN (..., waiting_approval))                -> waiting_approval is ALIVE
 *   recoverStaleReservations    ... AND (lease_expires_at IS NULL OR > NOW())               -> waiting_approval is DEAD
 *
 * So a worker that died while a run waited for approval left the run and its task stuck forever — the
 * run sweep never failed the run, and the task sweep saw a live run and skipped the task — while the
 * budget sweep released the reservation underneath it. The resumed run then spent outside the cap it was
 * admitted under, and the operator had no way to clear either row.
 *
 * A run parked on a human is alive exactly while that human can still decide, and `approvals.expires_at`
 * is when that stops being true. That is what this reads. A lease cannot answer it: a waiting_approval
 * run legitimately holds no lease, because no worker is running it.
 *
 * Statuses that mean a worker is holding the run right now. Each of them must also have a lease that has
 * not expired, because a process that died leaves its lease behind.
 */
export const WORKER_HELD_RUN_STATUSES = ['created', 'active', 'waiting_tool', 'waiting_child'] as const;

/** Statuses a run can be in and still be recoverable: the worker-held ones plus the one parked on a human. */
export const RECOVERABLE_RUN_STATUSES = [...WORKER_HELD_RUN_STATUSES, 'waiting_approval'] as const;

/** Approval states in which the operator can still decide, so the run it belongs to is still alive. */
export const DECIDABLE_APPROVAL_STATUSES = ['pending', 'approved', 'executing'] as const;

const quote = (values: readonly string[]): string => values.map(value => `'${value}'`).join(', ');

/**
 * SQL predicate: the run row aliased as `alias` is alive and must not be swept.
 *
 * Built for a caller-supplied alias because the three call sites name the table differently (`runs`,
 * `r`); a predicate that only worked for one alias would be a different rule again.
 */
export function runIsAliveSql(alias = 'runs'): string {
  return `(
    (
      ${alias}.status IN (${quote(WORKER_HELD_RUN_STATUSES)})
      AND (${alias}.lease_expires_at IS NULL OR ${alias}.lease_expires_at > NOW())
    )
    OR (
      ${alias}.status = 'waiting_approval'
      AND EXISTS (
        SELECT 1 FROM approvals a
        WHERE a.run_id = ${alias}.id
          AND a.status IN (${quote(DECIDABLE_APPROVAL_STATUSES)})
          AND a.expires_at > NOW()
      )
    )
  )`;
}

/** SQL predicate: the run row aliased as `alias` is one the recovery sweeps are allowed to touch. */
export function runIsRecoverableSql(alias = 'runs'): string {
  return `${alias}.status IN (${quote(RECOVERABLE_RUN_STATUSES)})`;
}
