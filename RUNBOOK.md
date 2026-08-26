# ATLAS AI OS — Production Operations Runbook

This document provides operational instructions, deployment guidelines, disaster recovery steps, and incident playbooks for running ATLAS AI OS in production.

> Release status (26 August 2026): durable runtime, fail-closed DB/queue readiness, request-ID correlation, validated task pagination, API auth/CORS/Redis-backed rate limiting, dependency-aware worker/Telegram readiness, production Compose healthchecks, Telegram polling with durable update/control state, cross-process cancellation, plan validation, durable approval request/decision/token/claim/finalize/resume, persisted message/tool-call history, scoped MemoryTools, PostgreSQL event streaming with reconnect replay, durable global/per-run budget accounting, worker leases/heartbeats with stale-run recovery and recovery telemetry, metadata APIs, aggregate cost/budget metrics, read-only governance settings, explicit provider adapter routing, and API-backed dashboard task/approval/agent/artifact/audit/memory views are implemented and locally tested. Do not enable external writes yet: no approved outbound connector or verified research provider is configured. Backup/recovery drills, clean Compose boot, and live provider verification still require a Docker host or external integration environment.

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

For a clean-host verification that also exercises image builds, dependency-aware worker/Telegram readiness, agent seeding, and PostgreSQL backup/restore, run:

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

### 3.2 Manual Backup
```bash
./scripts/backup-db.sh
```

### 3.3 Database Restoration (Disaster Recovery)
```bash
./scripts/restore-db.sh ./backups/atlas_db_backup_YYYYMMDD_HHMMSS.sql.gz
```

---

## 4. Emergency Procedures

### 4.1 Emergency Stop
When an unexpected agent behavior or runaway task is detected:
1. **Via Telegram**: Send `/emergency_stop` to the Telegram bot.
2. **Via Shell**:
   ```bash
   docker compose -f docker-compose.prod.yml stop worker
   ```
*Current limitation:* Telegram emergency stop is the supported control and its pause/emergency state plus active-run cancellation request are persisted. The dashboard has read-only observability but no emergency-stop mutation yet. Stopping the worker is an additional hard stop for new background execution; use the durable control first so the state is recorded.

### 4.2 System Recovery / Resume
1. Inspect available audit records through the authenticated dashboard/API or directly in PostgreSQL:
   ```sql
   SELECT * FROM audit_events ORDER BY timestamp DESC LIMIT 20;
   ```
2. Verify token budgets and policy rules.
3. In Telegram: Send `/resume` to unfreeze the engine.

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

---

## 6. Token Budget & Cost Controls

- Global daily spending limit is configured in `.env` (`GLOBAL_DAILY_BUDGET_USD=5.00`).
- Each individual run is hard-capped at `$1.00 USD` (or agent specific limits).
- A budget reservation is acquired before each planner, specialist, Argus, and synthesis model call; the reservation is settled with actual provider cost after the call.
- If a global or per-run budget is reached, the provider call is rejected with `BUDGET_EXCEEDED` and no model call is started.
- Reservations older than 15 minutes are released during runtime startup. Worker leases are renewed by heartbeat and expired executable runs are marked failed during worker startup recovery.
- Verify budget and lease state directly in PostgreSQL during a recovery drill before enabling production traffic.
