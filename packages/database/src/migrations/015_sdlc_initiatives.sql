-- 015_sdlc_initiatives.sql
-- Enterprise SDLC Initiatives & Executive Lifecycle Tracking

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

CREATE TABLE IF NOT EXISTS sdlc_initiatives (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title               TEXT NOT NULL,
    intent              TEXT NOT NULL,
    status              TEXT NOT NULL DEFAULT 'active',
    current_phase       TEXT NOT NULL DEFAULT 'inception',
    strategic_brief     JSONB NOT NULL DEFAULT '{}'::jsonb,
    technical_spec      JSONB NOT NULL DEFAULT '{}'::jsonb,
    budget_envelope     JSONB NOT NULL DEFAULT '{}'::jsonb,
    sprint_plan         JSONB NOT NULL DEFAULT '{}'::jsonb,
    qa_report           JSONB NOT NULL DEFAULT '{}'::jsonb,
    parent_task_id      UUID REFERENCES tasks(id) ON DELETE SET NULL,
    artifacts           JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sdlc_initiatives_status
    ON sdlc_initiatives(status);

CREATE INDEX IF NOT EXISTS idx_sdlc_initiatives_current_phase
    ON sdlc_initiatives(current_phase);

CREATE INDEX IF NOT EXISTS idx_sdlc_initiatives_created_at
    ON sdlc_initiatives(created_at DESC);
