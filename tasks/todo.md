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
- [x] Persist every plan dependency, message, tool call, artifact metadata, and audit event end-to-end for the implemented orchestration paths.
- [x] Add PostgreSQL event outbox/pub-sub and dependency-aware readiness checks.

## Checkpoint: Durable core

- [ ] Empty Compose environment boots cleanly (Docker unavailable in current environment).
- [x] API and worker share the runtime queue configuration.
- [ ] Task survives API/worker restart (requires Docker/PostgreSQL/Redis drill).
- [x] DB readiness fails closed when the configured database is unavailable.

## Phase 2 — Enforce orchestration and approval policy

- [x] Validate plans: agent allowlist, max eight steps, unique IDs, dependency references, and no cycles.
- [x] Enforce configured depth, concurrency, child count, per-run timeout, and cancellation paths.
- [x] Enforce complete per-agent tool allowlists/scopes and durable global daily/per-run budget in runtime execution.
- [x] Implement persisted approval requests, exact payload hash, signature, expiry, owner decision, atomic one-time execution, and resume queueing.
- [x] Implement durable emergency stop, pause/resume, reject, and revise state across processes; restart recovery still needs an environment drill.

## Phase 3 — Connect control planes

- [x] Implement Telegram polling transport, allowlist, response delivery, and callback acknowledgement.
- [x] Route Telegram and dashboard approval/task mutations through durable repositories where available.
- [x] Replace dashboard operational sample data with API-backed pages and honest unavailable states.
- [x] Add reconnect replay semantics for authenticated realtime events; the PostgreSQL-backed SSE stream replays durable events after `Last-Event-ID` and preserves the live-event handoff.

## Checkpoint: User lifecycle

- [x] Telegram `/new` and dashboard task creation enqueue persisted tasks through the shared runtime.
- [x] Dashboard task/status/approval flows work after refresh against the API.
- [x] Duplicate Telegram updates remain deduplicated across process restart through PostgreSQL claims.
- [x] Emergency stop blocks intake and cancels active runs durably; cross-restart verification remains open.

## Phase 4 — Make research and memory truthful

- [x] Make research/company tools fail closed when no verified provider is configured.
- [ ] Add real research/enrichment adapters with source, extraction time, confidence, freshness, sensitivity, and unresolved questions.
- [x] Wire memory search/get/propose tools into agent execution with scope checks; agent allowlists intentionally deny propose-write until policy grants it.
- [ ] Add freshness/deprecation/deletion jobs and audit canonical-memory changes.
- [ ] Add configurable rubric versions and evidence validation.

## Phase 5 — Release engineering

- [x] Add a repository lint gate and run it in CI; full formatter enforcement remains a follow-up.
- [ ] Add integration/e2e/security tests for restart, approval, emergency stop, budget, prompt injection, and backup restore.
- [x] Align production environment variable names, remove insecure production Compose fallbacks, and fail closed on incomplete/unsupported model-provider configuration.
- [x] Persist artifact metadata and expose read-only artifact, memory, and audit APIs; backup/restore verification remains open.
- [x] Update implementation blueprint and runbook with current phase status and known limitations.

## Current execution checkpoint

Implemented through commit `844bec5`: durable runtime, plan validation, fail-closed research, validated task filters/pagination, fail-closed DB/queue readiness, request-ID correlation, durable approval request/decision/token/claim/finalize/resume, cross-process run cancellation, Telegram polling with durable update/control state, PostgreSQL event outbox/SSE with reconnect replay, persisted message/tool-call history, scoped MemoryTools, durable global/per-run budget reservation and settlement across planner/specialist/QA/synthesis stages, complete delegation cost reporting, worker leases/heartbeats/stale-run recovery, artifact/audit repositories, memory query API, aggregate cost/budget metrics, read-only governance settings, API-backed dashboard observability pages, explicit provider adapter routing with production configuration validation, and CI lint/build/Compose validation. Full local gates pass: lint 141 files, typecheck 26/26, test 26/26, and build 15/15. Docker-backed boot/recovery, real providers/connectors, backup restore, and full formatter enforcement remain open.

## Final release checkpoint

- [ ] Clean-environment migration and boot verified.
- [ ] Separate API/worker task execution and restart recovery verified.
- [ ] Telegram and dashboard real-state verification passed.
- [x] Approval execute-once, rejection no-side-effect, and approved resume paths covered by tests.
- [ ] Recovery drill and security checklist passed.
- [ ] Human owner approves enabling any external write connector.
