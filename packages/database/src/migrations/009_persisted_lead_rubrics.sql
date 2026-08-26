-- Persisted, immutable lead scoring rubric versions with one active version.

CREATE TABLE IF NOT EXISTS lead_rubrics (
    version VARCHAR(128) PRIMARY KEY,
    definition JSONB NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT FALSE,
    created_by VARCHAR(128) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_lead_rubrics_single_active
    ON lead_rubrics (is_active)
    WHERE is_active = TRUE;
