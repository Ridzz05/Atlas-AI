-- 014_workflow_checkpoints.sql
-- Durable workflow checkpoints and transition history.

DO $$
BEGIN
    CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
EXCEPTION WHEN OTHERS THEN
    -- Optional contrib extension. The schema does not depend on it: every uuid default uses
    -- gen_random_uuid(), which is core since PostgreSQL 13. Creating it here is a convenience for
    -- operators, and an unguarded CREATE EXTENSION aborts the whole migration chain on a host
    -- without contrib or without extension rights — migrator.ts rethrows, so every later file
    -- never applies and the database is left half-built while the process still boots.
    NULL;
END $$;

CREATE TABLE IF NOT EXISTS workflow_checkpoints (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id          UUID NOT NULL,
    task_id         UUID NOT NULL,
    agent_id        TEXT NOT NULL,
    step_id         TEXT NOT NULL,
    state           TEXT NOT NULL,
    resume_after    TIMESTAMPTZ,
    payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
    history         JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_workflow_checkpoints_run_step
    ON workflow_checkpoints(run_id, step_id);

CREATE INDEX IF NOT EXISTS idx_workflow_checkpoints_state
    ON workflow_checkpoints(state);
CREATE INDEX IF NOT EXISTS idx_workflow_checkpoints_resume_after
    ON workflow_checkpoints(resume_after)
    WHERE state IN ('scheduled', 'paused', 'waiting_external_event');
