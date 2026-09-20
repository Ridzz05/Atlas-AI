-- 016_sdlc_phase_tasks.sql
-- Link each SDLC initiative to the task that is currently executing its phase, so the
-- initiative advances as a side effect of that task reaching a terminal state instead of
-- from an unawaited promise inside the API process.
--
-- Without this link there is no way to map a finished task back to the initiative it
-- belongs to, which is why the previous design ran all seven phases in one detached
-- promise (no budget reservation, no run lease, no cancellation, no audit).

ALTER TABLE sdlc_initiatives
    ADD COLUMN IF NOT EXISTS phase_task_id UUID REFERENCES tasks(id) ON DELETE SET NULL;

ALTER TABLE sdlc_initiatives
    ADD COLUMN IF NOT EXISTS phase_attempt INTEGER NOT NULL DEFAULT 0;

-- Reverse lookup used by the worker when a task finishes: task id -> initiative.
CREATE INDEX IF NOT EXISTS idx_sdlc_initiatives_phase_task
    ON sdlc_initiatives(phase_task_id);
