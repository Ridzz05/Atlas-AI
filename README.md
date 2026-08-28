# ATLAS AI OS

> Current working checkpoint (27 August 2026): native self-hosted terminal development is supported; Docker is optional.

> Multi-agent Personal AI Operating System controlled via Telegram, powered by shared memory, controlled task delegation, human approval gates, and real-time observability.

> Release status (27 August 2026): local lint, typecheck, tests, production build, formatting, and high-severity dependency audit pass. Fail-closed DB/queue readiness, request-ID correlation, validated task pagination, Redis-backed rate limiting, dependency-aware worker/Telegram readiness, authenticated event replay, durable global/per-run budget accounting, worker lease recovery and telemetry, aggregate cost/budget metrics, secure encrypted OpenRouter credential settings, verified-only agent memory search, deterministic lead scoring, versioned/persisted lead rubrics with active-version bootstrap, safe research tool boundaries, research output evidence contracts, Tool Gateway timeout cancellation propagation, memory expiry/deprecation cleanup with audit records, fail-closed production model-provider configuration, strict external-write environment parsing, and fail-closed policy handling for all registered external/production side effects are implemented. A historical Docker Compose boot/recovery/backup smoke passed before Docker/WSL were removed from the current host; native PostgreSQL/Redis and terminal startup are now the active path. Clean-host recovery, live provider verification, alerting/retention/rollback, and external writes remain release gates.

## Architecture Highlights
- **Single Root Entry**: Human talks to **Chief**, who plans, delegates, reviews, and synthesizes.
- **Controlled Specialists**: Ned (Research), Layla (Lead Scoring), Hermes (Content), Argus (QA & Risk).
- **Deterministic Tool Gateway & Policy Matrix**: Enforces least privilege, approval tokens, and strict audit trails.
- **Shared Memory Layer**: Multi-tiered memory (working, conversation, episodic, semantic, entity, artifacts, policy).

---

## Monorepo Structure

```text
atlas-ai-os/
├── apps/
│   ├── agent-service/            # Fastify orchestration API
│   ├── worker/                   # BullMQ agent workers
│   ├── dashboard/                # Next.js command center
│   └── telegram-bot/             # Telegram bot webhook/polling
├── packages/
│   ├── shared/                   # Shared types, Zod schemas, utilities
│   ├── database/                 # Schema, migrations, repositories
│   ├── events/                   # Event schemas and event bus
│   ├── policy/                   # Permissions, approval rules, depth guard
│   ├── observability/            # Structured logging, audit events
│   ├── agents/                   # Agent definitions and prompts
│   ├── orchestration/            # Planner, router, delegation, synthesis
│   ├── memory/                   # Retrieval, ingestion, summarization
│   ├── tools/                    # Tool registry and implementations
│   └── providers/                # LLM provider adapters
├── docker-compose.yml
└── pnpm-workspace.yaml
```

---

## Quick Start (Development)

### Prerequisites
- Node.js >= 20
- pnpm >= 9
- Native PostgreSQL 16 with the `pgvector` extension
- Native Redis 7
- Docker & Docker Compose are optional and only needed for the production-like Compose smoke test

### Setup
```bash
# 1. Install dependencies
pnpm install

# 2. Setup environment
cp .env.example .env

# 3. Configure .env for the native PostgreSQL/Redis instances.
#    Keep MODEL_PROVIDER=openrouter (the default) and enter the API key from Dashboard > Settings.

# 4. Check that native PostgreSQL and Redis are reachable
npm run dev:check

# 5. Start the API, worker, and dashboard without Docker
npm run dev

# Dashboard: http://localhost:3000
# API:       http://127.0.0.1:4000/health
# Worker:    http://127.0.0.1:8081/ready
# Telegram:  http://127.0.0.1:8082/ready (only when TELEGRAM_BOT_TOKEN is set)

# 5. Run repository verification
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

`npm run dev` loads the root `.env`, performs a fail-fast TCP check for PostgreSQL and Redis, compiles the native services, watches TypeScript output, and starts the API, worker, and dashboard. Telegram starts automatically when `TELEGRAM_BOT_TOKEN` is configured; otherwise it is intentionally skipped. The command never starts Docker.

For a disposable production-like recovery check, use `bash ./scripts/ci-compose-smoke.sh`. It builds the optional application images, verifies durable intake and queued-task recovery, restarts the API and worker, checks the dashboard task/SSE proxy, validates Telegram readiness, and exercises PostgreSQL backup/restore. The smoke test removes its temporary containers and volumes when it finishes.

### Optional Docker Compose runtime

Use Docker only when you need an isolated production-like stack or the Compose recovery smoke. The native development path remains the recommended low-resource self-hosted workflow:

```bash
docker compose -f docker-compose.prod.yml up -d --build
./scripts/healthcheck.sh
```
