-- Durable worker leases for crash recovery and cross-process execution ownership.

ALTER TABLE runs
    ADD COLUMN IF NOT EXISTS worker_id VARCHAR(128),
    ADD COLUMN IF NOT EXISTS heartbeat_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_runs_lease_expiry
    ON runs(status, lease_expires_at);
