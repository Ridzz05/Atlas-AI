# ATLAS AI OS Execution Checklist

## Phase 0 — Stop unsafe production exposure

- [x] Add production startup validation for API auth, encryption key, and external-write defaults.
- [x] Disable/deny external writes unless a real connector and approval service are configured; all registered external/production side-effect classes fail closed when the enable flag is false or omitted.
- [x] Add API/dashboard owner authentication, strict CORS, and Redis-backed cross-replica rate limiting with fail-closed outage behavior.
- [x] Fix artifact path containment and add traversal regression tests.
- [x] Make QA/parser failures and blocked/revision verdicts fail closed.

## Phase 1 — Wire durable runtime

- [x] Create shared runtime bootstrap for DB, repositories, Redis, queue, event bus, provider, tools, and policy services.
- [x] Run migrations and seed/version the five agent definitions at startup.
- [x] Implement BullMQ/Redis queue adapter with idempotent jobs, retries, and graceful shutdown.
- [x] Recover persisted `queued` tasks at worker startup and on a configurable interval with paginated task/run-id idempotent enqueue; real PostgreSQL/Redis restart verification remains open.
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
- [x] Expose durable pause/resume/emergency-stop actions from the authenticated dashboard API alongside Telegram control.
- [x] Replace dashboard operational sample data with API-backed pages and honest unavailable states.
- [x] Add reconnect replay semantics for authenticated realtime events; the PostgreSQL-backed SSE stream replays durable events after `Last-Event-ID` and preserves the live-event handoff.

## Checkpoint: User lifecycle

- [x] Telegram `/new` and dashboard task creation enqueue persisted tasks through the shared runtime.
- [x] Dashboard task/status/approval flows work after refresh against the API.
- [x] Duplicate Telegram updates remain deduplicated across process restart through PostgreSQL claims.
- [x] Emergency stop blocks intake and cancels active runs durably; cross-restart verification remains open.

## Phase 4 — Make research and memory truthful

- [x] Make research/company tools fail closed when no verified provider is configured.
- [x] Register truthful `web.fetch_safe`/`lead.enrich` boundaries, deterministic `lead.score`, and runtime `policy.verify`; enforce safe URLs and untrusted fetched content.
- [x] Add an opt-in Brave research/enrichment adapter with source, extraction time, confidence, freshness, sensitivity, unresolved questions, bounded safe fetch, and untrusted-content handling.
- [ ] Verify the Brave provider against an approved live API key and a clean environment; keep `RESEARCH_PROVIDER=none` until then.
- [x] Enforce `MemoryItem.expiresAt` at store, retrieval, and `memory.get` boundaries so expired or malformed-expiry facts cannot surface or block a fresh proposal.
- [x] Wire memory search/get/propose tools into agent execution with scope checks; agent allowlists intentionally deny propose-write until policy grants it.
- [x] Add scheduled memory expiry/deprecation/deletion maintenance and audit canonical-memory changes; worker configuration controls interval and deletion grace period.
- [x] Persist versioned rubric definitions, validate thresholds and per-dimension evidence, hydrate the active version at runtime, and expose authenticated agent-service rubric control endpoints.

## Phase 5 — Release engineering

- [x] Add repository lint and Prettier formatting gates and run them in CI.
- [x] Add mandatory dependency audit and signature CI gates; the latest lockfile audit reports zero high/critical findings and registry signatures are verified for 332 packages.
- [ ] Add integration/e2e/security tests for restart, approval, emergency stop, budget, prompt injection, and backup restore.
- [x] Add local provider security regressions and a provider-to-Tool-Gateway vertical test for unsafe URLs, DNS, redirects, response bounds, timeouts, evidence, and untrusted content.
- [x] Align production environment variable names, remove insecure production Compose fallbacks, and fail closed on incomplete/unsupported model-provider configuration.
- [x] Add production Compose healthchecks and healthy-dependency ordering; Docker boot verification remains open.
- [x] Add dependency-aware `/ready` endpoints for worker and Telegram and route Compose healthchecks through them; Docker boot verification remains open.
- [x] Make the Caddy deployment hostname environment-driven; use `localhost` only as a staging fallback.
- [x] Persist artifact metadata and expose read-only artifact, memory, and audit APIs; backup archive validation and transactional restore safeguards are implemented, while a real PostgreSQL restore verification remains open.
- [x] Update implementation blueprint and runbook with current phase status and known limitations.

## Current execution checkpoint

Current release state supersedes the historical implementation inventory below: the latest implementation commit is `a083c83`, with the Brave provider, DNS-pinned safe fetch, runtime wiring, and provider-to-Tool-Gateway tests covered locally. The latest local gates pass format, lint, typecheck 26/26, test 26/26, and build 15/15; Docker-backed recovery and live provider/connector validation remain release criteria.

Follow-up reliability slices `61bb83f`, `bfdbb09`, and `4121b3d` add startup, paginated, periodic, and Compose-smoke verification for persisted queued-task recovery. Commit `60211ed` synchronizes the recovery checkpoint and runbook; `6268918` hardens backup/restore and documents application rollback; commits `e2992df` and `1d00576` preserve provider completion limits and truncation signals; `76837ea` classifies watchdog-triggered provider aborts as `timed_out` without changing user/process cancellation. The local worker regression suite now passes 10 tests; a real cross-process restart/restore drill and alert delivery remain Docker/operations release criteria.

Implemented through commit `76837ea` (repository formatting enforcement, patched dashboard dependencies, and mandatory dependency/signature audit gates; Tool Gateway timeout cancellation with `AbortSignal` propagation; strict fail-closed external-write flag parsing; private/local research-target rejection and IPv4/IPv6 literal blocking; audited rubric mutations and fail-closed audit storage; authenticated rubric control API in `515e350`; persisted rubric repository and runtime hydration in `bcdb1d4`; truthful research/scoring/policy tools in `0c75dd6`; policy hardening in `b691a21`; rubric/evidence contracts in `5ff908d`; configured delegation depth in `880b398`; verified-only memory search in `0658756`; documentation checkpoint in `2f66f5c`, control-plane code in `8e4ddd2`, proxy routing in `fd0d4c3`/`fe74df9`): durable runtime, plan validation, fail-closed research, validated task filters/pagination/resource IDs, fail-closed DB/queue readiness, request-ID correlation, Redis-backed cross-replica rate limiting with fail-closed outage behavior, dependency-aware worker/Telegram readiness, production Compose healthchecks and healthy-dependency ordering, environment-driven Caddy hostname/TLS configuration, PostgreSQL migration advisory locking, durable approval request/decision/token/claim/finalize/resume, cross-process run cancellation, Telegram polling with durable update/control state, authenticated dashboard pause/resume/emergency-stop control, correctly versioned and Caddy-routed dashboard proxy, PostgreSQL event outbox/SSE with reconnect replay, persisted message/tool-call history, scoped MemoryTools with verified-only agent search and expiry enforcement at search and direct lookup boundaries, configured delegation depth enforcement, versioned and persisted lead rubrics with active-version hydration, per-dimension evidence validation, deterministic lead scoring, provider-output evidence contracts, safe web fetch and lead enrichment boundaries with private/local target rejection, runtime policy verification, scheduled expiry/deprecation/deletion maintenance with canonical-memory audit records, durable global/per-run budget reservation and settlement across planner/specialist/QA/synthesis stages, complete delegation cost reporting, worker leases/heartbeats/stale-run recovery, artifact/audit repositories, memory query API, worker recovery telemetry, aggregate cost/budget metrics, durable Telegram `/cost` and `/status` telemetry with fail-closed unavailable states, read-only governance settings, authenticated and audited rubric mutation/read APIs, API-backed dashboard observability pages, explicit provider adapter routing with production configuration validation, strict environment parsing for external writes, Tool Gateway output-schema enforcement, fail-closed handling for all registered external/production side-effect classes, `.dockerignore` protection for build contexts, and CI formatting/lint/build/Compose validation plus Docker boot/readiness/restart/backup-restore/auth smoke automation. The latest full local code gates passed: `pnpm format:check`, dependency audit 0 high/critical, signatures 332/332, lint 153 files, typecheck 26/26, test 26/26, and build 15/15; the policy suite passes 13 tests, the memory suite passes 11 tests, the database suite passes 35 tests, the tools suite passes 30 tests, the runtime suite passes 4 tests, the orchestration suite passes 35 tests, the agent-service suite passes 45 tests, and the worker suite passes 10 tests. A successful remote Docker run and real providers/connectors remain open.

## Final release checkpoint

- [ ] Clean-environment migration and boot verified.
- [ ] Separate API/worker task execution and restart recovery verified.
- [ ] Telegram and dashboard real-state verification passed.
- [x] Approval execute-once, rejection no-side-effect, and approved resume paths covered by tests.
- [ ] Recovery drill and security checklist passed.
- [ ] Human owner approves enabling any external write connector.
