-- 015_sdlc_initiatives.sql
-- Enterprise SDLC Initiatives & Executive Lifecycle Tracking

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS sdlc_initiatives (
    id                  UUID PRIMARY KEY DEFAULT COALESCE(uuid_generate_v4(), gen_random_uuid()),
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
