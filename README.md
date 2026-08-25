# ATLAS AI OS

> Multi-agent Personal AI Operating System controlled via Telegram, powered by shared memory, controlled task delegation, human approval gates, and real-time observability.

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
- Docker & Docker Compose (optional for local DB/Redis)

### Setup
```bash
# 1. Install dependencies
pnpm install

# 2. Setup environment
cp .env.example .env

# 3. Start PostgreSQL and Redis (via Docker)
docker-compose up -d

# 4. Run typecheck & tests
pnpm typecheck
pnpm test
```
