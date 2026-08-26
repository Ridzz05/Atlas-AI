-- Durable cross-process cancellation requests for active runs.
ALTER TABLE runs
    ADD COLUMN IF NOT EXISTS cancel_requested BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE runs
    ADD COLUMN IF NOT EXISTS cancel_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_runs_cancel_requested
    ON runs(status, cancel_requested)
    WHERE cancel_requested = TRUE;
