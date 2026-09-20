# ATLAS AI OS

Multi-agent personal AI operating system: durable task orchestration, controlled delegation,
human approval gates, an Obsidian-based Second Brain, and real-time observability.

**v0.1.0** — pnpm + turbo monorepo (`packageManager: pnpm@11.23.0`, `engines.node: >=20`)
— every technical statement below was checked against source on **16 Sep 2026**.

---

## Status

The core path works end to end: `task → plan → delegate → execute → QA → synthesize`, with
leases, budget reservations, audit, and SSE streaming all live.

**Clean-host install — fixed in the migration chain, still unverified by execution.** The
migration `012_scheduled_jobs.sql` no longer re-declares `scheduled_jobs` with a shape that
conflicts with `001_initial_schema.sql:254-265`, and it now relaxes the two legacy columns
that `ScheduledJobRepository.create` never populates (`cron_expression`, `agent_id`), so the
chain no longer aborts and the first insert no longer fails on a not-null constraint.
`packages/database/test/scheduled-jobs-schema.test.ts` compares the two sides statically and
fails if a required column is left unwritten. What is still missing is the execution proof:
`runMigrations` has never been run against an empty PostgreSQL from this working tree, so
"a clean host boots" remains a static conclusion.

Full defect register with `path:line` anchors, including the scheduler, budget, and delegation
defects summarized under *Known Limitations* below:
`vault/01 - System Architecture/Implementation Status & Known Gaps.md` (last verified
16 Sep 2026 — several of its findings have since been fixed and are marked below).

The **Enterprise SDLC** slice (7-phase C-suite lifecycle, `/board`, the `/api/v1/sdlc/*`
routes, migrations 015 + 016) is documented in
`vault/01 - System Architecture/Enterprise SDLC Operating System.md`. Each phase runs as an
ordinary task through the task pipeline, so it inherits the budget reservation, run lease,
cancellation, audit trail and tool gating — see *Enterprise SDLC* below.

---

## Agent Fleet

Nine agents are registered (`packages/agents/src/registry.ts:15-25`). **Chief** is the single
entry point for human requests: it plans, decomposes, delegates to specialists, and
synthesizes the final answer. The C-suite trio (CEO, CFO, CTO) is currently reachable only
through the SDLC engine.

| Agent | Role (`role`) | Focus |
| :--- | :--- | :--- |
| **CEO** | `ceo` | Strategic brief and OKRs for an initiative (SDLC phase 1) |
| **CFO** | `cfo` | Budget envelope and unit economics (SDLC phase 3) |
| **CTO** | `cto` | Technical spec and tool policy (SDLC phase 2) |
| **Chief** | `orchestrator` | Goal intake, structured planning, delegation, oversight, synthesis |
| **Ned** | `researcher` | External and internal research with strict source tracking |
| **Luna** | `data_analyst` | Datasets, pricing metrics, market opportunities, quantitative reports |
| **Layla** | `lead_scoring` | Weighted ICP rubric evaluation and prioritized lead recommendations |
| **Hermes** | `content_creator` | Evidence-backed drafts, pitches, and personalized outreach |
| **Argus** | `qa_verifier` | Findings, citations, tone, policy compliance, and safety review |

Each definition carries a hard execution budget (turns, delegation depth, wall-clock timeout,
cost ceiling) and a **tool allowlist** — for example Chief at
`packages/agents/src/definitions/chief.ts:20-25` and `:27-42`.

---

## Verified Capabilities

- **Durable task pipeline** — tasks are created atomically with their intake message, then
  queued through BullMQ with `attempts: 3`, exponential backoff, and a stable `jobId`
  (`packages/orchestration/src/queue/bullmq-task-queue.ts:18-31`).
- **Run leases and heartbeat** — 60 s lease / 30 s heartbeat with abort on lease loss
  (`packages/orchestration/src/engine/agent-runner.ts:220-238`), plus stale-run recovery
  (`packages/database/src/repositories/run.repository.ts:207-227`).
- **Layered tool gating** — every tool call passes the registry, the agent allowlist, and the
  `ApprovalMatrix` in that order (`packages/tools/src/registry.ts:138-162`). Five actions are
  permanently blocked and six require human approval
  (`packages/policy/src/approval-matrix.ts:34-49`).
- **Human approval control room** — approvals carry a one-time execution token backed by a
  unique index (`packages/database/src/migrations/003_durable_approval_execution.sql:12-14`),
  with a dedup index that prevents duplicate active requests (`:19-21`).
- **Budget ledger** — reservations are committed or released per run, and per-run cost is
  checked against the agent ceiling (`agent-runner.ts:253-274`, `:361-364`). See the caveat in
  *Known Limitations* below.
- **Real-time events** — `event_outbox` → `pg_notify` → SSE, including `Last-Event-ID` replay
  and a 15 s heartbeat (`apps/agent-service/src/routes/events.ts:32-87`).
- **Append-only audit with redaction** — key-name based secret redaction
  (`packages/observability/src/logger.ts:11-32`) applied to a structured JSON logger that is
  written to console directly; there is **no Pino dependency**
  (`packages/observability/package.json` depends only on `@atlas/shared`).
- **Inference providers** — `mock | openai | openai-compatible | openrouter | groq | ollama |
  deepseek` (`packages/shared/src/schemas/config.ts:4`), defaulting to `openrouter` (`:33`).
  Retries cover `429/500/502/503/504`, honour the `retry-after` header and `try again in Ns`
  hints, and cap the wait at 45 s (`packages/providers/src/openai.ts:124-149`). Model provider
  selection, encrypted key storage, and fingerprinting are managed at runtime through
  `PUT /api/v1/settings/model-provider`.
- **Operator dashboard** — Next.js 15 App Router with ten pages (`/`, `/tasks`, `/board`,
  `/agents`, `/approvals`, `/artifacts`, `/audit`, `/brain`, `/communications`, `/settings`),
  Material UI + Tailwind, the **Valley Sans** typeface, and Circum Icons (`react-icons/ci`).
  `/board` is part of the uncommitted SDLC slice.

---

## Second Brain & Knowledge Vault

`vault/` holds **32 Obsidian notes** with YAML frontmatter, wikilinks, and Mermaid diagrams.
It is the system's shared knowledge corpus and the canonical technical record of this repo.

Ingestion and retrieval are real, and so are the current limits:

- The index lives in **process memory** — `private documents` / `private chunks` are `Map`
  instances (`packages/memory/src/second-brain/vault-ingestion-service.ts:25-26`), not a
  database. It is lost when `agent-service` restarts.
- **There is no pgvector.** `001_initial_schema.sql:6-12` wraps `CREATE EXTENSION vector` in a
  `DO $$ … EXCEPTION WHEN OTHERS THEN NULL $$` block, `memory_embeddings.embedding` is `JSONB`
  (`:196`), and no `vector` column exists anywhere in the schema. The dev/prod compose files
  still pull a `pgvector/pgvector:pg16` image, but the image is not what is missing — the
  schema never asks for the type.
- Embeddings resolve through Ollama (default `nomic-embed-text` at `127.0.0.1:11434`) or a
  cloud endpoint (`text-embedding-3-small`), falling back to a deterministic local vector
  (`packages/memory/src/second-brain/vector-embedding-service.ts:24-30`, `:62-80`).
- Retrieval scores `0.6 * vector + 0.3 * lexical + min(0.1, titleBonus)`
  (`packages/memory/src/second-brain/second-brain-retriever.ts:70`).
- **Agents cannot ground on the vault yet.** `SecondBrainService` is only instantiated in
  `apps/agent-service/src/server.ts:324-326`, while execution happens in `apps/worker` — and
  the `second_brain.*` tools are never registered there
  (`apps/worker/src/worker.ts:100-129`). Any agent call to them fails with
  `Tool '…' not found in Tool Gateway registry.`

Sync the vault into the running service with `pnpm brain:sync`
(`scripts/sync-vault.mjs` → `POST /api/v1/brain/ingest`).

---

## Monorepo Architecture

```text
atlas-ai-os/
├── apps/
│   ├── agent-service/            # Fastify control plane: REST API + SSE + pg_notify listener (:4000)
│   ├── worker/                   # BullMQ execution plane + scheduler loops (health :8081)
│   ├── dashboard/                # Next.js 15 command center (:3000)
│   └── telegram-bot/             # Telegram interface, getUpdates polling (health :8082)
├── packages/
│   ├── shared/                   # Zod schemas + centralized config loader
│   ├── database/                 # pg client, SQL migrations, 16 repositories, seeder
│   ├── events/                   # event_outbox + pg_notify event bus
│   ├── policy/                   # ApprovalMatrix, execution tokens, DepthGuard
│   ├── observability/            # Hand-rolled JSON logger, redaction, audit repository
│   ├── agents/                   # Nine agent definitions + registry
│   ├── orchestration/            # Planner, delegator, runner, QA gate, synthesizer, scheduler
│   ├── memory/                   # Memory store + Second Brain ingestion/retrieval
│   ├── tools/                    # Tool gateway, registry, and tool implementations
│   ├── providers/                # LLM adapters (openai, openai-compatible, openrouter, groq, ollama, deepseek, zrouter, mock)
│   └── runtime/                  # Composition root: createAtlasRuntime
├── vault/                        # Second Brain: 32 Obsidian notes
├── scripts/                      # dev.mjs, verify.mjs, lint.mjs, sync-vault.mjs, check-secrets.mjs,
│                                 # native-dev.test.mjs, playwright-audit.mjs, backup-db.sh,
│                                 # restore-db.sh, healthcheck.sh, ci-compose-smoke.sh
├── docker-compose.yml            # Local Postgres + Redis
├── docker-compose.prod.yml       # Production stack (7 apps/services + Caddy)
└── Caddyfile                     # TLS termination and reverse proxy
```

`createAtlasRuntime` (`packages/runtime/src/index.ts:69`) is the single boot path, shared by
`agent-service`, `worker`, and `telegram-bot`. The dashboard does **not** run it, so it never
migrates or seeds.

---

## Enterprise SDLC

A 7-phase executive lifecycle (`inception → architecture → budget_gate → sprint_planning →
implementation → qa_compliance → release_signoff → completed`) driven from `/board` or the
`/api/v1/sdlc/*` routes.

Each phase is an **ordinary task**, not an inline model call:

| Phase | Owning agent | Result |
| :--- | :--- | :--- |
| `inception` | `ceo` | `StrategicBrief` |
| `architecture` | `cto` | `TechnicalSpec` |
| `budget_gate` | `cfo` | `BudgetEnvelope` |
| `sprint_planning` | `chief` | `SprintPlan` (delegator expands it) |
| `implementation` | `chief` | the delegated specialist work |
| `qa_compliance` | `argus` | `QAReport` |
| `release_signoff` | `chief` | release package |

- `packages/orchestration/src/sdlc/sdlc-engine.ts` is a **coordinator**: `startPhase` creates
  and enqueues the phase task (reserving the task id and claiming it with a compare-and-set
  on `current_phase`, so a phase cannot run twice), and `recordPhaseResult` reads the finished
  task and moves the initiative on.
- `apps/worker` calls `recordPhaseResult` after every job, so an initiative advances as a
  side effect of real task execution. A restart mid-lifecycle no longer strands an initiative.
- Phase prompts and result parsing live in `packages/orchestration/src/sdlc/phase-prompts.ts`.
  Parsing is strict and fail-closed: an unparsable phase output **pauses** the initiative for
  human review instead of substituting a default verdict.
- Because phases are tasks, they inherit the budget ledger, run lease, cancellation, audit
  trail, event stream and tool gating. `sprint_planning` and `implementation` belong to
  `chief`, so the delegator expands them into specialist subtasks.
- `sdlc_initiatives.phase_task_id` (migration `016`) is the link the worker uses to map a
  finished task back to its initiative.

The `/board` page reads initiative state but has no realtime channel, so it needs a manual
refresh while a lifecycle is running.

---

## Quick Start (Development)

### Prerequisites

- Node.js ≥ 20
- pnpm ≥ 9 (the repo pins `pnpm@11.23.0`)
- Docker, for PostgreSQL 16 and Redis 7 — or reachable local equivalents

> The dev compose uses the `pgvector/pgvector:pg16` image. Because the schema defines no
> `vector` columns, any PostgreSQL 16 instance works today.

### Setup

1. **Install dependencies**

   ```bash
   git clone https://github.com/Ridzz05/Atlas-AI.git
   cd Atlas-AI
   pnpm install
   ```

2. **Start infrastructure**

   ```bash
   docker compose up -d
   ```

3. **Configure the environment**

   ```bash
   cp .env.example .env
   ```

   The defaults in `.env.example:25-30` route inference through OpenRouter:

   ```env
   DATABASE_URL=postgresql://atlas:atlas@localhost:5432/atlas
   REDIS_URL=redis://localhost:6379

   # Provider: openrouter (default) | groq | openai-compatible | openai | deepseek | ollama | mock
   MODEL_PROVIDER=openrouter
   MODEL_API_KEY=
   MODEL_BASE_URL=https://openrouter.ai/api/v1
   MODEL_NAME=minimax/minimax-m3:free
   ```

   The key can be entered in the dashboard instead (`/settings`), where it is stored encrypted
   in `model_provider_settings.encrypted_api_key`
   (`packages/database/src/migrations/011_model_provider_settings.sql:2-11`).

4. **Run preflight checks**

   ```bash
   pnpm dev:check
   ```

5. **Start the development suite**

   ```bash
   pnpm dev
   ```

   The dashboard, `agent-service`, and `worker` always start. **`telegram-bot` starts only when
   `TELEGRAM_BOT_TOKEN` is set** (`scripts/dev.mjs:80-84`).

| Service | Endpoint |
| :--- | :--- |
| Dashboard | `http://localhost:3000` |
| Control-plane API | `http://127.0.0.1:4000/health` |
| Worker health | `http://127.0.0.1:8081/ready` |
| Telegram bot health | `http://127.0.0.1:8082/ready` |

### Production

`docker-compose.prod.yml` defines the full stack — Postgres, Redis, `agent-service`, `worker`,
an optional `worker-automation` replica under the `automation` profile, `telegram-bot`, the
dashboard, and Caddy. Caddy is the **only** service that publishes host ports (`80`/`443`), so
health checks go through the domain:

```bash
curl -f https://${ATLAS_DOMAIN:-localhost}/health
curl -f https://${ATLAS_DOMAIN:-localhost}/ready
```

See `vault/03 - Operations & Runbooks/Production Deployment & Docker.md` for the full
runbook, including the mandatory `API_AUTH_TOKEN`, `POSTGRES_PASSWORD`, `REDIS_PASSWORD`,
and `ENCRYPTION_KEY` settings that the config loader enforces in production.

Caddy also gates the whole site with HTTP basic auth (`ATLAS_BASIC_AUTH_USER`,
`ATLAS_BASIC_AUTH_HASH`), because the dashboard proxy injects the real API bearer token for
every request it forwards — reaching the dashboard is equivalent to holding operator
credentials. `/health` and `/ready` stay public so container healthchecks work. Generate the
hash with `docker run --rm caddy:2-alpine caddy hash-password --plaintext 'your-password'`;
both variables are required by `docker-compose.prod.yml`.

---

## Verification & Testing

```bash
pnpm test          # unit + integration suites, then scripts/native-dev.test.mjs
pnpm typecheck     # tsc --noEmit across all 26 workspace targets
pnpm build         # build every package and app
pnpm lint          # repository lint rules
pnpm format:check  # prettier
```

---

## Known Limitations

Verified on 16 Sep 2026; each row is documented in detail in
`vault/01 - System Architecture/Implementation Status & Known Gaps.md`.

| Area | Limitation |
| :--- | :--- |
| Migrations | ~~`012_scheduled_jobs.sql` aborts a clean install; `013`/`014` never apply~~ — fixed; the chain applies and the first insert no longer hits the legacy not-null columns. Execution proof on an empty database is still outstanding |
| Scheduler | ~~`(0, eval)('require')` loses module scope, so `nextRunAt` stays `null`~~ — fixed; `scheduled-job-scheduler.ts:1` imports `cron-parser` statically |
| Vector search | No pgvector extension, no `vector` columns; embeddings are `JSONB` and the Second Brain index is in-process |
| Budget | OpenRouter adapter hardcodes `0` cost per million tokens (`packages/providers/src/openrouter.ts:18-19`), so the ledger stays at `$0` and the daily cap never trips. A reservation abandoned by a dead worker is now swept on the worker's recovery interval instead of only at boot |
| Grounding | `second_brain.*` tools are unregistered in the worker, so agents cannot query the vault |
| Delegation | ~~`depth` is not persisted on `taskRepo.create`~~ — fixed; `task.repository.ts:24-33` writes `input.depth ?? 0`. ~~A retried job re-ran the whole task~~ — fixed; the worker refuses a job whose task is not `queued`/`approval_pending`, and a terminal run write is now guarded by `worker_id` so a worker that lost the lease cannot clobber the owner |
| Cancellation | ~~A cancel does not reach the delegation graph~~ — fixed; `executePlan` owns an `AbortController`, polls the durable task-level cancel before planning and at every batch, and passes the signal to subtasks, the QA gate and the synthesiser |
| Budget bypass | ~~The durable reservation is skipped silently~~ — a one-time warning now names which repository or limit is missing, so a caller that omits one does not believe the daily cap is in force |
| Stage tools | ~~The planner/QA/synthesis stage runner had no tool gateway~~ — fixed; Argus can reach `policy.verify` again |
| Orphaned tasks | ~~A task stuck `running` was recovered only at worker boot, and a run that never acquired a lease was immortal~~ — fixed; the run sweep also catches a lease-less run once stale, the task sweep has a staleness guard, and both run on the worker's recovery interval |
| SDLC engine | Phases run as ordinary tasks through the task pipeline (budget, lease, cancellation, audit and tool gating all apply). `implementation` and `sprint_planning` are owned by `chief`, so the delegator expands them into specialist subtasks |

---

## Documentation

- **`vault/00 - Index & Maps of Content (MOC)/000 - Home MOC.md`** — entry point to the
  Second Brain: architecture, agent fleet, runbooks, rubrics, and workflows.
- `docs/UPDATE.md:880-950` — accurate self-assessment of the implementation.
- `tasks/plan.md` — current work plan.

Note: `docs/DESIGN.md` and `docs/design-systems/*` are third-party design dumps, not
documentation of this system.

---

## License

MIT License. Crafted for resilient personal AI workflows.
