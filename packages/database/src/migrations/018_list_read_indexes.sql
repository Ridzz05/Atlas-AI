-- 018_list_read_indexes.sql
-- Give the list reads an index on the column they sort by.
--
-- Four tables are read as a list — newest-first or oldest-first — and sorted on a timestamp column
-- that no index covers, so each read was a sequential scan plus a sort over a table that only grows:
--
--   messages       ORDER BY created_at ASC|DESC, id ASC|DESC   (001 indexed task_id and run_id only)
--   tool_calls     ORDER BY created_at ASC|DESC, id ASC|DESC   (001 indexed task_id and run_id only)
--   audit_events   ORDER BY timestamp  DESC, id DESC           (001 indexed actor, action, task_id)
--
-- `messages` and `tool_calls` are the two sources behind the dashboard's communications feed, which
-- asks for 100 rows on every page load and every stream event, so this is the hottest list read in the
-- system. `audit_events` is the default read of GET /api/v1/audit and is never pruned.
--
-- `id` is the second column because both readers break ties on it: several rows can share a
-- millisecond, and without the tiebreaker the window boundary is not deterministic. A DESC index
-- serves an ASC scan as well (Postgres reads it backwards), so one index per table covers both
-- directions.
--
-- These are new migrations rather than edits to 001: it is already applied on existing databases and
-- migrator.ts records only the version string, so editing it would change nothing there.

CREATE INDEX IF NOT EXISTS idx_messages_created_at_id ON messages (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_tool_calls_created_at_id ON tool_calls (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_timestamp_id ON audit_events (timestamp DESC, id DESC);
