CREATE TABLE IF NOT EXISTS event_outbox (
    event_id UUID PRIMARY KEY,
    event_type VARCHAR(64) NOT NULL,
    task_id UUID,
    run_id UUID,
    agent_id VARCHAR(64),
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    occurred_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    published_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_event_outbox_created_at ON event_outbox(created_at);
CREATE INDEX IF NOT EXISTS idx_event_outbox_task_id ON event_outbox(task_id);
