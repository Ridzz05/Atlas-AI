-- Scheduled jobs for cron-style triggers.
-- Each row represents a recurring job that the worker schedules through BullMQ
-- with a stable `repeat: { pattern, tz }` and a jobId derived from the row id.
CREATE TABLE IF NOT EXISTS scheduled_jobs (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    job_type VARCHAR(64) NOT NULL,
    cron_pattern VARCHAR(64) NOT NULL,
    timezone VARCHAR(64) NOT NULL DEFAULT 'UTC',
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    assigned_agent VARCHAR(64) NOT NULL DEFAULT 'chief',
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    last_run_at TIMESTAMPTZ,
    next_run_at TIMESTAMPTZ,
    last_error TEXT,
    created_by VARCHAR(128) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT scheduled_jobs_cron_nonempty CHECK (length(trim(cron_pattern)) > 0),
    CONSTRAINT scheduled_jobs_payload_object CHECK (jsonb_typeof(payload) = 'object')
);

CREATE INDEX IF NOT EXISTS scheduled_jobs_enabled_idx
    ON scheduled_jobs (enabled)
    WHERE enabled = TRUE;
