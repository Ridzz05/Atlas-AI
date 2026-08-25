# ATLAS AI OS — Production Readiness Audit & Implementation Plan

## Scope and current verdict

Audit basis: `ATLAS_AI_OS_IMPLEMENTATION.md`, source tree, Docker/operations files, environment key map, test/build commands, and git history as of 26 August 2026.

Current verdict: **the repository is a typed, testable scaffold—not yet a runnable multi-service production system**. The code compiles and the mock/unit path is green, but the production path is not wired end-to-end. Do not expose the production compose stack to real users or external writes until P0 and P1 are complete.

## Evidence snapshot

- Git history contains exactly one commit: `a6efa4f` — `feat: complete ATLAS AI OS implementation (Phases 0 through 7)`.
- `pnpm typecheck`: PASS (24 Turbo tasks).
- `pnpm build`: PASS outside the restricted Windows process sandbox (14/14 packages/apps).
- `pnpm test`: PASS outside the restricted Windows process sandbox (24/24 Turbo tasks). The initial sandbox run failed only at dashboard worker-process creation with `spawn EPERM`.
- `pnpm lint`: exits 0 but executes **zero tasks**; no workspace package defines a `lint` script.
- Production entrypoints construct `InMemoryTaskQueue` and `InMemoryEventBus` by default. The API entrypoint does not construct a database client or repositories, and the worker does not construct a Redis/BullMQ queue.
- Telegram `start()` only logs startup; no polling loop, webhook server, Telegram API client, or API callback is wired.
- Dashboard pages use `SAMPLE_*`/`INITIAL_*` data and local React state rather than backend APIs or a realtime event stream.

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
| Phase 0 — Foundation | Partial | Monorepo, schemas, migration file, Docker files, and health routes exist. Startup migration, seed data, real DB wiring, clean boot proof, and lint gate are missing. |
| Phase 1 — Task engine | Partial | Runner, timeout, cancellation, provider adapter, and an in-memory queue exist. Durable queue, lease/heartbeat, restart recovery, persistent messages/events, and global budget enforcement are missing. |
| Phase 2 — Delegation | Partial | Five definitions, planner, DAG loop, QA call, and synthesis exist. Plan validation, dependency persistence, child-count enforcement, configurable depth, fail-closed QA, and revision workflow are missing. |
| Phase 3 — Telegram | Incomplete | Update parsing, allowlist, dedup cache, and command text exist. Telegram transport, persistence-backed commands, real approval decisions, real emergency stop, and status updates are missing. |
| Phase 4 — Memory | Partial | In-memory/database stores, lexical ranking, proposals, and lifecycle methods exist. Runtime wiring, embeddings/vector retrieval, access-scope enforcement, freshness jobs, and deletion audit are missing. |
| Phase 5 — Tools/workflow | Incomplete | Registry, rubric engine, artifact exporters, and mock tools exist. Real research/enrichment, tool executor wiring, output validation, cryptographic one-time approval, integration persistence, and safe artifact paths are missing. |
| Phase 6 — Dashboard | Incomplete | The visual shell and pages build. Data is fabricated/local-only; there is no authenticated API client, event stream, mutations, or refresh consistency. |
| Phase 7 — Hardening | Incomplete | Dockerfiles, compose, backups, and runbook exist. Auth, rate limits, production secret validation, alerting, threat-model checks, migration boot, and recovery drill are missing. |

## Findings ordered by leverage

### Critical / P0 — block production

1. **Production services do not share durable state.** `agent-service` and `worker` default to in-memory queue/event bus; their real entrypoints do not inject `DatabaseClient`, `TaskRepository`, `RunRepository`, `Migrator`, or Redis. Tasks disappear on restart and API/worker processes do not share a queue.
2. **Telegram is not connected to Telegram.** The service starts and stops only; no polling/webhook transport sends or receives updates.
3. **Approval commands are text-only acknowledgements.** `/approve`, `/reject`, and `/revise` return strings without loading or changing an approval record. The send tool checks only for a non-empty token; it does not call `TokenVerifier`, enforce request/action binding, expiry, one-time execution, or persisted status.
4. **QA fails open.** JSON parse failure returns `PASS`, and the delegator completes the parent even when Argus returns `REVISION_REQUIRED` or `BLOCKED`. This contradicts the fail-closed principle.
5. **External data and sending are fake.** Research tools return `example.com`/hard-coded company data, while `communication.send_approved` reports `sent` without an external connector. Production must make this explicit in mock mode and refuse claims of real delivery.
6. **No effective production authentication.** API routes have no auth/owner middleware; CORS allows every origin; Telegram allows all users when the allowlist is empty. Production compose defaults the allowlist/token to empty.
7. **Artifact path traversal.** Artifact save/read resolve a user-provided name without checking that the result stays inside the configured storage directory.

### Required / P1 — make the core system reliable

1. Add a single runtime composition/bootstrap layer shared by API, worker, and Telegram so dependencies are constructed consistently.
2. Run migrations and seed the five agent definitions before readiness. Populate `agents`, persist plans, child dependencies, runs, messages, tool calls, artifacts, approvals, and audit events.
3. Replace `InMemoryTaskQueue` in production with BullMQ/Redis; add job idempotency, attempts/backoff, leases, heartbeat, graceful shutdown, stale-run recovery, and cancellation propagation.
4. Add durable event publication/subscription (PostgreSQL outbox plus Redis pub/sub is sufficient for the MVP) and expose an authenticated SSE/WebSocket stream to the dashboard.
5. Enforce global daily/per-run/agent budgets and configured `MAX_DELEGATION_DEPTH`; validate plan agent IDs, max eight steps, unique IDs, dependency references, and cycles before persistence.
6. Enforce agent tool allowlists and data scopes in `ToolRegistry`; validate output with `outputSchema`; persist every call and audit record.
7. Implement real approval repository/service: exact payload hash, signature verification, expiry, owner identity, atomic compare-and-set to `executed`, and idempotency key. Keep external writes disabled until a real connector is explicitly configured.

### Required / P2 — restore the user control plane

1. Implement Telegram polling or webhook mode with secret verification, outbound response delivery, callback acknowledgement, persistent update deduplication, and dependency injection into the command router.
2. Route `/new`, `/status`, `/task`, `/stop`, `/pause`, `/resume`, `/emergency_stop`, and approval actions through the same control service as the web UI.
3. Add API authentication suitable for the single-user MVP, strict CORS, rate limits, request IDs, and owner-only mutation checks.
4. Replace every dashboard sample dataset with API queries and event-derived state. Add loading/error/empty states and refresh consistency tests.

### Required / P3 — make intelligence truthful and useful

1. Implement real `web.search`, `web.fetch_safe`, `company.lookup`, and `lead.enrich` adapters behind explicit provider interfaces, with source URL, extraction timestamp, confidence, and unverified status.
2. Add prompt-injection-safe fetched-content handling and size/network limits.
3. Wire MemoryTools into agent execution. Start with structured/lexical retrieval if necessary, then add pgvector embeddings and freshness/reranking once the persistence path is stable.
4. Add a configurable rubric repository with version history and validate all score dimensions/evidence before artifact export.

### Required / P4 — release and operations gates

1. Add actual lint/format scripts and make CI run lint, typecheck, unit, integration, build, migration, and Docker Compose configuration checks.
2. Add integration/e2e tests for DB+Redis, restart recovery, duplicate Telegram updates, approval execute-once, rejected approval no-side-effect, malicious content, budget exhaustion, and emergency stop.
3. Align production environment names: the app expects `MODEL_PROVIDER`/`MODEL_API_KEY`, while compose currently passes `OPENAI_API_KEY`/`ANTHROPIC_API_KEY`; remove insecure fallback passwords and fail startup on missing production secrets.
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

Execution is committed through `83c2a9c`. Full local gates pass: `pnpm typecheck` (26/26), `pnpm test` (26/26), and `pnpm build` (15/15). `pnpm lint` exits successfully but has no configured lint tasks. Docker is unavailable in this environment, so PostgreSQL/Redis Compose boot and restart recovery remain unverified.

Implemented: shared DB/queue/runtime bootstrap, transactional agent seeding, BullMQ retries and task-id idempotency, idempotent worker shutdown, PostgreSQL event outbox with `LISTEN/NOTIFY`, production API auth and strict CORS, artifact containment, fail-closed approval/QA paths, durable approval decisions, Telegram polling transport, authenticated dashboard task/approval flows, and blueprint/runbook alignment.

Remaining release blockers: approval decisions do not yet mint/persist executable tokens or invoke a real outbound connector; research/enrichment tools remain mock; Telegram deduplication and emergency-stop state are process-local; dashboard pages outside tasks/approvals still use sample data; no authenticated realtime event endpoint or rate limiter exists; Compose boot and recovery drills require a Docker host.

## Release gate

Do not call the system production-ready until all P0/P1 acceptance criteria pass in a clean environment and the following are demonstrated: migration from empty DB, task execution across service restart, Telegram create/status flow, approval execute-once, emergency stop, dashboard refresh consistency, backup restore, and security regression suite.
