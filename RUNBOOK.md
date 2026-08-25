# ATLAS AI OS — Production Operations Runbook

This document provides operational instructions, deployment guidelines, disaster recovery steps, and incident playbooks for running ATLAS AI OS in production.

---

## 1. System Architecture & Inventory

| Service | Port | Tech Stack | Role |
|:---|:---:|:---|:---|
| `caddy` | 80, 443 | Caddy 2 Alpine | Reverse proxy, SSL/TLS automation |
| `agent-service` | 4000 | Fastify, TypeScript | Core API, HTTP endpoints, task intake |
| `worker` | — | Node.js, BullMQ | Background async multi-agent execution loop |
| `telegram-bot` | — | Node.js | Telegram Mobile Control Plane |
| `dashboard` | 3000 | Next.js 15, Tailwind | Real-time Web Management Control Room |
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
nano .env # Set secure passwords, tokens, and model API keys

# 3. Launch stack
docker compose -f docker-compose.prod.yml up -d --build

# 4. Verify service health
./scripts/healthcheck.sh
```

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
2. **Via Web Dashboard**: Click the **Emergency Stop** button in the sidebar.
3. **Via Shell**:
   ```bash
   docker compose -f docker-compose.prod.yml stop worker
   ```
*Effect:* Instantly halts active agent executions, freezes new intake, and blocks all external mutations.

### 4.2 System Recovery / Resume
1. Inspect audit logs in the Dashboard (`/audit`) or PostgreSQL:
   ```sql
   SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT 20;
   ```
2. Verify token budgets and policy rules.
3. In Telegram: Send `/resume` to unfreeze the engine.

---

## 5. Security & Secret Rotation

### 5.1 Rotating `APPROVAL_SECRET_KEY`
1. Generate a new 32-byte secret:
   ```bash
   openssl rand -hex 32
   ```
2. Update `APPROVAL_SECRET_KEY` in `.env`.
3. Restart `agent-service`, `worker`, and `telegram-bot`.
4. *Note:* Existing pending approval tokens will be invalidated; pending requests must be re-issued.

### 5.2 Rotating Telegram Bot Token
1. Generate new token via Telegram `@BotFather`.
2. Update `TELEGRAM_BOT_TOKEN` in `.env`.
3. Restart `telegram-bot`:
   ```bash
   docker compose -f docker-compose.prod.yml restart telegram-bot
   ```

---

## 6. Token Budget & Cost Controls

- Global daily spending limit is configured in `.env` (`DAILY_SPEND_BUDGET_USD=5.00`).
- Each individual run is hard-capped at `$1.00 USD` (or agent specific limits).
- If daily budget is reached, new tasks are rejected with `BUDGET_EXCEEDED` error.
