---
title: "Observability & Audit Trail"
scope: "second_brain"
category: "architecture"
author: "Chief"
tags: [atlas, observability, audit, logging, events, architecture]
updated: "2026-09-16"
---

# 📡 Observability & Audit Trail

> Diverifikasi terhadap kode dan database hidup pada **16 Sep 2026**.

---

## 1. Empat Lapis Observabilitas

| Lapis | Mekanisme | Tujuan |
| :--- | :--- | :--- |
| **Log terstruktur** | `Logger` JSON buatan sendiri + `redactSensitive` | Diagnosa operasional |
| **Event domain** | `event_outbox` + `pg_notify` | Aliran keadaan real-time ke UI |
| **Audit** | `audit_events` append-only | Kepatuhan & forensik |
| **Metrik biaya** | `budgets`, `budget_reservations`, `runs.cost_usd` | Pengendalian anggaran |

---

## 2. Log Terstruktur

- **Bukan Pino.** Logger adalah kelas `Logger` buatan sendiri di
  `packages/observability/src/logger.ts:34-74`; ia membangun objek `{ timestamp, level, message, context }`,
  men-`JSON.stringify`, lalu menulis ke `console` sesuai level (`:49-56`). `rootLogger`
  hanyalah instance tunggal dari kelas itu (`:76`). Paket `@atlas/observability` hanya
  bergantung pada `@atlas/shared` — **tidak ada `pino` di dependensinya**; `pino` hanya
  muncul di `pnpm-lock.yaml` sebagai dependensi transitif Fastify, dan Fastify di sini
  dibangun dengan `logger: false` (`apps/agent-service/src/server.ts:71`).
- **Korelasi**: header `x-request-id` diteruskan/dibuat di
  `apps/agent-service/src/server.ts:102-105`, lalu disertakan pada konteks log (`:141`).
- **Redaksi** dilakukan berdasar **nama kunci**, bukan pola nilai
  (`packages/observability/src/logger.ts:11`):

```
password, token, secret, apiKey, api_key, authorization, encryption_key, bot_token
```

> ⚠️ Karena pencocokannya per nama kunci, rahasia yang disimpan di kunci dengan nama lain
> akan lolos ke log. Redaksi ini bukan jaminan.

---

## 3. Event Domain

### 3.1 Jalur Tulis

`packages/events/src/bus.ts:63-82` — dalam satu transaksi dengan perubahan datanya:

```sql
INSERT INTO event_outbox (...) VALUES (...) ON CONFLICT (event_id) DO NOTHING;
SELECT pg_notify('atlas_events', <payload>);
```

`ON CONFLICT DO NOTHING` menjadikan `event_id` sebagai kunci idempotensi publikasi.

> ⚠️ Versi lama catatan ini menyebut "Fastify event bus". Yang benar: **tidak ada bus
> in-memory dan tidak ada Redis pub/sub**. Redis hanya dipakai untuk BullMQ dan rate limiter
> API (`atlas:api-rate-limit:<ip>`, skrip Lua INCR/PEXPIRE).

### 3.2 Jalur Baca

1. agent-service `LISTEN atlas_events` — `EventBus.startListener`
   (`packages/events/src/bus.ts:102-107`, dipicu `subscribe` di `:86`).
2. Fan-out ke klien via SSE di `apps/agent-service/src/routes/events.ts:32-81`:
   - format baris `id:` / `event:` / `data:`,
   - komentar heartbeat `: ` setiap **15 detik** (menjaga koneksi proxy tetap hidup),
   - pemulihan setelah putus lewat header `Last-Event-ID` → `eventRepo.listAfterId`,
     sehingga event yang terlewat dapat dikirim ulang tanpa kehilangan riwayat.

### 3.3 Nama Event yang Benar

Memakai **titik**, bukan titik dua. Bukti: isi `event_outbox` per 16 Sep 2026.

| Event | Jumlah |
| :--- | :--- |
| `run.started` | 106 |
| `run.turn_completed` | 73 |
| `run.completed` | 70 |
| `task.updated` | 63 |
| `task.created` | 55 |
| `task.completed` | 40 |
| `run.failed` | 34 |
| `message.created` | 21 |
| `task.failed` | 10 |
| `approval.*` | **0** |
| `tool.*` | **0** |
| `artifact.created` | **0** |

> ⚠️ Catatan versi lama memakai gaya `task:created`. Gaya itu tidak pernah muncul di DB.
> Tidak adanya `tool.*` konsisten dengan registry tool yang dibangun **tanpa `eventBus`**
> di jalur worker.

---

## 4. Audit Trail

- `audit_events` bersifat **append-only** lewat `AuditRepository`
  (`packages/observability/src/audit.ts`); detailnya melewati `redactSensitive` (`:35`).
- `tool_calls` mencatat setiap pemanggilan tool: nama tool, input, hasil, status.
  Snapshot 16 Sep 2026: **total 5 baris** — `memory.search` (2 sukses, 1 gagal),
  `artifacts.write` (1), `artifacts.read` (1).
  → `web.*`, `lead.*`, `communication.*`, `company.*` **belum pernah dieksekusi sekali pun**.
- Endpoint pembacaan: `GET /api/v1/audit`, `GET /api/v1/tool-calls`, `GET /api/v1/recovery`.

### 4.1 Celah Audit yang Diketahui

| Celah | Anchor |
| :--- | :--- |
| Aktor approval diambil dari header `x-actor-id` yang dikendalikan pemanggil | `apps/agent-service/src/routes/approvals.ts:54-56` |
| `PUT /api/v1/settings/telegram` menulis ulang berkas `.env` di disk | `apps/agent-service/src/server.ts:422-440` |
| Tidak ada event `tool.*`, sehingga pemanggilan tool tidak terlihat di aliran real-time | bukti DB §3.3 |

---

## 5. Pemantauan Biaya

### 5.1 Model Anggaran

| Objek | Perilaku |
| :--- | :--- |
| `budgets` | Baris `global_daily` (limit $5/hari) dan baris `task` dengan `period = 'per_run'` |
| `budget_reservations` | Reservasi sebelum run; status `committed` / `released` |
| Plafon per run | `totalCostUsd >= maxCostUsd` → `throw` (`packages/orchestration/src/engine/agent-runner.ts:361-364`) |
| Plafon harian | `GLOBAL_DAILY_BUDGET_USD`, default **5.0** (`packages/shared/src/schemas/config.ts:63`) |

### 5.2 Kondisi Nyata (penting)

- Reservasi **berjalan benar**: 106 run menghasilkan 104 reservasi `committed` + 2 `released`,
  dan `SUM(runs.cost_usd)` = **$0.0130** — cocok persis dengan ledger.
- **Tetapi akuntansinya tidak bernilai finansial.** `packages/providers/src/openrouter.ts:18-19`
  meng-hardcode `inputCostPerMillion: 0, outputCostPerMillion: 0`.
- Dari 106 run, 68 punya `input_tokens > 0`, namun hanya **10** yang punya `cost_usd > 0` —
  semuanya pada 31 Agu ($0.0045) dan 1 Sep ($0.0085), yaitu **sebelum** baris konfigurasi
  singleton ditulis (3 Sep 2026).
- Konfigurasi aktif sekarang: `provider = openrouter`, `model_name = minimax/minimax-m3:free`
  (`updated_at = 2026-09-03T19:56:48Z`).
- **Akibatnya**: sejak 3 Sep setiap run berbiaya $0.0000, sehingga plafon per run maupun
  `GLOBAL_DAILY_BUDGET_USD` **tidak akan pernah menyala**.
- Baris `global_daily` yang ada: 29 Agu (terpakai $0.0044), 1 Sep ($0.0086), 3 Sep ($0),
  4 Sep ($0).

> ⚠️ Dua koreksi terhadap versi lama: default anggaran harian adalah **$5, bukan $10**;
> dan **tidak ada notifikasi Telegram** saat anggaran terlampaui — mekanisme itu tidak ada
> di kode.

---

## 6. Observabilitas di Dashboard

Halaman yang tersedia: `/`, `/tasks`, `/agents`, `/approvals`, `/artifacts`, `/audit`,
`/brain`, `/communications`, `/settings` (lihat [[Monorepo Layout & Applications]]).

Cara kerja: proxy API sisi-server menyuntikkan Bearer sehingga token tidak pernah sampai ke
browser (`apps/dashboard/src/app/api/atlas/[...path]/route.ts:15-17`).

### 6.1 Keterbatasan yang Terverifikasi

| Keterbatasan | Anchor / bukti |
| :--- | :--- |
| JSON tool mentah bocor ke antarmuka di `/` dan `/tasks` | `apps/dashboard/src/components/workflow-live-stream.tsx:561-572` |
| Teks **hardcoded** "27 synced markdown notes in vault vector store" — angka statis, bukan hasil kueri, dan menyebut "vector store" yang tidak ada | `apps/dashboard/src/components/agent-graph.tsx:673` |
| Roster agent di-hardcode di 4 berkas berbeda | — |
| Satu `EventSource` dibuat per kartu task yang dibuka (pemborosan koneksi) | — |
| SSE hanya dilanggan di `/`, `/tasks`, `/communications`, dan `WorkflowLiveStream` | — |

> `apps/agent-service/src/routes/second-brain.ts:44,64,77` juga mengembalikan `durable: true`
> secara hardcoded — nilai yang tampil di UI tidak selalu berasal dari pengukuran.
> Sebelum mempercayai angka apa pun di layar, telusuri dulu apakah nilainya dihitung atau
> ditulis tetap.

---

## 7. Diagnosa Cepat

| Gejala | Periksa |
| :--- | :--- |
| Task tidak bergerak | `GET /api/v1/tasks/:id`, `GET /api/v1/control` (apakah `paused`?) |
| Run gagal massal | `GET /api/v1/runs/:id` → apakah kegagalan kredensial provider? |
| UI tidak menerima pembaruan | koneksi SSE `/api/v1/events/stream` + `GET /api/v1/events` |
| Biaya mencurigakan | `GET /api/v1/costs` — ingat tarif provider saat ini nol |
| Pekerjaan macet setelah restart | `GET /api/v1/recovery` → `recoverStaleRuns` menandai run `failed` |

---

## 8. Tautan Terkait

- [[010 - System Architecture MOC]]
- [[ATLAS AI OS Blueprint]]
- [[Task & Execution Pipeline]]
- [[AI Model Provider Landscape]]
- [[Disaster Recovery & Lease Watchdog]]
- [[Implementation Status & Known Gaps]]

---

⬅️ Kembali ke [[000 - Home MOC]]
