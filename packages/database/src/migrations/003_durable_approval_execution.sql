-- Durable approval execution state.
-- Migration: 003_durable_approval_execution.sql

ALTER TABLE approvals
    ADD COLUMN IF NOT EXISTS execution_token_signature VARCHAR(128),
    ADD COLUMN IF NOT EXISTS token_issued_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS execution_started_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS executed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS execution_result JSONB,
    ADD COLUMN IF NOT EXISTS execution_error TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_approvals_execution_token_signature
    ON approvals(execution_token_signature)
    WHERE execution_token_signature IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_approvals_execution_state
    ON approvals(status, execution_started_at);
