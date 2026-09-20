-- 017_event_outbox_occurred_at_index.sql
-- Index the outbox on the column its readers actually use.
--
-- 002 created idx_event_outbox_created_at on (created_at), but no query ever filters or sorts by
-- that column. Both readers in event.repository.ts work on occurred_at:
--
--   list()        WHERE occurred_at > $1 ORDER BY occurred_at DESC, event_id DESC
--   listAfterId() WHERE (occurred_at, event_id) > ($1, $2) ORDER BY occurred_at ASC, event_id ASC
--
-- so every event read was a sequential scan plus a sort over an append-only table that grows
-- without bound, and the keyset replay used to catch up after downtime could not use an index for
-- its row comparison. The (occurred_at, event_id) order also matches the replay predicate, which a
-- single-column index cannot serve.
--
-- 002 is already applied on existing databases and migrator.ts records only the version string, so
-- editing it would change nothing there. This is a new migration instead.

CREATE INDEX IF NOT EXISTS idx_event_outbox_occurred_at ON event_outbox(occurred_at, event_id);
