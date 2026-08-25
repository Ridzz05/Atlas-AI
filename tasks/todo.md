# ATLAS AI OS Execution Checklist

## Phase 0 — Stop unsafe production exposure

- [ ] Add production startup validation for required secrets, owner identity, model provider, and external-write flag.
- [ ] Disable/deny external writes unless a real connector and approval service are configured.
- [ ] Add API/dashboard owner authentication, strict CORS, and rate limiting.
- [ ] Fix artifact path containment and add traversal regression tests.
- [ ] Make QA/parser failures and blocked/revision verdicts fail closed.

## Phase 1 — Wire durable runtime

- [ ] Create shared runtime bootstrap for DB, repositories, Redis, queue, event bus, provider, tools, and policy services.
- [ ] Run migrations at startup and seed/version the five agent definitions.
- [ ] Implement BullMQ/Redis queue adapter with idempotent jobs, retries, leases, heartbeat, and graceful shutdown.
- [ ] Persist plans, task dependencies, messages, runs, tool calls, artifacts, approvals, and audit events.
- [ ] Add durable event outbox/pub-sub and dependency-aware readiness checks.

## Checkpoint: Durable core

- [ ] Empty Compose environment boots cleanly.
- [ ] API-created task is processed by a separate worker.
- [ ] Task survives API/worker restart.
- [ ] DB and Redis outage causes readiness failure and no false success.

## Phase 2 — Enforce orchestration and approval policy

- [ ] Validate plans: agent allowlist, max eight steps, unique IDs, dependency references, no cycles.
- [ ] Enforce configured depth, concurrency, child count, per-run/agent/global budget, timeout, and cancellation.
- [ ] Enforce per-agent tool allowlists/scopes and validate tool outputs with `outputSchema`.
- [ ] Implement persisted approval service with exact payload hash, signature, expiry, owner, atomic one-time execution, and idempotency.
- [ ] Implement durable emergency stop, pause/resume, reject, and revise semantics.

## Phase 3 — Connect control planes

- [ ] Implement Telegram polling/webhook transport, secret validation, response delivery, callback acknowledgement, and persistent deduplication.
- [ ] Route Telegram and dashboard mutations through one authenticated command/control service.
- [ ] Replace dashboard sample data with backend API calls and realtime events.
- [ ] Add loading, empty, error, reconnect, and authorization states.

## Checkpoint: User lifecycle

- [ ] Telegram `/new` → persisted task → worker execution → status update works.
- [ ] Dashboard create/status/stop/approval actions work after refresh.
- [ ] Duplicate Telegram update cannot duplicate task or side effect.
- [ ] Emergency stop blocks intake and cancels active runs.

## Phase 4 — Make research and memory truthful

- [ ] Replace mock research/company tools with real adapters and safe fetched-content boundaries.
- [ ] Persist source, extraction time, confidence, freshness, sensitivity, and unresolved questions.
- [ ] Wire memory search/get/propose tools into agent execution with scope checks.
- [ ] Add freshness/deprecation/deletion jobs and audit all canonical-memory changes.
- [ ] Add configurable rubric versions and evidence validation.

## Phase 5 — Release engineering

- [ ] Add lint/format scripts and CI gates for lint, typecheck, test, build, migrations, and Compose config.
- [ ] Add integration/e2e/security tests for restart, approval, emergency stop, budget, prompt injection, and backup restore.
- [ ] Align production environment variable names and remove insecure Compose fallbacks.
- [ ] Persist artifact storage and verify backup/restore operations.
- [ ] Update implementation blueprint and runbook with actual phase completion reports and known limitations.

## Current execution checkpoint

Completed in the current pass: durable runtime composition, startup migrations and agent seeding, BullMQ production queue, PostgreSQL event outbox, API bearer auth and strict CORS, artifact path hardening, fail-closed QA and approval verification, durable approval decisions, Telegram polling/delivery, and live dashboard task/approval pages. Remaining checkboxes retain the broader release requirements.

## Final release checkpoint

- [ ] Clean-environment migration and boot verified.
- [ ] Separate API/worker task execution verified.
- [ ] Telegram and dashboard real-state verification passed.
- [ ] Approval execute-once and no-side-effect rejection passed.
- [ ] Recovery drill and security checklist passed.
- [ ] Human owner approves enabling any external write connector.
