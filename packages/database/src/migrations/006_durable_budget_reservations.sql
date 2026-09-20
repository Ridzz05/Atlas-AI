-- Durable cross-process budget reservations and cost settlement.

ALTER TABLE budgets
    ADD COLUMN IF NOT EXISTS reserved_usd NUMERIC(10, 4) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS budget_reservations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    agent_id VARCHAR(64) NOT NULL REFERENCES agents(id),
    amount_usd NUMERIC(10, 4) NOT NULL CHECK (amount_usd >= 0),
    global_reset_at TIMESTAMPTZ NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'reserved'
        CHECK (status IN ('reserved', 'committed', 'released')),
    committed_cost_usd NUMERIC(10, 4),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_budget_reservations_status_created
    ON budget_reservations(status, created_at);

CREATE INDEX IF NOT EXISTS idx_budget_reservations_run_id
    ON budget_reservations(run_id);
