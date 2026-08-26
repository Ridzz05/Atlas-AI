# ATLAS AI OS — Production Operations Runbook

This document provides operational instructions, deployment guidelines, disaster recovery steps, and incident playbooks for running ATLAS AI OS in production.

> Release status (26 August 2026): durable runtime, fail-closed DB/queue readiness, request-ID correlation, validated task pagination, API auth/CORS/Redis-backed rate limiting, dependency-aware worker/Telegram readiness, production Compose healthchecks, Telegram polling with durable update/control state, cross-process cancellation, Tool Gateway timeout cancellation propagation, plan validation, durable approval request/decision/token/claim/finalize/resume, persisted message/tool-call history, scoped MemoryTools with verified-only search and scheduled expiry/deprecation cleanup plus canonical-memory audit records, deterministic lead scoring, versioned/persisted lead rubrics with active-version bootstrap, authenticated and audited agent-service rubric control API, safe research tool boundaries including public-hostname target validation, research output evidence contracts, PostgreSQL event streaming with reconnect replay, durable global/per-run budget accounting, worker leases/heartbeats with stale-run recovery and recovery telemetry, metadata APIs, aggregate cost/budget metrics, read-only governance settings, explicit provider adapter routing, patched dashboard dependencies, repository formatting enforcement, fail-closed handling for every registered external/production side effect, and API-backed dashboard task/approval/agent/artifact/audit/memory views plus durable dashboard pause/resume/emergency-stop controls are implemented and locally tested. The latest high-severity dependency audit reports zero high/critical findings and all 332 installed packages have verified registry signatures. Do not enable external writes yet: no approved outbound connector or verified research provider is configured. Backup/recovery drills, clean Compose boot, and live provider verification still require a Docker host or external integration environment.

---

## 1. System Architecture & Inventory

| Service | Port | Tech Stack | Role |
|:---|:---:|:---|:---|
| `caddy` | 80, 443 | Caddy 2 Alpine | Reverse proxy, SSL/TLS automation |
| `agent-service` | 4000 | Fastify, TypeScript | Core API, HTTP endpoints, task intake |
| `worker` | — | Node.js, BullMQ | Background async multi-agent execution loop |
| `telegram-bot` | — | Node.js | Telegram Mobile Control Plane |
| `dashboard` | 3000 | Next.js 15, Tailwind | API-backed Web Management Control Room |
| `postgres` | 5432 | PostgreSQL 16 + pgvector | Relational state, memory, vectors, audit |
| `redis` | 6379 | Redis 7 Alpine | Distributed task queue and pub/sub bus |

---

## 2. Production Deployment (Docker Compose)

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

`web.fetch_safe` accepts only credential-free HTTP(S) URLs with named public hostnames. It rejects literal IPv4/IPv6 targets and `localhost`, `.local`, and `.internal` hostnames before provider access. Any approved provider must additionally validate DNS results, every redirect target, response size, and request timeout; do not inject an arbitrary fetch client as a research provider.

Tool Gateway timeouts propagate an `AbortSignal` to research providers. Provider implementations must honor that signal and still enforce their own DNS, redirect, response-size, and request-timeout controls; a provider that ignores cancellation is not release-ready.

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
The worker scans persisted tasks with status `queued` in pages before accepting new queue work and repeats the scan every `QUEUE_RECOVERY_INTERVAL_SECONDS` (default: 30). It re-enqueues each task with the task/run identifier as the durable idempotency key. This repairs both the startup failure window and a later PostgreSQL/Redis enqueue interruption. Review worker logs for `Requeued persisted tasks awaiting worker delivery` after a restart or queue outage, and verify the task reaches a terminal state during the recovery drill.

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
