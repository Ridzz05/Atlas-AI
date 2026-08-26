# ATLAS AI OS — Production Readiness Audit & Implementation Plan

## Scope and current verdict

Audit basis: `ATLAS_AI_OS_IMPLEMENTATION.md`, source tree, Docker/operations files, environment key map, test/build commands, and git history as of 26 August 2026.

Current verdict: **the repository now has a durable, typed, testable multi-service MVP, but the production release gate is still open**. Runtime composition, PostgreSQL migrations, BullMQ, Telegram polling and durable control state, API/dashboard control paths, plan validation, durable approval resume, cross-process cancellation, persisted orchestration history, scoped MemoryTools, durable budget accounting, authenticated event replay, and worker lease recovery are implemented. Do not enable external writes or call the stack production-ready until Docker-backed boot/recovery, real research adapters, recovery drills, and an approved outbound connector are verified.

## Evidence snapshot

- Git history now includes the implementation slices through `dfeb6ba`; the original `a6efa4f` “complete” commit was a scaffold checkpoint, not a production proof.
- Direct TypeScript verification: PASS for the changed packages/apps; dashboard production build compiled successfully outside the restricted Windows process sandbox.
- Focused approval/resume verification: PASS (API 4 tests, runner 7 tests, plus queue/worker/Telegram/tool regressions).
- `pnpm lint`: runs a repository source-hygiene gate over 141 source files; formatter enforcement is still not configured. CI now runs lint, typecheck, test, production build, and production Compose config validation.
- Production entrypoints use the shared runtime bootstrap with PostgreSQL, migrations, agent seeding, BullMQ/Redis, and the PostgreSQL event bus; tests may still inject in-memory adapters.
- Telegram polling, durable approval decisions, update claims, pause/emergency control state, and durable active-run cancellation are wired; cross-restart recovery still needs an integration drill.
- Dashboard tasks, approvals, agents, command intake, overview metrics, artifacts, memory, audit, realtime refresh, and read-only environment-backed settings use authenticated APIs. Event reconnect replay is implemented; no sample operational data remains in the dashboard.

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
| Phase 1 — Task engine | Implemented locally | BullMQ/Redis, retries/idempotency, worker shutdown, PostgreSQL events, plans/runs/tasks, queue-backed execution, worker leases/heartbeats, and stale-run recovery are wired. Docker recovery drill remains. |
| Phase 2 — Delegation | Implemented locally | Plan validation, depth guard, fail-closed QA, approval-pending propagation, parent resume, message history, tool-call history, and durable budget reservation/settlement across planner/specialist/QA/synthesis stages are wired. Production drill remains. |
| Phase 3 — Telegram | Mostly implemented | Polling transport, allowlist, response delivery, callbacks, PostgreSQL update deduplication, durable pause/emergency state, and cross-process cancellation are wired. Recovery drills remain. |
| Phase 4 — Memory | Mostly implemented | Database/lexical stores, scoped MemoryTools, and authenticated dashboard query APIs are wired. Freshness jobs and canonical-memory audit remain. |
| Phase 5 — Tools/workflow | Mostly implemented with safe gaps | Tool gateway, output schemas, artifact containment, durable approval request/claim/finalize/resume, and fail-closed unverified research are wired. Real research/enrichment adapters and an outbound connector remain intentionally disabled. |
| Phase 6 — Dashboard | Mostly connected | Tasks, approvals, agents, overview, command intake, artifacts, audit, memory, cost/budget metrics, and read-only governance settings use API loading/error/empty states. Authenticated SSE refresh and durable event replay/reconnect semantics are wired; mutable configuration remains deployment-only. |
| Phase 7 — Hardening | Partially implemented | Auth, CORS, rate limiting, secret checks, readiness, runbook, and a repository lint gate exist. Rate limiting remains process-local; Compose boot, recovery, backup restore, formatter enforcement, and alerting remain. |

## Findings ordered by leverage

### Critical / P0 — block production

1. **Compose boot and recovery are not verified in this environment.** The code paths now construct shared PostgreSQL/BullMQ runtime services, but Docker is unavailable, so empty-DB migration, cross-process execution, restart recovery, and outage readiness remain release blockers.
2. **Telegram active-run recovery is not yet demonstrated.** Update deduplication, pause/emergency control state, and cancellation propagation are persisted, but restart recovery still requires an integration drill.
3. **No real outbound connector is configured.** Approved execution now mints an exact, durable, one-time token and resumes the paused task, but `EXTERNAL_WRITES_ENABLED` must remain false until a real connector, owner decision, and integration tests are approved.
4. **Research is deliberately fail-closed rather than live.** Without an injected verified provider, search/company lookup returns no external facts. A real adapter with source, freshness, confidence, and prompt-injection boundaries is still required for the demo workflow.
5. **Dashboard observability is intentionally read-only for governance.** Authenticated event SSE with replay, read-only artifact/memory/audit APIs, durable aggregate cost/budget metrics, and environment-backed settings are exposed. Mutable settings remain deployment-only by design.
6. **Rate limiting is process-local.** API bearer auth and strict CORS are present, but rate-limit buckets do not coordinate across replicas; Telegram update/control state now uses PostgreSQL.
7. **Operational gates are incomplete.** Lint is now a real CI gate, but there is no verified backup restore drill and Docker boot/recovery remains untested here.

### Required / P1 — make the core system reliable

1. Add a single runtime composition/bootstrap layer shared by API, worker, and Telegram so dependencies are constructed consistently.
2. Run migrations and seed the five agent definitions before readiness. Populate `agents`, persist plans, child dependencies, runs, messages, tool calls, artifacts, approvals, and audit events. Artifact metadata, message history, tool-call records, and audit writes are now wired; cross-restart verification remains.
3. BullMQ/Redis, job idempotency, attempts/backoff, graceful shutdown, durable cancellation, worker lease/heartbeat, and stale-run recovery are implemented; verify them in a restart drill.
4. Add durable event publication/subscription (PostgreSQL outbox plus Redis pub/sub is sufficient for the MVP) and expose an authenticated SSE/WebSocket stream to the dashboard. PostgreSQL outbox/SSE, named event delivery, and `Last-Event-ID` replay are implemented.
5. Enforce global daily/per-run budgets and configured `MAX_DELEGATION_DEPTH`; plan agent IDs, max eight steps, unique IDs, dependency references, and cycles are now validated before execution. Durable reservation/settlement is implemented across all model stages; a separate aggregate per-agent cap is not configured.
6. Enforce agent tool allowlists and data scopes in `ToolRegistry`; validate output with `outputSchema`; persist every call and audit record.
7. Implemented durable approval request/decision/token/claim/finalize/resume flow with exact payload hash and atomic compare-and-set. Keep external writes disabled until a real connector is explicitly configured.

### Required / P2 — restore the user control plane

1. Implement Telegram polling or webhook mode with secret verification, outbound response delivery, callback acknowledgement, persistent update deduplication, durable control state, and dependency injection into the command router. Active-run recovery still needs an environment drill.
2. Route `/new`, `/status`, `/task`, `/stop`, `/pause`, `/resume`, `/emergency_stop`, and approval actions through the same control service as the web UI.
3. Add API authentication suitable for the single-user MVP, strict CORS, rate limits, request IDs, and owner-only mutation checks.
4. Dashboard tasks, approvals, agents, command intake, overview, artifacts, audit, memory, aggregate cost/budget metrics, and governance settings now use authenticated API queries with loading/error/empty states. Event replay/reconnect semantics are implemented; mutable configuration remains deployment-only.

### Required / P3 — make intelligence truthful and useful

1. Implement real `web.search`, `web.fetch_safe`, `company.lookup`, and `lead.enrich` adapters behind explicit provider interfaces, with source URL, extraction timestamp, confidence, and unverified status.
2. Add prompt-injection-safe fetched-content handling and size/network limits.
3. Wire MemoryTools into agent execution. Start with structured/lexical retrieval if necessary, then add pgvector embeddings and freshness/reranking once the persistence path is stable.
4. Add a configurable rubric repository with version history and validate all score dimensions/evidence before artifact export.

### Required / P4 — release and operations gates

1. Add formatter enforcement and extend CI with integration, migration, and Docker Compose recovery checks; CI now runs the repository lint gate, typecheck, unit tests, production build, and Compose configuration validation.
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
- Dashboard task creation, approval, and stop actions call authenticated APIs; the settings view reads authenticated environment-backed governance state.
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

Execution is committed through `dfeb6ba`. The full local gates pass: `pnpm.cmd lint` (141 source files), `pnpm.cmd typecheck` (26/26), `pnpm.cmd test` (26/26), and `pnpm.cmd build` (15/15). Docker is unavailable in this environment, so PostgreSQL/Redis Compose boot, budget/lease behavior against real PostgreSQL, and restart recovery remain unverified.

Implemented: shared DB/queue/runtime bootstrap, transactional agent seeding, BullMQ retries and task-id idempotency, idempotent worker shutdown, PostgreSQL event outbox with `LISTEN/NOTIFY` and authenticated SSE/replay, production API auth/CORS/rate limiting, artifact containment and metadata persistence, plan validation, fail-closed approval/QA paths, durable approval request/decision/token/claim/finalize/resume, cross-process run cancellation, Telegram polling with durable update/control state, persisted message/tool-call history, scoped MemoryTools, durable global/per-run budget reservation and settlement for planner/specialist/QA/synthesis stages, complete delegation cost reporting, worker lease/heartbeat and stale-run recovery, audit/memory metadata APIs, aggregate cost/budget metrics, read-only governance settings, API-backed dashboard observability pages, and the CI lint/build/Compose gates.

Remaining release blockers: no approved outbound connector, no verified real research adapters, no Docker boot/recovery/backup drill, formatter enforcement, production recovery/lease observability, and a configured per-agent aggregate budget policy if required by the owner.

## Release gate

Do not call the system production-ready until all P0/P1 acceptance criteria pass in a clean environment and the following are demonstrated: migration from empty DB, task execution across service restart, Telegram create/status flow, approval execute-once, emergency stop, dashboard refresh consistency, backup restore, and security regression suite.
