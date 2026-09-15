---
title: "Local Development Setup"
scope: "second_brain"
category: "operations"
author: "Chief"
tags: [operations, setup, local-dev, runbook]
updated: "2026-09-16"
---

# 💻 Local Development Setup

Cara menjalankan **ATLAS AI OS** di mesin lokal secara native (tanpa Docker). Seluruh perintah di catatan ini diambil dari `package.json` dan skrip di `scripts/` yang benar-benar ada di repo — snapshot **16 Sep 2026**.

> **Niat desain vs kenyataan:** `scripts/dev.mjs` memang launcher native yang membangun TypeScript lalu menyalakan tiga aplikasi inti — dashboard, agent-service, worker — plus `telegram-bot` **hanya bila `TELEGRAM_BOT_TOKEN` terisi** (`scripts/dev.mjs:80-84`). `--check` benar-benar menguji port Postgres/Redis. Tapi beberapa jalur yang tampak "siap pakai" sebenarnya inert — lihat bagian **Status Runtime (16 Sep 2026)** dan peringatan `brain:sync` di bawah.

---

## 📋 Prasyarat

| Kebutuhan | Versi nyata | Sumber |
|---|---|---|
| Node.js | terpasang & dipakai menjalankan sistem: **v24.19.0**; `engines.node` = `>=20.0.0` | `package.json` |
| pnpm | **11.23.0** (`"packageManager": "pnpm@11.23.0"`); `engines.pnpm` = `>=9.0.0` | `package.json` |
| PostgreSQL | 16 (versi produksi memakai image `pgvector/pgvector:pg16`) | `docker-compose.prod.yml` |
| Redis | 7 (versi produksi memakai `redis:7-alpine`) | `docker-compose.prod.yml` |

**Tidak ada prasyarat pgvector.** Ekstensi `vector` tidak aktif di database — 0 kolom bertipe `vector`, ekstensi terpasang hanya `plpgsql, uuid-ossp` (lihat [[Database Migrations & pgvector Setup]] untuk penyebabnya). Instalasi PostgreSQL biasa sudah cukup.

---

## 🧰 Skrip Nyata dari `package.json`

Seluruh perintah memakai **pnpm**, bukan `npm`. Ini daftar skrip akar apa adanya:

| Perintah | Perintah nyata | Yang dijalankan |
|---|---|---|
| `pnpm dev` | `node scripts/dev.mjs` | Build TypeScript (`tsc --build tsconfig.dev.json`, lalu mode `--watch`), cek koneksi TCP Postgres/Redis, lalu menyalakan tiga aplikasi inti (dashboard, agent-service, worker) — `telegram-bot` ikut hanya bila `TELEGRAM_BOT_TOKEN` terisi (`scripts/dev.mjs:80-84`) | 
| `pnpm dev:check` | `node scripts/dev.mjs --check` | Hanya cek dependensi + cetak `Native development dependencies are reachable. Docker is optional.` lalu keluar | 
| `pnpm brain:sync` | `node scripts/sync-vault.mjs` | POST vault ke agent-service (**baca peringatan jujur di bawah**) | 
| `pnpm typecheck` | `turbo run typecheck` | Typecheck seluruh workspace | 
| `pnpm test` | `turbo run test && node --test scripts/native-dev.test.mjs` | Suite workspace + test khusus launcher native | 
| `pnpm lint` | `node scripts/lint.mjs` | Lint kustom (bukan ESLint) | 
| `pnpm format` | `prettier --write .` | Auto-format | 
| `pnpm format:check` | `prettier --check .` | Cek format | 
| `pnpm build` | `turbo run build` | Build produksi seluruh workspace | 
| `pnpm clean` | `turbo run clean && rimraf node_modules` | Bersihkan artefak build |

Catatan kecil dari launcher: pesan error `scripts/dev.mjs` masih menyuruh `run npm run dev again` (sisa teks lama) — pesan itu sendiri tidak mengubah bahwa perintah yang benar adalah `pnpm dev`.

---

## 🚀 Alur Menjalankan Lokal

1. **Pasang dependensi**
   ```bash
   pnpm install
   ```
2. **Siapkan `.env`**
   ```bash
   cp .env.example .env
   ```
   `scripts/dev.mjs` memuat `.env` dari akar repo dan tidak menimpa variabel yang sudah ada di environment.
3. **Cek dependensi tanpa menyalakan apa pun**
   ```bash
   pnpm dev:check
   ```
   `--check` hanya menguji apakah host:port dari `DATABASE_URL` dan `REDIS_URL` bisa dibuka (timeout 1500 ms); bila gagal, proses keluar dengan pesan bahwa Postgres/Redis harus dinyalakan sebagai layanan host — **Docker tidak dijalankan oleh skrip ini**.
4. **Jalankan seluruh service**
   ```bash
   pnpm dev
   ```

### Port & Proses

| Proses | Port | Alamat kesehatan |
|---|---|---|
| `agent-service` (Fastify) | **4000** | `http://127.0.0.1:4000/health` |
| `worker` | **8081** | `http://127.0.0.1:8081/ready` |
| `telegram-bot` | **8082** | `http://127.0.0.1:8082/ready` |
| `dashboard` (Next.js) | **3000** | `http://localhost:3000` |

Sumber: `packages/shared/src/schemas/config.ts:20-23`. Di Windows, `scripts/dev.mjs` sengaja melewati `turbo` karena resolusi shim pnpm/turbo bermasalah di platform itu, tetapi **bukan lewat `pnpm --filter`** — ia menjalankan langsung binary tiap workspace dengan `cwd` di folder aplikasinya (`pnpm exec next dev -p 3000` untuk dashboard, `pnpm exec node --watch dist/index.js` untuk tiga lainnya; `scripts/dev.mjs:195-216`). Bentuk `--filter=` hanya muncul di cabang non-Windows yang memakai turbo (`:222-223`). Komentar lama di `scripts/dev.mjs:193-194` menyebut `--filter` dan tidak lagi sesuai kode.

### Peran proses (penting untuk debugging)

- Hanya **worker** yang mengeksekusi antrian: agent-service dijalankan dengan `processQueue: false` (`apps/agent-service/src/index.ts:31-33`).
- `createAtlasRuntime` adalah composition root tunggal dan dipakai oleh agent-service, worker, **dan** telegram-bot; dashboard tidak menjalankan migrasi/seed (`packages/runtime/src/index.ts:69`).
- Antrian memakai queue `atlas-agent-tasks`, job `agent-task`, `attempts: 3`, backoff eksponensial basis 1000 ms (`packages/orchestration/src/queue/bullmq-task-queue.ts:18-31`).

---

## 🔑 Model Provider: Tiga Dokumen, Tiga Jawaban

Tidak ada satu pun sumber yang konsisten soal model default:

| Sumber | Model default yang diklaim |
|---|---|
| `.env.example:27-30` dan `packages/shared/src/model.ts:2` | `minimax/minimax-m3:free` (OpenRouter) |
| `README.md:86-88` | `openai/gpt-oss-120b` (Groq) |
| `docs/RUNBOOK.md:75` | `z-ai/glm-5.2:free` |

**Yang benar-benar berlaku** (snapshot 16 Sep 2026) adalah baris di database: `provider=openrouter`, `model_name=minimax/minimax-m3:free`, `updated_at=2026-09-03T19:56:48Z`. Sebabnya, resolver provider membaca baris singleton dari `model_provider_settings` (`packages/providers/src/reloadable.ts:26-30`) dan **mengabaikan `MODEL_NAME` dari env** begitu baris itu ada. Jadi mengubah `.env` saja tidak akan mengganti model yang dipakai; ubah lewat dashboard `/settings`.

---

## 🧠 Peringatan Jujur: `pnpm brain:sync` Tidak Membuat Agent Lebih Pintar

`scripts/sync-vault.mjs` memindai folder `vault/`, lalu **mem-POST** ke `http://127.0.0.1:<PORT>/api/v1/brain/ingest` dengan body `{ vaultPath, scope: 'second_brain' }` dan header `Authorization: Bearer <API_AUTH_TOKEN dari .env>`. Kalau agent-service tidak hidup, skrip hanya mencetak daftar file secara lokal (mode validasi offline).

Masalahnya bukan pada skripnya, tetapi pada arsitekturnya:

1. Endpoint `/api/v1/brain/ingest` hanya ada di proses **agent-service** (`apps/agent-service/src/server.ts:324-326`), dan ingest vault otomatis saat boot memang dijalankan di sana (`apps/agent-service/src/server.ts:348`).
2. Agent berjalan di proses **worker**, dan worker **tidak punya `SecondBrainService` sama sekali** — worker bahkan tidak mendaftarkan satu pun tool `second_brain.*` (`apps/worker/src/worker.ts:100-129`).
3. Indeks Second Brain disimpan sebagai `Map` **di dalam memori proses** (`packages/memory/src/second-brain/vault-ingestion-service.ts:25-26`), sehingga hasil sync hilang setiap proses agent-service mati.

**Konsekuensi:** `pnpm brain:sync` mengisi memori proses *agent-service* saja. Worker (tempat agent benar-benar berjalan) tidak akan pernah melihat hasil sync — bahkan bila tool `second_brain.*` kelak didaftarkan. Selain itu `GET /api/v1/brain/stats` selalu mengembalikan `durable: true` **hardcoded** (`apps/agent-service/src/routes/second-brain.ts:44,64,77`), klaim yang tidak benar.

---

## 🧪 Typecheck, Test, Lint, Format

```bash
pnpm typecheck      # turbo run typecheck
pnpm test           # turbo run test && node --test scripts/native-dev.test.mjs
pnpm lint           # node scripts/lint.mjs
pnpm format:check   # prettier --check .
```

---

## 🚦 Status Runtime (16 Sep 2026)

- ✅ `pnpm dev`, `pnpm dev:check`, `pnpm typecheck`, `pnpm test`, `pnpm lint`, `pnpm format`, `pnpm build` **berjalan** sesuai isi `package.json`.
- ✅ Port default 4000 / 8081 / 8082 / 3000 konsisten dengan skema config.
- ⚠️ `pnpm brain:sync` **berfungsi secara teknis tetapi tidak berguna lintas proses** — hasilnya hanya hidup di memori agent-service dan hilang saat proses mati.
- ❌ Pada **host bersih**, langkah pertama setelah `pnpm install` adalah siklus boot yang gagal: runtime menjalankan migrasi saat start, dan migrasi berhenti di `012_scheduled_jobs.sql`. Artinya `pnpm dev` tidak akan pernah sampai menyalakan service di mesin kosong (rincian: [[Database Migrations & pgvector Setup]]).
- ℹ️ Dokumen model default (`.env.example`, `README.md`, `docs/RUNBOOK.md`) tidak sinkron satu sama lain; database memutuskan.

---

## 🔗 Tautan Terkait

- [[030 - Operations & Runbooks MOC]]
- [[Database Migrations & pgvector Setup]]
- [[Production Deployment & Docker]]
- [[Monorepo Layout & Applications]]
- [[Second Brain & Grounded RAG]]

⬅️ Kembali ke [[000 - Home MOC]]
