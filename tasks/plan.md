# ATLAS AI OS — Production Readiness Audit & Implementation Plan

## Scope and current verdict

Audit basis: `ATLAS_AI_OS_IMPLEMENTATION.md`, source tree, Docker/operations files, environment key map, test/build commands, and git history as of 26 August 2026.

Current verdict: **the repository now has a durable, typed, testable multi-service MVP, but the production release gate is still open**. Runtime composition, PostgreSQL migrations, BullMQ, Telegram polling and durable control state, API/dashboard control paths, plan validation, and durable approval resume are implemented. Do not enable external writes or call the stack production-ready until Docker-backed boot/recovery, real research adapters, active-run recovery, and an approved outbound connector are verified.

## Evidence snapshot

- Git history now includes the implementation slices through `9962053`; the original `a6efa4f` “complete” commit was a scaffold checkpoint, not a production proof.
- Direct TypeScript verification: PASS for the changed packages/apps; dashboard production build compiled successfully outside the restricted Windows process sandbox.
- Focused approval/resume verification: PASS (API 4 tests, runner 7 tests, plus queue/worker/Telegram/tool regressions).
- `pnpm lint`: exits 0 but executes **zero tasks**; no workspace package defines a real lint/format script. CI now runs typecheck, test, production build, and production Compose config validation.
- Production entrypoints use the shared runtime bootstrap with PostgreSQL, migrations, agent seeding, BullMQ/Redis, and the PostgreSQL event bus; tests may still inject in-memory adapters.
- Telegram polling, durable approval decisions, update claims, and pause/emergency control state are wired; active-run cancellation and cross-restart recovery still need an integration drill.
- Dashboard tasks, approvals, agents, command intake, overview metrics, artifacts, memory, audit, and realtime refresh use authenticated APIs. Event reconnect replay and settings APIs remain open; no sample operational data remains in the dashboard.

## Target architecture and dependency order

```text
Telegram/Web UI
      │ authenticated command gateway
      ▼
Agent service ── PostgreSQL (state, approvals, audit, artifacts metadata)
      │                    ▲
      └── Redis/BullMQ ── Worker ── Provider + Tool Gateway
                                      │
                                      └── durable events ── Dashboard realtime
```

Foundation must be wired before transport and UI. Approval and emergency-stop controls must be durable and independent of the model provider.

## Phase status against the blueprint

| Blueprint phase | Status | Evidence / gap |
|---|---|---|
| Phase 0 — Foundation | Implemented locally | Shared runtime, migrations, agent seeding, auth/CORS, environment validation, and readiness checks are wired. Clean Compose boot is still unverified because Docker is unavailable here. |
| Phase 1 — Task engine | Implemented locally | BullMQ/Redis, retries/idempotency, worker shutdown, PostgreSQL events, plans/runs/tasks, and queue-backed execution are wired. Lease recovery/global budget enforcement still need production drills. |
| Phase 2 — Delegation | Mostly implemented | Plan validation, depth guard, fail-closed QA, approval-pending propagation, and parent resume are wired. Full persisted dependency/tool-call/audit history remains incomplete. |
| Phase 3 — Telegram | Mostly implemented | Polling transport, allowlist, response delivery, callbacks, PostgreSQL update deduplication, and durable pause/emergency control state are wired. Active-run cancellation and recovery drills remain. |
| Phase 4 — Memory | Incomplete | Database/lexical memory stores and authenticated dashboard query APIs exist, but MemoryTools agent wiring, freshness jobs, and canonical-memory audit are incomplete. |
| Phase 5 — Tools/workflow | Mostly implemented with safe gaps | Tool gateway, output schemas, artifact containment, durable approval request/claim/finalize/resume, and fail-closed unverified research are wired. Real research/enrichment adapters and an outbound connector remain intentionally disabled. |
| Phase 6 — Dashboard | Mostly connected | Tasks, approvals, agents, overview, command intake, artifacts, audit, and memory use API loading/error/empty states. Authenticated SSE refresh is wired; event replay/reconnect semantics and settings APIs remain. |
| Phase 7 — Hardening | Partially implemented | Auth, CORS, rate limiting, secret checks, readiness, and runbook exist. Rate limiting remains process-local; Compose boot, recovery, backup restore, alerting, and CI lint gates remain. |

## Findings ordered by leverage

### Critical / P0 — block production

1. **Compose boot and recovery are not verified in this environment.** The code paths now construct shared PostgreSQL/BullMQ runtime services, but Docker is unavailable, so empty-DB migration, cross-process execution, restart recovery, and outage readiness remain release blockers.
2. **Telegram active-run control is not fully durable.** Update deduplication and pause/emergency control state are persisted, but active-run cancellation propagation and restart recovery still require an integration drill.
3. **No real outbound connector is configured.** Approved execution now mints an exact, durable, one-time token and resumes the paused task, but `EXTERNAL_WRITES_ENABLED` must remain false until a real connector, owner decision, and integration tests are approved.
4. **Research is deliberately fail-closed rather than live.** Without an injected verified provider, search/company lookup returns no external facts. A real adapter with source, freshness, confidence, and prompt-injection boundaries is still required for the demo workflow.
5. **Dashboard observability is incomplete.** Authenticated event SSE and read-only artifact/memory/audit APIs are exposed, but reconnect replay, aggregate cost views, and settings APIs are not complete.
6. **Rate limiting is process-local.** API bearer auth and strict CORS are present, but rate-limit buckets do not coordinate across replicas; Telegram update/control state now uses PostgreSQL.
7. **Operational gates are incomplete.** There are no configured lint tasks, and no verified backup restore drill; CI now validates the production Compose shape and build.

### Required / P1 — make the core system reliable

1. Add a single runtime composition/bootstrap layer shared by API, worker, and Telegram so dependencies are constructed consistently.
2. Run migrations and seed the five agent definitions before readiness. Populate `agents`, persist plans, child dependencies, runs, messages, tool calls, artifacts, approvals, and audit events. Artifact metadata and successful tool-call audit writes are now wired; plans/messages/tool-call records remain.
3. BullMQ/Redis, job idempotency, attempts/backoff, and graceful shutdown are implemented. Add lease/heartbeat observability, stale-run recovery, and durable cancellation propagation.
4. Add durable event publication/subscription (PostgreSQL outbox plus Redis pub/sub is sufficient for the MVP) and expose an authenticated SSE/WebSocket stream to the dashboard. The PostgreSQL outbox/SSE path is now implemented; replay semantics remain.
5. Enforce global daily/per-run/agent budgets and configured `MAX_DELEGATION_DEPTH`; plan agent IDs, max eight steps, unique IDs, dependency references, and cycles are now validated before execution. Persisted budget accounting remains a release follow-up.
6. Enforce agent tool allowlists and data scopes in `ToolRegistry`; validate output with `outputSchema`; persist every call and audit record.
7. Implemented durable approval request/decision/token/claim/finalize/resume flow with exact payload hash and atomic compare-and-set. Keep external writes disabled until a real connector is explicitly configured.

### Required / P2 — restore the user control plane

1. Implement Telegram polling or webhook mode with secret verification, outbound response delivery, callback acknowledgement, persistent update deduplication, durable control state, and dependency injection into the command router. Active-run cancellation/recovery remains.
2. Route `/new`, `/status`, `/task`, `/stop`, `/pause`, `/resume`, `/emergency_stop`, and approval actions through the same control service as the web UI.
3. Add API authentication suitable for the single-user MVP, strict CORS, rate limits, request IDs, and owner-only mutation checks.
4. Dashboard tasks, approvals, agents, command intake, overview, artifacts, audit, and memory now use authenticated API queries with loading/error/empty states. Add event replay/reconnect semantics and the remaining settings API.

### Required / P3 — make intelligence truthful and useful

1. Implement real `web.search`, `web.fetch_safe`, `company.lookup`, and `lead.enrich` adapters behind explicit provider interfaces, with source URL, extraction timestamp, confidence, and unverified status.
2. Add prompt-injection-safe fetched-content handling and size/network limits.
3. Wire MemoryTools into agent execution. Start with structured/lexical retrieval if necessary, then add pgvector embeddings and freshness/reranking once the persistence path is stable.
4. Add a configurable rubric repository with version history and validate all score dimensions/evidence before artifact export.

### Required / P4 — release and operations gates

1. Add actual lint/format scripts and extend CI with integration, migration, and Docker Compose recovery checks; CI now runs typecheck, unit tests, production build, and Compose configuration validation.
2. Add integration/e2e tests for DB+Redis, restart recovery, duplicate Telegram updates, approval execute-once, rejected approval no-side-effect, malicious content, budget exhaustion, and emergency stop.
3. Production Compose now passes the application’s `MODEL_PROVIDER`/`MODEL_API_KEY` names and requires database, Redis, API, Telegram, and encryption secrets. Verify the clean-environment secret policy in CI and remove any remaining non-production defaults before launch.
4. Mount/persist artifact storage, add backup verification and restore drills, health checks for DB/Redis/worker/Telegram, alerting, retention policy, and rollback instructions.
5. Update blueprint status from “Draft siap implementasi” only after the corresponding exit criteria are demonstrated; record phase completion reports with commands and results.

## Suggested implementation slices

### Slice 1 — Runtime foundation

**Files likely touched:** database bootstrap/seed, app entrypoints, orchestration queue adapter, compose, env schema, tests.

**Acceptance criteria:**

- Clean Compose boot runs migrations and seeds five agents exactly once.
- API, worker, and Telegram use the same DB/Redis-backed services.
- Creating a task through the API enqueues one durable job visible to the worker.
- Stopping/restarting the worker does not lose a queued task.
- `/ready` returns non-ready when required dependencies are unavailable.

### Slice 2 — Durable orchestration and audit

**Acceptance criteria:**

- Parent/child tasks, plans, dependencies, runs, messages, tool calls, and audit events survive restart.
- Job retries are bounded and idempotent; stale active runs are recovered or failed explicitly.
- Parent status reflects child failure, cancellation, QA revision, and completion correctly.
- Budget, depth, step-count, dependency-cycle, and concurrency limits are enforced by code.

### Slice 3 — Approval and security gate

**Acceptance criteria:**

- No external write executes without a valid owner-approved token bound to exact action and payload.
- The same approval cannot execute twice, even across worker processes.
- Payload changes, expiry, wrong action, wrong task, wrong user, or invalid signature are rejected.
- Emergency stop cancels active runs, blocks new intake, and is recorded durably without LLM involvement.
- API/dashboard/Telegram mutations require owner authentication and are rate-limited.

### Slice 4 — Real Telegram and dashboard

**Acceptance criteria:**

- A Telegram message creates a persisted task and the user receives persisted status updates.
- Dashboard task creation, approval, stop, and settings actions call authenticated APIs.
- All displayed task/agent/approval/audit/cost values come from backend state or real events; no sample data remains in production builds.
- Refreshing or reconnecting yields the same state as the backend.

### Slice 5 — Real research and lead workflow

**Acceptance criteria:**

- Demo workflow produces source-backed findings, freshness/confidence metadata, score evidence, and artifacts.
- Unverified/fabricated data cannot be promoted to canonical fact or presented as verified.
- Outreach remains draft-only while external writes are disabled.
- Argus parse/provider failure blocks final completion instead of passing.

## Open decisions before external writes

- Which official channel/integration will implement outbound messaging (WhatsApp Business, email provider, or another approved connector)?
- Which authentication mechanism will protect the single-user dashboard/API (reverse-proxy identity, signed session, or another owner-only mechanism)?
- Which model provider and model are approved for production, and what are the exact per-token budget rates?
- Should the first release use polling or webhook mode for Telegram?

## Implementation checkpoint — 26 August 2026

Execution is committed through `9962053`. The full local gates pass: `pnpm.cmd typecheck` (26/26), `pnpm.cmd test` (26/26), and `pnpm.cmd build` (15/15). Docker is unavailable in this environment, so PostgreSQL/Redis Compose boot and restart recovery remain unverified.

Implemented: shared DB/queue/runtime bootstrap, transactional agent seeding, BullMQ retries and task-id idempotency, idempotent worker shutdown, PostgreSQL event outbox with `LISTEN/NOTIFY` and authenticated SSE, production API auth/CORS/rate limiting, artifact containment and metadata persistence, plan validation, fail-closed approval/QA paths, durable approval request/decision/token/claim/finalize/resume, Telegram polling with durable update/control state, audit/memory metadata APIs, and API-backed dashboard observability pages.

Remaining release blockers: no approved outbound connector, no verified real research adapters, active-run cancellation/recovery drills, full plan/message/tool-call persistence, event replay semantics, no Docker boot/recovery/backup drill, and no configured lint/CI gate.

## Release gate

Do not call the system production-ready until all P0/P1 acceptance criteria pass in a clean environment and the following are demonstrated: migration from empty DB, task execution across service restart, Telegram create/status flow, approval execute-once, emergency stop, dashboard refresh consistency, backup restore, and security regression suite.
