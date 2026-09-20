-- Scheduled jobs for cron-style triggers.
-- Ensure table structure matches the ScheduledJobRepository model,
-- whether migrated from 001 or created fresh.

CREATE TABLE IF NOT EXISTS scheduled_jobs (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    job_type VARCHAR(64) NOT NULL DEFAULT 'cron',
    cron_pattern VARCHAR(64) NOT NULL DEFAULT '* * * * *',
    timezone VARCHAR(64) NOT NULL DEFAULT 'UTC',
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    assigned_agent VARCHAR(64) NOT NULL DEFAULT 'chief',
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    last_run_at TIMESTAMPTZ,
    next_run_at TIMESTAMPTZ,
    last_error TEXT,
    created_by VARCHAR(128) NOT NULL DEFAULT 'system',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Upgrade table in case it was created by legacy 001_initial_schema:
DO $$
BEGIN
    -- Change id column type if UUID
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'scheduled_jobs' AND column_name = 'id' AND data_type = 'uuid'
    ) THEN
        ALTER TABLE scheduled_jobs ALTER COLUMN id TYPE VARCHAR(64) USING id::text;
    END IF;

    -- Add missing columns
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'scheduled_jobs' AND column_name = 'job_type') THEN
        ALTER TABLE scheduled_jobs ADD COLUMN job_type VARCHAR(64) NOT NULL DEFAULT 'cron';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'scheduled_jobs' AND column_name = 'cron_pattern') THEN
        ALTER TABLE scheduled_jobs ADD COLUMN cron_pattern VARCHAR(64);
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'scheduled_jobs' AND column_name = 'cron_expression') THEN
            UPDATE scheduled_jobs SET cron_pattern = cron_expression WHERE cron_pattern IS NULL;
        END IF;
        UPDATE scheduled_jobs SET cron_pattern = '* * * * *' WHERE cron_pattern IS NULL;
        ALTER TABLE scheduled_jobs ALTER COLUMN cron_pattern SET NOT NULL;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'scheduled_jobs' AND column_name = 'timezone') THEN
        ALTER TABLE scheduled_jobs ADD COLUMN timezone VARCHAR(64) NOT NULL DEFAULT 'UTC';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'scheduled_jobs' AND column_name = 'assigned_agent') THEN
        ALTER TABLE scheduled_jobs ADD COLUMN assigned_agent VARCHAR(64);
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'scheduled_jobs' AND column_name = 'agent_id') THEN
            UPDATE scheduled_jobs SET assigned_agent = agent_id WHERE assigned_agent IS NULL;
        END IF;
        UPDATE scheduled_jobs SET assigned_agent = 'chief' WHERE assigned_agent IS NULL;
        ALTER TABLE scheduled_jobs ALTER COLUMN assigned_agent SET NOT NULL;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'scheduled_jobs' AND column_name = 'enabled') THEN
        ALTER TABLE scheduled_jobs ADD COLUMN enabled BOOLEAN;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'scheduled_jobs' AND column_name = 'is_active') THEN
            UPDATE scheduled_jobs SET enabled = is_active WHERE enabled IS NULL;
        END IF;
        UPDATE scheduled_jobs SET enabled = TRUE WHERE enabled IS NULL;
        ALTER TABLE scheduled_jobs ALTER COLUMN enabled SET NOT NULL;
        ALTER TABLE scheduled_jobs ALTER COLUMN enabled SET DEFAULT TRUE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'scheduled_jobs' AND column_name = 'created_by') THEN
        ALTER TABLE scheduled_jobs ADD COLUMN created_by VARCHAR(128) NOT NULL DEFAULT 'system';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'scheduled_jobs' AND column_name = 'last_error') THEN
        ALTER TABLE scheduled_jobs ADD COLUMN last_error TEXT;
    END IF;

    -- Legacy columns from 001_initial_schema.sql:257-258 that ScheduledJobRepository.create
    -- never populates. They were declared NOT NULL, so on a clean host the very first insert
    -- through the repository failed with a not-null / foreign-key violation even though the
    -- migration chain itself now applies. Relax them to nullable; the repository contract is
    -- the column set it actually writes (job_type, cron_pattern, timezone, assigned_agent,
    -- enabled, created_by).
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'scheduled_jobs'
          AND column_name = 'cron_expression' AND is_nullable = 'NO'
    ) THEN
        ALTER TABLE scheduled_jobs ALTER COLUMN cron_expression DROP NOT NULL;
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'scheduled_jobs'
          AND column_name = 'agent_id' AND is_nullable = 'NO'
    ) THEN
        ALTER TABLE scheduled_jobs ALTER COLUMN agent_id DROP NOT NULL;
    END IF;
END $$;

-- Constraints
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_class r ON r.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = r.relnamespace
        WHERE c.conname = 'scheduled_jobs_cron_nonempty' AND n.nspname = current_schema()
    ) THEN
        ALTER TABLE scheduled_jobs ADD CONSTRAINT scheduled_jobs_cron_nonempty CHECK (length(trim(cron_pattern)) > 0);
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_class r ON r.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = r.relnamespace
        WHERE c.conname = 'scheduled_jobs_payload_object' AND n.nspname = current_schema()
    ) THEN
        ALTER TABLE scheduled_jobs ADD CONSTRAINT scheduled_jobs_payload_object CHECK (jsonb_typeof(payload) = 'object');
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS scheduled_jobs_enabled_idx
    ON scheduled_jobs (enabled)
    WHERE enabled = TRUE;
