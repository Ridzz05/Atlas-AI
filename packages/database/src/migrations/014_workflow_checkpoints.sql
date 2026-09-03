-- 014_workflow_checkpoints.sql
-- Durable workflow checkpoints and transition history.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS workflow_checkpoints (
    id              UUID PRIMARY KEY DEFAULT COALESCE(uuid_generate_v4(), gen_random_uuid()),
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
