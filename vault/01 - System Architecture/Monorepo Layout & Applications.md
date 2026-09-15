---
title: "Monorepo Layout & Applications"
scope: "second_brain"
category: "architecture"
author: "Chief"
tags: [atlas, monorepo, pnpm, turbo, applications]
updated: "2026-09-16"
---

# 📂 Monorepo Layout & Aplikasi

> Semua path & nomor baris di bawah diverifikasi pada **16 Sep 2026**.
> Versi runtime yang dipakai: `node v24.19.0`, `pnpm 11.23.0` (dari field `packageManager` di `package.json`).

## 1. Struktur Tingkat Atas

```text
atlas-ai-os/
├── apps/                     # 4 proses yang benar-benar dijalankan
│   ├── agent-service/        # Fastify — REST API + SSE + LISTEN pg_notify
│   ├── worker/               # Konsumen BullMQ + health server :8081
│   ├── telegram-bot/         # Polling getUpdates + health server :8082
│   └── dashboard/            # Next.js App Router — UI operator
├── packages/                 # 11 paket library
│   ├── shared/               # Skema Zod + konfigurasi terpusat
│   ├── database/             # Client, migrasi SQL, repository, seeder
│   ├── events/               # event_outbox + pg_notify + SSE bridge
│   ├── policy/               # ApprovalMatrix, TokenVerifier, DepthGuard
│   ├── observability/        # Logger JSON buatan sendiri, redaksi, AuditRepository
│   ├── agents/               # Definisi 6 agent + registry
│   ├── orchestration/        # Planner, Delegator, Runner, QA Gate, Scheduler
│   ├── memory/               # Memory store + Second Brain (in-process)
│   ├── tools/                # Tool Gateway + implementasi tool
│   ├── providers/            # Adapter LLM (OpenAI-compatible, OpenRouter, Groq, Ollama)
│   └── runtime/              # Composition root: createAtlasRuntime
├── scripts/                  # dev.mjs, sync-vault.mjs, lint.mjs, native-dev.test.mjs
├── docker-compose.yml        # Stack pengembangan
├── docker-compose.prod.yml   # Stack produksi (8 layanan)
└── Caddyfile                 # Reverse proxy produksi
```

**Composition root tunggal**: `createAtlasRuntime` di `packages/runtime/src/index.ts:69`.
Dipakai oleh agent-service, worker, dan telegram-bot. **Dashboard tidak menjalankannya**,
jadi dashboard tidak pernah melakukan migrasi atau seeding.

---

## 2. Empat Aplikasi

### 2.1 `apps/agent-service` — Control Plane (port 4000)

Fastify. Seluruh rute di bawah `/api/*` dilindungi Bearer `API_AUTH_TOKEN` dan rate limiter
Redis (`RedisRateLimiter`, skrip Lua INCR/PEXPIRE, kunci `atlas:api-rate-limit:<ip>`).
Header `x-request-id` dibuat/diteruskan di `apps/agent-service/src/server.ts:102-105`.

Rute yang **benar-benar terdaftar**. Grup di bawah berasal dari `apps/agent-service/src/routes/*.ts`; empat rute terakhir didaftarkan langsung di `apps/agent-service/src/server.ts`:

| Kelompok | Rute |
| :--- | :--- |
| Task | `GET/POST /api/v1/tasks`, `GET /api/v1/tasks/:id` |
| Run | `GET /api/v1/runs/:id`, `POST /api/v1/runs/:id/cancel` |
| Approval | `GET /api/v1/approvals`, `POST /api/v1/approvals/:id/decision` |
| Event | `GET /api/v1/events`, `GET /api/v1/events/stream` (SSE) |
| Kontrol | `GET /api/v1/control`, `POST /api/v1/control/pause`, `/resume`, `/emergency-stop` |
| Biaya | `GET /api/v1/costs` |
| Pesan | `GET /api/v1/messages` |
| Memori | `GET /api/v1/memory`, `GET /api/v1/memory/:id` |
| Rubric | `GET /api/v1/rubrics`, `POST /api/v1/rubrics`, `POST /api/v1/rubrics/:version/activate` |
| Audit | `GET /api/v1/audit` |
| Artefak | `GET /api/v1/artifacts` |
| Tool call | `GET /api/v1/tool-calls` |
| Pemulihan | `GET /api/v1/recovery` |
| Setelan | `GET /api/v1/settings`, `PUT /api/v1/settings/model-provider`, `DELETE /api/v1/settings/model-provider`, `PUT /api/v1/settings/telegram` |
| Second Brain | `POST /api/v1/brain/ingest`, `GET /api/v1/brain/stats`, `GET /api/v1/brain/notes`, `GET /api/v1/brain/notes/:id`, `DELETE /api/v1/brain/notes/:id`, `GET /api/v1/brain/search`, `POST /api/v1/brain/query` |
| Otomasi | `GET /api/v1/automations/health`, `GET/POST /api/v1/automations/scheduled-jobs`, `POST /api/v1/automations/scheduled-jobs/:id/run`, `POST /api/v1/automations/trigger`, `GET /api/v1/automations/workflows/checkpoints` |
| Metadata proses | `GET /health`, `GET /ready`, `GET /api/v1/info`, `GET /api/v1/agents` (terdaftar inline di `apps/agent-service/src/server.ts:225,234,251,261`) |

> ⚠️ **Catatan akurasi**: satu-satunya rute yang sering disebut tetapi **tidak ada** adalah
> `/api/v1/brain/rag`; padanan nyatanya `POST /api/v1/brain/query`. `/api/v1/info` dan
> `/api/v1/agents` justru **ada** — keduanya didaftarkan langsung di `server.ts`, bukan di
> folder `routes/`, sehingga mudah terlewat saat memindai folder itu saja.

**Penting**: agent-service menginisialisasi runtime dengan `processQueue: false`
(`apps/agent-service/src/index.ts:31-33`) — ia hanya menulis job ke Redis, tidak pernah
mengeksekusinya.

### 2.2 `apps/worker` — Execution Plane (health port 8081)

Konsumen BullMQ sebenarnya. Konkurensi: `process(MAX_CONCURRENT_AGENT_RUNS || 3)`
(`apps/worker/src/worker.ts:263-266`). Bila kontrol sistem `paused`, job ditunda
(`defer(job, 5000)`, `:267-290`). Dua peran dijalankan di proses yang sama:

- `role === 'orchestrator'` → `TaskDelegator.executePlan`
- peran lain → `AgentRunner.run` (`:294-304`)

Worker juga menjalankan loop latar: pemulihan antrian tiap
`QUEUE_RECOVERY_INTERVAL_SECONDS` (default 30), tick scheduler tiap
`SCHEDULED_JOB_TICK_INTERVAL_SECONDS` (default 60), sinkronisasi definisi job tiap 30 detik,
serta pemeliharaan memori tiap `MEMORY_MAINTENANCE_INTERVAL_SECONDS` (default 3600).

Di `docker-compose.prod.yml` ada layanan kedelapan, `worker-automation` (profil
`automation`, opt-in), yang memakai image yang sama namun skala replikanya terpisah.

### 2.3 `apps/telegram-bot` — Antarmuka Manusia (health port 8082)

Klien HTTP buatan sendiri (`FetchTelegramApiClient`, `apps/telegram-bot/src/bot.ts:62`)
dengan **polling `getUpdates`** — loop `while (!signal.aborted)` di
`apps/telegram-bot/src/bot.ts:276-282`, dimulai dari `:221` — bukan `grammy`.
Penjaga webhook ada di `:208-210`. Daftar perintah lengkap
ada di [[Telegram Bot Command Reference]].

### 2.4 `apps/dashboard` — Operator UI (port 3000)

Next.js App Router. Halaman: `/`, `/tasks`, `/agents`, `/approvals`, `/artifacts`, `/audit`,
`/brain`, `/communications`, `/settings`. Proxy API sisi-server menyuntikkan Bearer sehingga
token tidak pernah sampai ke browser (`apps/dashboard/src/app/api/atlas/[...path]/route.ts:15-17`).

---

## 3. Paket Library

| Paket | Isi | Catatan akurasi |
| :--- | :--- | :--- |
| `shared` | Skema Zod + `loadConfig` | Sumber tunggal default konfigurasi (`packages/shared/src/schemas/config.ts`) |
| `database` | `DatabaseClient`, `Migrator`, 15 repository, seeder | **Tidak ada tabel vektor** — tidak ada kolom bertipe `vector` |
| `events` | `EventBus` → `event_outbox` + `pg_notify` | Bukan Redis pub/sub |
| `policy` | `ApprovalMatrix`, `TokenVerifier`, `DepthGuard` | Token TTL 3600 s, HMAC deterministik |
| `observability` | `Logger`/`rootLogger` buatan sendiri + `redactSensitive` + `AuditRepository` | **Tanpa Pino**: kelas `Logger` menulis JSON sendiri ke console (`packages/observability/src/logger.ts:34-76`); paket ini hanya bergantung pada `@atlas/shared`. Redaksi berbasis **nama kunci**, bukan pola nilai |
| `agents` | 6 definisi agent + registry | `temperature`/`fallbackTier` tidak pernah dipakai |
| `orchestration` | Planner, Delegator, Runner, QA Gate, Synthesizer, Scheduler | Scheduler punya bug fatal, lihat [[Implementation Status & Known Gaps]] |
| `memory` | `DatabaseMemoryStore` + Second Brain | Second Brain disimpan di `Map` in-process |
| `tools` | `ToolRegistry` + implementasi tool | Hanya sebagian tool yang didaftarkan worker |
| `providers` | Adapter LLM | Tanpa rantai fallback, tanpa jitter |
| `runtime` | `createAtlasRuntime` | Titik boot tunggal |

---

## 4. Skrip Akar (`package.json`)

| Skrip | Perintah |
| :--- | :--- |
| `dev` | `node scripts/dev.mjs` |
| `dev:check` | `node scripts/dev.mjs --check` |
| `brain:sync` | `node scripts/sync-vault.mjs` |
| `lint` | `node scripts/lint.mjs` |
| `typecheck` | `turbo run typecheck` |
| `test` | `turbo run test && node --test scripts/native-dev.test.mjs` |
| `build` | `turbo run build` |
| `format` / `format:check` | Prettier |
| `clean` | `turbo run clean && rimraf node_modules` |

Rincian menjalankan sistem ada di [[Local Development Setup]].

---

## 5. Stack Dashboard (terverifikasi)

Dibaca dari `apps/dashboard/package.json` pada 16 Sep 2026:

| Bagian | Kenyataan |
| :--- | :--- |
| Framework | Next.js `^15.5.24` (App Router), React `^19.0.0` |
| Komponen | MUI `@mui/material ^9.4.0` — **v9, bukan v6**, plus `@mui/icons-material` dan `@mui/material-nextjs` versi sama, `@emotion/react`/`styled` ~11.14 |
| Utility CSS | `tailwindcss ^3.4.17` + `postcss ^8.5.3` + `autoprefixer ^10.4.20`, dikonfigurasi di `apps/dashboard/tailwind.config.js` dan `postcss.config.js` |
| Ikon | `lucide-react ^0.477.0`, `react-icons ^5.7.0` |
| Helper kelas | `tailwind-merge ^3.0.2`, `clsx ^2.1.1` |
| Font | **"Valley Sans"** benar-benar dipakai: impor Google Fonts di `apps/dashboard/src/app/globals.css:1`, dipakai sebagai `font-family` di `:21-22`, dirujuk tema di `apps/dashboard/src/theme/theme.ts:55`, dan `<link>` di `apps/dashboard/src/app/layout.tsx:17` |

> ✅ **Klaim "Circum Icons" itu BENAR** — set ikon Circum dipakai lewat subpath `react-icons/ci`
> (paketnya `react-icons ^5.7.0`, lihat `apps/dashboard/package.json:26`).
> Bukti impor: `apps/dashboard/src/app/page.tsx:15`, `app/agents/page.tsx:13`,
> `app/approvals/page.tsx:15`, `app/artifacts/page.tsx:13`, `app/audit/page.tsx:12`,
> `app/brain/page.tsx:36`, `app/communications/page.tsx:14`, `app/settings/page.tsx:29`,
> `app/tasks/page.tsx:19`, `components/agent-graph.tsx:29`,
> `components/chief-voice-assistant.tsx:20`, `components/formatted-message.tsx:13`,
> `components/sidebar.tsx:25`, `components/workflow-live-stream.tsx:25`.
> Catatan koreksi: catatan ini sebelumnya menyatakan "tidak ada Circum Icons" — itu salah,
> keliru membaca `package.json` (yang memang tidak menyebut set ikon satu per satu).

---

## 6. Tautan Terkait

- [[010 - System Architecture MOC]]
- [[ATLAS AI OS Blueprint]]
- [[Task & Execution Pipeline]]
- [[Second Brain & Grounded RAG]]
- [[Production Deployment & Docker]]

---

⬅️ Kembali ke [[000 - Home MOC]]
