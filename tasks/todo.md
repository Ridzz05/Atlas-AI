# ATLAS AI OS Execution Checklist

## Phase 0 — Stop unsafe production exposure

- [x] Add production startup validation for API auth, encryption key, and external-write defaults.
- [x] Disable/deny external writes unless a real connector and approval service are configured.
- [x] Add API/dashboard owner authentication, strict CORS, and process-local rate limiting.
- [x] Fix artifact path containment and add traversal regression tests.
- [x] Make QA/parser failures and blocked/revision verdicts fail closed.

## Phase 1 — Wire durable runtime

- [x] Create shared runtime bootstrap for DB, repositories, Redis, queue, event bus, provider, tools, and policy services.
- [x] Run migrations and seed/version the five agent definitions at startup.
- [x] Implement BullMQ/Redis queue adapter with idempotent jobs, retries, and graceful shutdown.
- [ ] Persist every plan dependency, message, tool call, artifact metadata, and audit event end-to-end.
- [x] Add PostgreSQL event outbox/pub-sub and dependency-aware readiness checks.

## Checkpoint: Durable core

- [ ] Empty Compose environment boots cleanly (Docker unavailable in current environment).
- [x] API and worker share the runtime queue configuration.
- [ ] Task survives API/worker restart (requires Docker/PostgreSQL/Redis drill).
- [x] DB readiness fails closed when the configured database is unavailable.

## Phase 2 — Enforce orchestration and approval policy

- [x] Validate plans: agent allowlist, max eight steps, unique IDs, dependency references, and no cycles.
- [x] Enforce configured depth, concurrency, child count, per-run timeout, and cancellation paths.
- [ ] Enforce complete per-agent tool allowlists/scopes and global daily budget in runtime execution.
- [x] Implement persisted approval requests, exact payload hash, signature, expiry, owner decision, atomic one-time execution, and resume queueing.
- [ ] Implement durable emergency stop, pause/resume, reject, and revise state across processes.

## Phase 3 — Connect control planes

- [x] Implement Telegram polling transport, allowlist, response delivery, and callback acknowledgement.
- [x] Route Telegram and dashboard approval/task mutations through durable repositories where available.
- [x] Replace dashboard operational sample data with API-backed pages and honest unavailable states.
- [ ] Add authenticated realtime events plus cross-process deduplication/reconnect behavior.

## Checkpoint: User lifecycle

- [x] Telegram `/new` and dashboard task creation enqueue persisted tasks through the shared runtime.
- [x] Dashboard task/status/approval flows work after refresh against the API.
- [ ] Duplicate Telegram updates remain deduplicated across process restart.
- [ ] Emergency stop blocks intake and cancels active runs durably.

## Phase 4 — Make research and memory truthful

- [x] Make research/company tools fail closed when no verified provider is configured.
- [ ] Add real research/enrichment adapters with source, extraction time, confidence, freshness, sensitivity, and unresolved questions.
- [ ] Wire memory search/get/propose tools into agent execution with scope checks.
- [ ] Add freshness/deprecation/deletion jobs and audit canonical-memory changes.
- [ ] Add configurable rubric versions and evidence validation.

## Phase 5 — Release engineering

- [ ] Add lint/format scripts and CI gates for lint, typecheck, test, build, migrations, and Compose config.
- [ ] Add integration/e2e/security tests for restart, approval, emergency stop, budget, prompt injection, and backup restore.
- [x] Align production environment variable names and remove insecure production Compose fallbacks.
- [ ] Persist artifact metadata and verify backup/restore operations.
- [x] Update implementation blueprint and runbook with current phase status and known limitations.

## Current execution checkpoint

Implemented through commit `2b28ec2`: durable runtime, plan validation, fail-closed research, durable approval request/decision/token/claim/finalize/resume, Telegram polling, API-backed dashboard control surfaces, and honest unavailable states for unimplemented dashboard capabilities. Full local gates pass: typecheck 26/26, test 26/26, build 15/15. Docker-backed boot/recovery, real providers/connectors, durable Telegram controls, realtime dashboard events, audit APIs, and CI lint gates remain open.

## Final release checkpoint

- [ ] Clean-environment migration and boot verified.
- [ ] Separate API/worker task execution and restart recovery verified.
- [ ] Telegram and dashboard real-state verification passed.
- [x] Approval execute-once, rejection no-side-effect, and approved resume paths covered by tests.
- [ ] Recovery drill and security checklist passed.
- [ ] Human owner approves enabling any external write connector.
