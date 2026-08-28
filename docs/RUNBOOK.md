# ATLAS AI OS — Production Operations Runbook

> Current working checkpoint (27 August 2026): native terminal development is supported with host PostgreSQL/Redis; Docker remains optional.

This document provides operational instructions, deployment guidelines, disaster recovery steps, and incident playbooks for running ATLAS AI OS in production.

> Release status (27 August 2026): durable runtime, fail-closed DB/queue readiness, request-ID correlation, validated task pagination, API auth/CORS/Redis-backed rate limiting, dependency-aware worker/Telegram readiness, Telegram polling with durable update/control state, cross-process cancellation, valid task-status enforcement, task lifecycle events, atomic production API/Telegram task-intake plus originating-message persistence, Tool Gateway timeout cancellation propagation, plan validation, durable approval request/decision/token/claim/finalize/resume, persisted message/tool-call history, durable dashboard Communications feed with authenticated SSE refresh, scoped MemoryTools with verified-only search and scheduled expiry/deprecation cleanup plus canonical-memory audit records, deterministic lead scoring, versioned/persisted lead rubrics with active-version bootstrap, authenticated and audited agent-service rubric control API, opt-in Brave research adapter with bounded safe fetch and untrusted-content evidence boundaries, PostgreSQL event streaming with reconnect replay, durable global/per-run budget accounting, worker leases/heartbeats with stale-run recovery and recovery telemetry, metadata APIs, aggregate cost/budget metrics, secure OpenRouter settings with encrypted credential persistence, explicit provider adapter routing, patched dashboard dependencies, repository formatting enforcement, fail-closed handling for every registered external/production side effect, and API-backed dashboard task/approval/agent/artifact/audit/memory views plus durable dashboard pause/resume/emergency-stop controls are implemented and locally tested. The latest high-severity dependency audit reports zero high/critical findings and all 332 installed packages have verified registry signatures. Do not enable external writes yet: no approved outbound connector is configured, and the research provider is not live-verified. The historical Docker Compose boot/readiness/restart/backup-restore smoke passed before Docker/WSL removal; current development uses native PostgreSQL/Redis and the terminal launcher.

---

> Dashboard realtime checkpoint (26 August 2026): commit `53f771f` adds authenticated SSE refresh to the Tasks page, matching the durable Communications feed. Both pages close the connection and remove all listeners on unmount.

> Compose verification checkpoint (historical, 26 August 2026): commits `2b109c5` and `3411cf5` isolate smoke-test container names using `ATLAS_CONTAINER_PREFIX` and verify that API task intake creates a durable message record. Commit `ef7694e` makes backup/restore scripts use the same prefix while preserving the default production container name. The smoke test passed on Docker Desktop with WSL 2.7.12 before those optional tools were removed from this host; repeat it only on a separate clean production-like host if Compose deployment is chosen.

> Queue recovery checkpoint (26 August 2026): commit `784394e` prevents periodic recovery from duplicating a task whose base or deferred queue job is still pending and replaces terminal BullMQ records before requeueing. The local queue/worker regression slice passes 18/18; verify cross-process behavior with the Compose smoke test.

> Intake durability checkpoint (26 August 2026): commit `4a7c262` makes production API and Telegram `/new` task creation plus originating-message persistence use one PostgreSQL transaction. A history failure rolls back task creation and prevents enqueue; the focused database/API/Telegram slice passes 31/31 tests.

## Current local verification — 27 August 2026

The historical Docker Compose smoke passed image builds, PostgreSQL/Redis/agent-service/worker/telegram-bot readiness, durable API intake history, queued-task recovery, service restart readiness, dashboard/Caddy health, dashboard `/api/atlas/tasks` and SSE proxy routes over HTTPS, and PostgreSQL backup/restore. Docker Desktop and WSL are intentionally absent from the current host, so native PostgreSQL/Redis plus `npm run dev` are the active path. Real Telegram message/active-run recovery, live OpenRouter verification, alerting, retention, rollback, and outbound connector approval remain open.

## Native self-hosted development

Docker is optional for local development. Install PostgreSQL 16 with `pgvector` and Redis 7 as host services, copy `.env.example` to `.env`, and keep the native URLs pointed at `localhost`:

```bash
pnpm install
npm run dev:check
npm run dev
```

The launcher runs the TypeScript build/watch process and starts the API, worker, and dashboard from the terminal. It does not start Docker. Telegram is included only when `TELEGRAM_BOT_TOKEN` is non-empty. Native health endpoints are API `4000`, worker `8081`, and Telegram `8082`.

If `npm run dev:check` fails, start the native PostgreSQL and Redis services or correct `DATABASE_URL`/`REDIS_URL`; the application intentionally fails closed instead of silently switching to an in-memory queue or database.

### Native Windows dependency setup

Run the host installation commands from an **Administrator** terminal. PostgreSQL 16 is available from the official Windows installer, while Memurai Developer provides a Redis-compatible native Windows service for development:

```powershell
winget install --id PostgreSQL.PostgreSQL.16 --exact --accept-source-agreements --accept-package-agreements
winget install --id Memurai.MemuraiDeveloper --exact --accept-source-agreements --accept-package-agreements
```

ATLAS migrations also create the `vector` extension. The official PostgreSQL installer does not supply pgvector automatically on Windows; install the Visual Studio C++ workload, open **x64 Native Tools Command Prompt for VS** as Administrator, and build the extension against the installed PostgreSQL version:

```cmd
set "PGROOT=C:\Program Files\PostgreSQL\16"
cd %TEMP%
git clone --branch v0.8.6 https://github.com/pgvector/pgvector.git
cd pgvector
nmake /F Makefile.win
nmake /F Makefile.win install
```

Create the local `atlas` role/database to match the development `DATABASE_URL`, then verify `CREATE EXTENSION vector;` once in that database. The pgvector project documents the Windows build prerequisites and commands in its [official installation guide](https://github.com/pgvector/pgvector#installation), PostgreSQL publishes the [official Windows installer](https://www.postgresql.org/download/windows/), and Memurai documents its [native service installation](https://docs.memurai.com/en/installation.html). Memurai Developer is suitable for development/testing; use a licensed/native production Redis-compatible service for production uptime requirements.

## 1. System Architecture & Inventory

| Service | Port | Tech Stack | Role |
|:---|:---:|:---|:---|
| `caddy` | 80, 443 | Caddy 2 Alpine | Reverse proxy, SSL/TLS automation |
| `agent-service` | 4000 | Fastify, TypeScript | Core API, HTTP endpoints, task intake |
| `worker` | 8081 | Node.js, BullMQ | Background async multi-agent execution loop |
| `telegram-bot` | 8082 | Node.js | Telegram Mobile Control Plane |
| `dashboard` | 3000 | Next.js 15, Tailwind | API-backed Web Management Control Room |
| `postgres` | 5432 | PostgreSQL 16 + pgvector | Relational state, memory, vectors, audit |
| `redis` | 6379 | Redis 7 Alpine | Distributed task queue and pub/sub bus |

---

## Native OpenRouter Configuration

The default model is `z-ai/glm-5.2:free` through OpenRouter's OpenAI-compatible API. Set `MODEL_PROVIDER=openrouter`, `MODEL_BASE_URL=https://openrouter.ai/api/v1`, and `MODEL_NAME=z-ai/glm-5.2:free` in `.env` (these values are already in `.env.example`).

For the native dashboard, start PostgreSQL and Redis, run `npm run dev`, open `http://localhost:3000/settings`, and paste the OpenRouter key into **OpenRouter connection**. The authenticated API encrypts the key with `ENCRYPTION_KEY`; the browser receives only configuration status and a non-reversible fingerprint. The worker reloads the persisted setting on the next model call, so no restart is required. OpenRouter documents the Bearer-key chat endpoint and notes that free models are rate-limited: [OpenRouter Quickstart](https://openrouter.ai/docs/quickstart), [GLM 5.2 model page](https://openrouter.ai/z-ai/glm-5.2:free).

If the key is absent, model execution fails closed with `MODEL_API_KEY_MISSING`; no request is sent to an unauthenticated provider.

## 2. Optional Docker Compose Deployment

Docker/WSL are not required by ATLAS. The commands in this section are retained only for a separate host that explicitly chooses Compose; the supported local path is the native launcher above.

### 2.1 Initial Server Setup
```bash
# 1. Clone repository
git clone <repo-url> /opt/atlas-os
cd /opt/atlas-os

# 2. Copy and configure production environment
cp .env.example .env
nano .env # Set ATLAS_DOMAIN, secure passwords, owner tokens, and model provider settings

# 3. Launch stack
docker compose -f docker-compose.prod.yml up -d --build

# 4. Verify service health
./scripts/healthcheck.sh
```

The repository `.dockerignore` excludes local credentials, Git metadata, dependencies, generated output, and runtime/test data from image build contexts. Keep production secrets in the deployment environment, not in the build context.

For a clean-host verification that also exercises image builds, dependency-aware worker/Telegram readiness, agent seeding, durable queued-task recovery, and PostgreSQL backup/restore, run:

```bash
bash ./scripts/ci-compose-smoke.sh
```

The smoke test uses an isolated Compose project and removes its temporary containers and volumes when it finishes. Run it only against a disposable verification environment.

### 2.2 Zero-Downtime Application Update
```bash
# Pull newest code
git pull origin main

# Rebuild containers
docker compose -f docker-compose.prod.yml build

# Rolling restart services
docker compose -f docker-compose.prod.yml up -d --no-deps agent-service
docker compose -f docker-compose.prod.yml up -d --no-deps worker
docker compose -f docker-compose.prod.yml up -d --no-deps telegram-bot
docker compose -f docker-compose.prod.yml up -d --no-deps dashboard
```

---

## 3. Database Maintenance & Backup

### 3.1 Automated Daily Backups
Add to crontab (`crontab -e`):
```cron
0 2 * * * /opt/atlas-os/scripts/backup-db.sh >> /var/log/atlas_backup.log 2>&1
```

The backup script writes to a temporary file, verifies the gzip archive, and only then moves it into the backup directory. A failed `pg_dump` or invalid archive never replaces the last successful backup. The script retains backups for 14 days.

### 3.2 Manual Backup
```bash
./scripts/backup-db.sh
```

### 3.3 Database Restoration (Disaster Recovery)
```bash
./scripts/restore-db.sh ./backups/atlas_db_backup_YYYYMMDD_HHMMSS.sql.gz
```

The restore script validates the gzip archive before asking for confirmation and uses `ON_ERROR_STOP` inside a single transaction. Stop application writes before restoring, take a fresh backup first, and run the Compose smoke/recovery checks after the restore.

### 3.4 Application rollback

For a bad application release:

1. Freeze new intake with Dashboard **Pause system** or Telegram `/pause`; use `/emergency_stop` if data integrity or runaway execution is suspected.
2. Record the deployed image Git SHA and recent audit/task state.
3. Redeploy the previous known-good revision:
   ```bash
   git fetch origin
   git checkout <known-good-sha>
   docker compose -f docker-compose.prod.yml up -d --build
   ./scripts/healthcheck.sh
   ```
4. Verify `/health`, `/ready`, agent seeding, queued-task recovery, and the critical user flow.
5. Resume intake only after the incident owner confirms the audit trail and database state are consistent.

Do not roll back database migrations blindly. Restore a verified backup only after assessing whether the application revision is compatible with the current schema.

### 3.5 Memory Lifecycle Maintenance

The worker runs memory maintenance before accepting queue work and then on the configured interval. Expired records are first marked `deprecated` and audited; deprecated records are deleted after the configured grace period. Agent `memory.search` exposes only `verified` records; proposal records remain hidden until governance verification. Defaults are `MEMORY_MAINTENANCE_INTERVAL_SECONDS=3600` and `MEMORY_DELETION_GRACE_DAYS=7`. Keep these values in the deployment environment when a different retention window is required.

### 3.6 Research provider network boundary

`web.fetch_safe` accepts only credential-free HTTP(S) URLs with named public hostnames. It rejects literal IPv4/IPv6 targets and `localhost`, `.local`, and `.internal` hostnames before provider access. The built-in `SafeWebFetcher` additionally validates all DNS results, pins the first validated public address into the Node HTTP(S) transport, validates every redirect target, bounds response size, accepts only text-like content types, and enforces request/body timeouts. Fetched content remains untrusted data and must not be treated as instructions or canonical facts. Any approved provider must apply equivalent controls; the `fetchImpl` override is a test seam and must not be injected in production.

Tool Gateway timeouts propagate an `AbortSignal` to research providers. Provider implementations must honor that signal and still enforce their own DNS, redirect, response-size, and request-timeout controls; a provider that ignores cancellation is not release-ready.

### 3.7 Optional Brave research provider

Research is fail-closed by default. Leave these values unchanged when no approved research credential is available:

```dotenv
RESEARCH_PROVIDER=none
RESEARCH_API_KEY=
RESEARCH_COUNTRY=ID
RESEARCH_SEARCH_LANG=id
```

After approving a Brave Search API credential, set `RESEARCH_PROVIDER=brave` and `RESEARCH_API_KEY` in the deployment secret environment. The worker constructs the provider and receives only the research configuration; the API and dashboard do not need the key. The adapter sends search requests to the official Brave Search API host, does not log the key, limits query/result sizes, and returns evidence with confidence `0.5` plus unresolved verification questions. Do not promote its results to verified memory or enable external writes solely because a search result exists.

Before enabling this in production, run the provider-to-Tool-Gateway tests, perform a live search with a disposable approved key, confirm API-key redaction in logs, and complete the clean-host recovery/security drill. Revoke the disposable key after verification.

### 3.8 Durable communication history

The task API and Telegram `/new` command persist the originating user message when the database message repository is configured. The dashboard Communications page reads `/api/v1/messages` and `/api/v1/tool-calls`, combines them newest-first, and refreshes from the authenticated event stream. It displays sender, status, task/run IDs, and risk metadata only; raw tool input/output must remain in the protected database/API boundary.

In the production runtime, task creation and the originating history message use one PostgreSQL transaction. If the history insert fails, the transaction rolls back and the task is not enqueued, so a client may safely retry after the database issue is resolved. Best-effort history persistence is retained only for injected test or legacy adapters that do not provide the shared `DatabaseClient`; those adapters log the failure and must not be treated as complete communication history.

---

## 4. Emergency Procedures

### 4.1 Emergency Stop
When an unexpected agent behavior or runaway task is detected:
1. **Via Dashboard**: Open **Command Center** and select **Emergency stop**, then confirm the action.
2. **Via API** (with the configured owner token):
   ```bash
   curl -X POST https://<ATLAS_DOMAIN>/api/v1/control/emergency-stop \
     -H "Authorization: Bearer <API_AUTH_TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{"reason":"Incident response"}'
   ```
3. **Via Telegram**: Send `/emergency_stop` to the Telegram bot.
4. **Via Shell**:
   ```bash
   docker compose -f docker-compose.prod.yml stop worker
   ```
Dashboard, API, and Telegram use the same PostgreSQL-backed control state. Emergency stop persists the lock and requests cancellation for active runs; stopping the worker is an additional hard stop for new background execution.

### 4.2 System Recovery / Resume
1. Inspect available audit records through the authenticated dashboard/API or directly in PostgreSQL:
   ```sql
   SELECT * FROM audit_events ORDER BY timestamp DESC LIMIT 20;
   ```
2. Verify token budgets and policy rules.
3. In the Dashboard, select **Resume system**, or in Telegram send `/resume` to unfreeze the engine.

### 4.3 Queued task recovery
The worker scans persisted tasks with status `queued` in pages before accepting new queue work and repeats the scan every `QUEUE_RECOVERY_INTERVAL_SECONDS` (default: 30). It checks for pending base/deferred jobs before requeueing, uses the task/run identifier as the durable idempotency key, and replaces terminal queue records when a still-queued task needs recovery. Deferred jobs use a stable, removable identifier so pause/emergency-stop retries do not accumulate duplicate executions. This repairs both the startup failure window and a later PostgreSQL/Redis enqueue interruption. Review worker logs for `Requeued persisted tasks awaiting worker delivery` after a restart or queue outage, and verify the task reaches a terminal state during the recovery drill.

---

## 5. Security & Secret Rotation

### 5.1 Rotating `ENCRYPTION_KEY` and `API_AUTH_TOKEN`
1. Generate new secrets:
   ```bash
   openssl rand -hex 32
   ```
2. Update `ENCRYPTION_KEY` and `API_AUTH_TOKEN` in `.env`.
3. Restart `agent-service`, `worker`, `telegram-bot`, and `dashboard`.
4. Re-issue pending approval decisions after a key rotation.
5. Re-enter the OpenRouter API key in Dashboard > Settings after changing `ENCRYPTION_KEY`; persisted model credentials are intentionally unreadable with the old encryption key.

### 5.2 Rotating Telegram Bot Token
1. Generate new token via Telegram `@BotFather`.
2. Update `TELEGRAM_BOT_TOKEN` in `.env`.
3. Restart `telegram-bot`:
   ```bash
   docker compose -f docker-compose.prod.yml restart telegram-bot
   ```

### 5.3 External write flag

`EXTERNAL_WRITES_ENABLED` is parsed strictly: `false` disables writes, `true` is the only enabling value, and empty or ambiguous values are rejected or treated as disabled. Keep it set to `false` until an approved connector, verified provider, and owner approval are in place.

### 5.4 Dependency security gate

CI runs `pnpm install --frozen-lockfile`, `pnpm format:check`, `pnpm audit --audit-level high`, and `pnpm audit signatures`. The current lockfile resolves patched dashboard dependencies (`next@15.5.24`, `sharp@0.35.3`, and `postcss@8.5.26`); the latest audit found zero high/critical vulnerabilities, and signatures verified 332 packages. Do not use forced audit remediation; review and test each dependency update with its lockfile diff.

---

## 6. Token Budget & Cost Controls

- Global daily spending limit is configured in `.env` (`GLOBAL_DAILY_BUDGET_USD=5.00`).
- Each individual run is hard-capped at `$1.00 USD` (or agent specific limits).
- A budget reservation is acquired before each planner, specialist, Argus, and synthesis model call; the reservation is settled with actual provider cost after the call.
- If a global or per-run budget is reached, the provider call is rejected with `BUDGET_EXCEEDED` and no model call is started.
- Reservations older than 15 minutes are released during runtime startup. Worker leases are renewed by heartbeat and expired executable runs are marked failed during worker startup recovery.
- Verify budget and lease state directly in PostgreSQL during a recovery drill before enabling production traffic.
