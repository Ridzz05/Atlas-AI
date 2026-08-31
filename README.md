# ATLAS AI OS

Multi-agent Personal AI Operating System powered by durable task orchestration, shared Second Brain knowledge vault, controlled delegation, human approval gates, and real-time observability.

---

## Key Highlights

- **Single Root Entry Point**: You interact directly with **Chief**, who plans, decomposes goals, delegates tasks to specialists, and synthesizes final answers.
- **Specialist Agent Fleet**:
  - **Ned** (Research Specialist): Evidence-backed search and structured investigation.
  - **Layla** (Lead Scoring): Deterministic ICP qualification and versioned rubric analysis.
  - **Hermes** (Content Specialist): Document drafting, meeting agendas, and marketing copy.
  - **Argus** (QA & Risk Gate): Quality assurance checklists, policy enforcement, and verification.
- **Second Brain & Grounded RAG**:
  - Dense vector embeddings and semantic search powered by `pgvector`.
  - Automated Markdown knowledge vault ingestion and chunking.
  - Transparent citation inspector with relevance scores and grounded excerpts.
- **High-Performance Inference Providers**:
  - Direct support for **Groq** (ultra-fast LPU inference: `openai/gpt-oss-120b`, `llama-3.3-70b-versatile`), **OpenRouter**, **OpenAI-compatible**, **Ollama**, and **DeepSeek**.
  - Built-in rate limit handling (`HTTP 429`), upstream `retry-after` header parsing, and exponential backoff.
- **Human Approval Control Room**:
  - One-time token validation and safety gating for sensitive external side-effects.
- **Modern Command Center Dashboard**:
  - Built with Next.js 15 App Router, Material UI, and Tailwind CSS.
  - Clean typography featuring **Valley Sans** and minimalist iconography with **Circum Icons** (`react-icons/ci`).
  - Real-time SSE event stream and rich Markdown message formatting.
- **Durable Scheduling & Cron Automation**:
  - Built-in background job scheduler and BullMQ worker queue with lease recovery.

---

## Monorepo Architecture

```text
atlas-ai-os/
├── apps/
│   ├── agent-service/            # Fastify orchestration API and SSE event bus
│   ├── worker/                   # BullMQ agent execution workers and scheduled jobs
│   ├── dashboard/                # Next.js Command Center and Second Brain UI
│   └── telegram-bot/             # Telegram bot interface (webhook / polling)
├── packages/
│   ├── shared/                   # Zod schemas, contract types, and configuration
│   ├── database/                 # PostgreSQL migrations, repositories, and pgvector
│   ├── events/                   # Event schemas and pub/sub event bus
│   ├── policy/                   # Permissions, approval rules, and depth limits
│   ├── observability/            # Structured logging, telemetry, and audit events
│   ├── agents/                   # Agent definitions, system prompts, and personas
│   ├── orchestration/            # Planner, router, scheduled job scheduler, and synthesis
│   ├── memory/                   # Second Brain retrieval, RAG, and memory tools
│   ├── tools/                    # Tool gateway, sandboxed executions, and rubrics
│   └── providers/                # LLM provider adapters (Groq, OpenRouter, OpenAI)
├── docker-compose.yml
└── pnpm-workspace.yaml
```

---

## Quick Start (Development)

### Prerequisites
- Node.js >= 20
- pnpm >= 9
- PostgreSQL 16 with the `pgvector` extension
- Redis 7

### Installation & Setup

1. **Clone and install dependencies**:
   ```bash
   git clone https://github.com/Ridzz05/Atlas-AI.git
   cd Atlas-AI
   pnpm install
   ```

2. **Configure environment**:
   ```bash
   cp .env.example .env
   ```
   Set your database credentials, Redis URL, and chosen model provider in `.env`:
   ```env
   DATABASE_URL=postgresql://atlas:atlas@localhost:5432/atlas
   REDIS_URL=redis://localhost:6379
   
   # Model Provider (Groq / OpenRouter / OpenAI)
   MODEL_PROVIDER=groq
   MODEL_API_KEY=gsk_your_groq_api_key_here
   MODEL_NAME=openai/gpt-oss-120b
   ```

3. **Check connectivity**:
   ```bash
   npm run dev:check
   ```

4. **Start the development suite**:
   ```bash
   npm run dev
   ```

   Once started, the following services are available:
   - **Dashboard**: `http://localhost:3000`
   - **Fastify API**: `http://127.0.0.1:4000/health`
   - **Worker Health**: `http://127.0.0.1:8081/ready`
   - **Telegram Bot**: Activated automatically when `TELEGRAM_BOT_TOKEN` is set.

---

## Verification & Testing

To verify the whole monorepo:

```bash
# Run unit and integration tests
pnpm test

# Check TypeScript types across all workspaces
pnpm typecheck

# Build all packages and applications
pnpm build
```

---

## License

MIT License. Crafted for resilient personal AI workflows.
