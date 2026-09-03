-- 013_idempotency_keys.sql
-- Idempotency layer for side-effecting tools (P0 from docs/UPDATE.md).

CREATE TABLE IF NOT EXISTS idempotency_keys (
    key              TEXT PRIMARY KEY,
    task_id          UUID NOT NULL,
    run_id           UUID,
    action_name      TEXT NOT NULL,
    payload_hash     TEXT NOT NULL,
    provider         TEXT,
    remote_id        TEXT,
    outcome          TEXT NOT NULL DEFAULT 'in_flight'
                     CHECK (outcome IN ('in_flight', 'succeeded', 'failed', 'expired')),
    result           JSONB,
    error            TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_idempotency_keys_task ON idempotency_keys(task_id);
CREATE INDEX IF NOT EXISTS idx_idempotency_keys_action_outcome
    ON idempotency_keys(action_name, outcome);
