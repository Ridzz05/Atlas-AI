-- Durable Telegram update deduplication and control state.

CREATE TABLE IF NOT EXISTS telegram_updates (
    update_id BIGINT PRIMARY KEY,
    claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_telegram_updates_claimed_at
    ON telegram_updates(claimed_at);

CREATE TABLE IF NOT EXISTS telegram_control_state (
    id VARCHAR(32) PRIMARY KEY,
    paused BOOLEAN NOT NULL DEFAULT FALSE,
    emergency_stop BOOLEAN NOT NULL DEFAULT FALSE,
    updated_by VARCHAR(128),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO telegram_control_state (id)
VALUES ('singleton')
ON CONFLICT (id) DO NOTHING;
