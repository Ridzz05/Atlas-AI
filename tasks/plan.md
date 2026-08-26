# ATLAS AI OS — Production Readiness Audit & Implementation Plan

## Scope and current verdict

Audit basis: `ATLAS_AI_OS_IMPLEMENTATION.md`, source tree, Docker/operations files, environment key map, test/build commands, and git history as of 26 August 2026.

Current verdict: **the repository now has a durable, typed, testable multi-service MVP, but the production release gate is still open**. Runtime composition, PostgreSQL migrations, BullMQ, Telegram polling and durable control state, authenticated API/dashboard pause-resume-emergency-stop controls, plan validation, durable approval resume, cross-process cancellation, persisted orchestration history, scoped MemoryTools, versioned/persisted lead rubrics with active-version hydration, scheduled memory expiry/deprecation cleanup with audit records, durable budget accounting, authenticated event replay, worker lease recovery, and an opt-in source-aware research adapter are implemented. Do not enable external writes or call the stack production-ready until Docker-backed boot/recovery, live research verification, recovery drills, and an approved outbound connector are verified.

## Evidence snapshot

- Git history now includes the implementation slices through `53f771f`; the original `a6efa4f` “complete” commit was a scaffold checkpoint, not a production proof.
- Direct TypeScript verification: PASS for the changed packages/apps; dashboard production build compiled successfully outside the restricted Windows process sandbox.
- Focused approval/resume verification: PASS (API 4 tests, runner 7 tests, plus queue/worker/Telegram/tool regressions). API input validation, queue readiness, and request-ID correlation regressions also pass.
- `pnpm lint`: runs a repository source-hygiene gate over 158 files, and `pnpm format:check` enforces Prettier 3.9.6 formatting. CI now runs formatting, dependency and signature audits, lint, typecheck, test, production build, Compose config validation, and a Docker Compose boot/readiness/restart/backup-restore/auth smoke job; the remote job still needs to execute successfully. The latest audit reports zero high/critical vulnerabilities and registry signatures are verified for 332 packages.
- Production entrypoints use the shared runtime bootstrap with PostgreSQL, migrations, agent seeding, BullMQ/Redis, and the PostgreSQL event bus; tests may still inject in-memory adapters.
- Telegram polling, durable approval decisions, update claims, pause/emergency control state, and durable active-run cancellation are wired; cross-restart recovery still needs an integration drill.
- Dashboard tasks, approvals, agents, command intake, durable communications history, overview metrics, artifacts, memory, audit, recovery telemetry, realtime refresh, durable pause/resume/emergency-stop controls, and read-only environment-backed settings use authenticated APIs. The Communications feed combines durable messages and tool-call metadata, while Tasks and Communications refresh on authenticated SSE events and omit raw tool payloads. The `/api/atlas/*` server proxy is routed through Caddy to the dashboard before direct API paths, preserving the server-side bearer token. Agent memory search is verified-only; proposal records remain hidden until verification. Event reconnect replay is implemented; no sample operational data remains in the dashboard.
- The opt-in Brave research adapter now supplies source-aware search, company lookup, lead enrichment, and bounded untrusted web fetch through the worker; live API verification remains pending.

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
| Phase 0 — Foundation | Implemented locally | Shared runtime, migrations, agent seeding, auth/CORS, environment validation, and DB/queue readiness checks are wired. Clean Compose boot is still unverified because Docker is unavailable here. |
| Phase 1 — Task engine | Implemented locally | BullMQ/Redis, retries/idempotency, worker shutdown, PostgreSQL events, plans/runs/tasks, queue-backed execution, worker leases/heartbeats, and stale-run recovery are wired. Docker recovery drill remains. |
| Phase 2 — Delegation | Implemented locally | Plan validation, depth guard, fail-closed QA, approval-pending propagation, parent resume, task lifecycle events, message history, tool-call history, valid task-status enforcement, and durable budget reservation/settlement across planner/specialist/QA/synthesis stages are wired. Production drill remains. |
| Phase 3 — Telegram | Mostly implemented | Polling transport, allowlist, response delivery, callbacks, PostgreSQL update deduplication, durable pause/emergency state, and cross-process cancellation are wired. Recovery drills remain. |
| Phase 4 — Memory | Mostly implemented | Database/lexical stores, scoped verified-only MemoryTools, expiry enforcement, authenticated dashboard query APIs, scheduled deprecation/deletion maintenance, canonical-memory audit records, versioned lead rubric/evidence validation, persisted active-rubric hydration, and source-aware research inputs are wired. Live provider and PostgreSQL recovery execution remain. |
| Phase 5 — Tools/workflow | Mostly implemented with safe gaps | Tool gateway, output schemas, artifact containment, durable approval request/claim/finalize/resume, fail-closed unverified research, provider-output evidence contracts, and an opt-in Brave search/safe-fetch adapter are wired. Live provider verification and an outbound connector remain disabled. |
| Phase 6 — Dashboard | Mostly connected | Tasks, approvals, agents, overview, command intake, durable communications feed, artifacts, audit, memory, cost/budget metrics, durable pause/resume/emergency-stop controls, and read-only governance settings use API loading/error/empty states. Tasks and Communications use authenticated SSE refresh, with durable event replay/reconnect semantics and no raw tool payload rendering. Rubric mutations use the authenticated agent-service API while dashboard governance settings remain read-only. |
| Phase 7 — Hardening | Partially implemented | Auth, CORS, Redis-backed rate limiting with fail-closed outage behavior, secret checks, fail-closed DB/queue readiness, request-ID correlation, dependency-aware worker/Telegram readiness, Compose service healthchecks, patched dashboard dependencies, high-severity dependency audit, runbook, repository lint gate, and Prettier formatting gate exist. Compose boot, recovery, backup restore, and alerting remain. |

## Findings ordered by leverage

### Critical / P0 — block production

1. **Compose boot and recovery are not verified in this environment.** The code paths now construct shared PostgreSQL/BullMQ runtime services and CI automates boot/readiness/restart/backup checks, but Docker is unavailable, so a successful run, cross-process execution, restart recovery, and outage readiness remain release blockers.
2. **Telegram active-run recovery is not yet demonstrated.** Update deduplication, pause/emergency control state, and cancellation propagation are persisted, but restart recovery still requires an integration drill.
3. **No real outbound connector is configured.** Approved execution now mints an exact, durable, one-time token and resumes the paused task, but `EXTERNAL_WRITES_ENABLED` must remain false until a real connector, owner decision, and integration tests are approved.
4. **Research is implemented but deliberately opt-in and not live-verified here.** `98ea6f6` and `a083c83` add a Brave adapter with source, freshness, confidence, sensitivity, unresolved-question evidence, public-DNS/redirect/size/timeout controls, DNS-pinned transport, and an untrusted-content boundary. A clean environment with an approved API key must still verify provider behavior and operations.
5. **Task state and communication history are now durable at the local implementation boundary.** `0d25fb7` and `6279440` map watchdog timeout outcomes to the valid `failed` task state, publish lifecycle events for task creation/update/completion/failure, and enforce the database status constraint. `bac3083` records API/Telegram intake messages and exposes a durable dashboard feed for messages/tool-call metadata; `53f771f` adds live task-list refresh. Docker-backed restart proof remains open.
5. **Dashboard governance is only partially mutable.** Authenticated event SSE with replay, read-only artifact/memory/audit APIs, durable aggregate cost/budget metrics, environment-backed settings, persisted active-rubric loading, authenticated agent-service rubric version controls, and durable pause/resume/emergency-stop actions are exposed. The dashboard UI remains read-only for rubric governance; mutations go through the authenticated API.
6. **Operational gates are incomplete.** Lint is now a real CI gate and CI automation now covers Compose boot/readiness and backup restore, but no successful Docker run has been observed here and alerting/retention/rollback remain.

### Required / P1 — make the core system reliable

1. Add a single runtime composition/bootstrap layer shared by API, worker, and Telegram so dependencies are constructed consistently.
2. Run migrations and seed the five agent definitions before readiness. Populate `agents`, persist plans, child dependencies, runs, messages, tool calls, artifacts, approvals, and audit events. Artifact metadata, message history, tool-call records, and audit writes are now wired; cross-restart verification remains.
3. BullMQ/Redis, job idempotency, attempts/backoff, graceful shutdown, durable cancellation, worker lease/heartbeat, and stale-run recovery are implemented; verify them in a restart drill.
4. Add durable event publication/subscription (PostgreSQL outbox plus Redis pub/sub is sufficient for the MVP) and expose an authenticated SSE stream to the dashboard. PostgreSQL outbox/SSE, named event delivery, and `Last-Event-ID` replay are implemented.
5. Enforce global daily/per-run budgets and configured `MAX_DELEGATION_DEPTH`; plan agent IDs, max eight steps, unique IDs, dependency references, and cycles are now validated before execution. Durable reservation/settlement is implemented across all model stages; a separate aggregate per-agent cap is not configured.
6. Enforce agent tool allowlists and data scopes in `ToolRegistry`; validate output with `outputSchema`; persist every call and audit record.
7. Implemented durable approval request/decision/token/claim/finalize/resume flow with exact payload hash and atomic compare-and-set. Keep external writes disabled until a real connector is explicitly configured.
8. Worker startup and periodic recovery now scan persisted `queued` tasks in pages and re-enqueue them with the BullMQ task/run idempotency key, closing the API/Redis enqueue interruption window; verify this against real PostgreSQL/Redis during the restart drill.

### Required / P2 — restore the user control plane

1. Implement Telegram polling or webhook mode with secret verification, outbound response delivery, callback acknowledgement, persistent update deduplication, durable control state, and dependency injection into the command router. Active-run recovery still needs an environment drill.
2. Route `/new`, `/status`, `/task`, `/stop`, `/pause`, `/resume`, `/emergency_stop`, and approval actions through shared durable repositories/control state; the dashboard uses authenticated API routes and Telegram uses the injected command router.
3. API authentication suitable for the single-user MVP, strict CORS, Redis-backed cross-replica rate limits, request IDs, and owner-only mutation checks are implemented. Redis rate-limit failures fail closed with HTTP 503.
4. Dashboard tasks, approvals, agents, command intake, overview, artifacts, audit, memory, aggregate cost/budget metrics, governance settings, and durable pause/resume/emergency-stop actions now use authenticated API queries with loading/error/empty states. Event replay/reconnect semantics are implemented; rubric mutations use the authenticated agent-service API while dashboard governance settings remain read-only.

### Required / P3 — make intelligence truthful and useful

1. Implemented an opt-in Brave adapter for `web.search`, `web.fetch_safe`, `company.lookup`, and `lead.enrich`, with source URL, extraction timestamp, confidence, freshness, sensitivity, unresolved questions, and unverified status. Verify it with an approved live API key before release.
2. Add prompt-injection-safe fetched-content handling and size/network limits. The tool boundary and `SafeWebFetcher` now reject credential-bearing/local targets, validate public DNS and redirects, pin the first validated address into the Node HTTP(S) transport, bound response size, and enforce timeouts; gateway cancellation propagates an `AbortSignal`. Live HTTPS behavior and clean-host verification remain release checks.
3. Wire MemoryTools into agent execution. Start with structured/lexical retrieval if necessary, then add pgvector embeddings and freshness/reranking once the persistence path is stable.
4. Persist a configurable rubric repository with immutable version history and validate all score dimensions/evidence before artifact export. The repository, active-version runtime hydration, and authenticated agent-service create/activate API are implemented.

### Required / P4 — release and operations gates

1. Extend CI with integration, migration, and Docker Compose recovery checks; CI now runs formatting, dependency audit, the repository lint gate, typecheck, unit tests, production build, Compose configuration validation, and the Compose smoke/backup-restore/restart/auth job (first successful remote run pending).
2. Add integration/e2e tests for DB+Redis, restart recovery, duplicate Telegram updates, approval execute-once, rejected approval no-side-effect, malicious content, budget exhaustion, and emergency stop.
3. Production Compose now passes the application’s `MODEL_PROVIDER`, `MODEL_API_KEY`, `MODEL_BASE_URL`, and `MODEL_NAME` settings; the shared schema allowlists providers, maps provider-specific endpoints, and rejects mock/default-secret or incomplete provider configuration in production. Verify the clean-environment secret policy in CI and remove any remaining non-production defaults before launch.
4. Mount/persist artifact storage, add backup verification and restore drills, and add alerting, retention policy, and rollback instructions; backup writes are now atomic with gzip verification, restore stops on SQL errors, and rollback steps are documented. A real database restore and alert delivery drill remain open; worker/Telegram dependency-aware readiness endpoints are implemented.
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

Follow-up reliability slices `61bb83f`, `bfdbb09`, and `4121b3d` add startup, paginated, periodic, and Compose-smoke verification for persisted queued-task recovery. Commit `60211ed` synchronizes the recovery checkpoint and runbook; `6268918` hardens backup/restore and documents application rollback; commits `e2992df` and `1d00576` preserve provider completion limits and truncation signals; `76837ea` classifies watchdog-triggered provider aborts as `timed_out` without changing user/process cancellation. The local worker regression suite now passes 10 tests; a real cross-process restart/restore drill and alert delivery remain Docker/operations release criteria.

Historical execution through `76837ea` covered repository formatting enforcement, dependency/signature audit gates, timeout cancellation, fail-closed external writes, rubric governance, verified-only memory, and the durable control plane. The research slice is committed in `98ea6f6` and `a083c83`; task-state integrity and durable communication slices are committed in `0d25fb7`, `6279440`, and `bac3083`, with live dashboard refresh in `53f771f`. The final focused verification passes dashboard 8/8, agent-service 8/8, Telegram 17/17, orchestration 24/24, and database 3/3 tests. Final local code gates pass: `pnpm.cmd format:check`, `pnpm.cmd lint`, `pnpm.cmd typecheck` (26/26), `pnpm.cmd test -- --reporter=dot` (26/26), and `pnpm.cmd build` (15/15); the dashboard build also passes after the live Tasks refresh. The previously recorded dependency audit remains zero high/critical with 332/332 registry signatures verified, but it could not be rerun in this environment because registry access was denied. Docker is unavailable in this environment, so a successful PostgreSQL/Redis Compose boot, budget/lease behavior against real PostgreSQL, backup restore, restart recovery, and live research verification remain unverified.

Implemented: shared DB/queue/runtime bootstrap, transactional agent seeding, BullMQ retries and task-id idempotency, idempotent worker shutdown, fail-closed DB/queue readiness probes, request-ID correlation, validated task filters/pagination/resource IDs, PostgreSQL event outbox with `LISTEN/NOTIFY` and authenticated SSE/replay, production API auth/CORS/Redis-backed rate limiting with fail-closed outage behavior, dependency-aware worker/Telegram readiness and Compose healthchecks for API, worker, Telegram, dashboard, and Caddy, artifact containment and metadata persistence, plan validation, fail-closed approval/QA paths, durable approval request/decision/token/claim/finalize/resume, cross-process run cancellation, Telegram polling with durable update/control state, persisted message/tool-call history, scoped MemoryTools, durable global/per-run budget reservation and settlement for planner/specialist/QA/synthesis stages, complete delegation cost reporting, worker lease/heartbeat and stale-run recovery, worker recovery telemetry, audit/memory metadata APIs, aggregate cost/budget metrics, read-only governance settings, API-backed dashboard observability pages, explicit provider adapter routing with production configuration validation, patched dashboard dependencies with mandatory high-severity audit, Tool Gateway output validation and timeout cancellation propagation, and the CI lint/build/Compose gates.

Remaining release blockers: no approved outbound connector, no live-verified research credential/provider run, no successful Docker boot/recovery/backup run yet, alerting/retention/rollback, and a configured per-agent aggregate budget policy if required by the owner.

## Release gate

Do not call the system production-ready until all P0/P1 acceptance criteria pass in a clean environment and the following are demonstrated: migration from empty DB, task execution across service restart, Telegram create/status flow, approval execute-once, emergency stop, dashboard refresh consistency, backup restore, and security regression suite.
