---
title: "Implementation Status & Known Gaps"
scope: "second_brain"
category: "architecture"
author: "Chief"
tags: [atlas, status, gaps, defects, audit, verification]
updated: "2026-09-16"
---

# 🚧 Implementation Status & Known Gaps

> **Cara membaca catatan ini.** Semua butir di bawah sudah diverifikasi langsung: dibaca dari
> kode, atau dibuktikan lewat eksekusi probe terhadap kode yang sudah dibangun, atau
> disimpulkan dari kueri database hidup pada **16 Sep 2026**.
>
> Label tingkat dampak:
> - 🔴 **Boot-blocker** — mencegah sistem berjalan pada host bersih.
> - 🟠 **Eksekusi salah** — sistem berjalan, tetapi berperilaku tidak sesuai maksud.
> - 🟡 **Inert** — kode ada, dikonfigurasi, tetapi tidak pernah berpengaruh.
> - 🔵 **Kebersihan** — tidak berbahaya, menghambat pemahaman.

---

## 1. Snapshot Runtime (16 Sep 2026)

| Metrik | Nilai |
| :--- | :--- |
| Task | 55 (40 `completed`, 10 `failed`, **5 macet `running`**) |
| Run | 106 (70 `completed`, 36 `failed`) |
| Agent terdaftar | 6 |
| Pesan | 266 |
| `tool_calls` | **5** seumur platform |
| `approvals` | **0** |
| `scheduled_jobs` | **0** |
| `memory_items` / `memory_embeddings` | **0** / **0** |
| `workflow_checkpoints` / `idempotency_keys` | **0** / **0** |
| Total biaya tercatat | **$0.0130** |
| Jendela data run | 28 Agu 2026 18:50 UTC → 3 Sep 2026 20:23 UTC |

Distribusi run per agent: chief 54, argus 22, ned 15, hermes 13, layla 2, **luna 0**.

---

## 2. 🔴 Cacat Boot-Blocker: Migrasi `012` Menggagalkan Seluruh Rantai

### Bukti
Menjalankan `Migrator` asli (`packages/database/dist/migrator.js` + `DatabaseClient`)
terhadap **schema bersih**:

```
001 .. 011  → diterapkan
012_scheduled_jobs.sql → ERROR: column "enabled" does not exist
runMigrations THREW
013, 014   → TIDAK PERNAH DITERAPKAN
```

Akibatnya pada host bersih: tabel `idempotency_keys` dan `workflow_checkpoints`
**tidak pernah ada**.

### Sebab
- `packages/database/src/migrations/001_initial_schema.sql:254-265` **sudah** membuat tabel
  `scheduled_jobs` dengan kolom `cron_expression`, `agent_id`, `is_active`.
- `packages/database/src/migrations/012_scheduled_jobs.sql` mendeklarasikan ulang
  `CREATE TABLE IF NOT EXISTS scheduled_jobs` dengan bentuk **berbeda**
  (`job_type`, `cron_pattern`, `assigned_agent`, `enabled`, `created_by`, `last_error`),
  lalu menjalankan `CREATE INDEX ... ON scheduled_jobs (enabled)`.
- Karena `IF NOT EXISTS`, tabel baru **tidak** dibuat, sehingga kolom `enabled` tidak ada
  dan pembuatan index gagal.

### Dampak berantai
`packages/database/src/migrator.ts:79-100` melakukan `ROLLBACK` dan **melempar** error.
`packages/runtime/src/index.ts:73-76` **tidak menangkapnya** → composition root gagal →
**agent-service, worker, dan telegram-bot menolak boot**.

### Mengapa database saat ini terlihat sehat
Baris `012` tercatat di `schema_migrations` (timestamp `2026-08-31T22:31:27Z`), dan bentuk
tabelnya mengikuti versi 012 — artinya DB yang berjalan sekarang pernah dibangun ulang atau
diperbaiki manual setelah 31 Agu. **Database lokal yang sehat bukan bukti migrasi bersih.**

### Arah perbaikan
Selaraskan `012` dengan bentuk tabel di `001` (atau hapus `CREATE TABLE` di `012` dan ubah
menjadi `ALTER TABLE` bersih), lalu uji `runMigrations` pada schema kosong sebelum dianggap
selesai.

---

## 3. 🟠 Cacat Eksekusi: Cron Menembak Berulang Setiap Tick

### Bukti
Memuat `packages/orchestration/dist/scheduler/scheduled-job-scheduler.js` dengan repo palsu,
satu job, `cronPattern: '0 9 * * *'`, `nextRunAt: null`:

```
dispatch saat start : 1
tick 1              : 1
tick 2              : 1
tick 3              : 1
→ 4 task dari 1 job dalam 4 tick; nextRunAt tetap null
```

### Sebab
`packages/orchestration/src/scheduler/scheduled-job-scheduler.ts:16-24`
(ter-emit di `dist/.../scheduled-job-scheduler.js:7`):

```ts
const dynamicRequire = (0, eval)('require');
```

Indirect eval **kehilangan scope modul**, sehingga `require` bukan global dan muncul
`ReferenceError`. Error itu ditelan `catch`, sehingga parser cron mengembalikan `null`.
Rantai akibatnya:
- `dispatch` menulis `recordRun(job.id, this.nextRunCalculator(job), undefined)` dengan hasil
  `null` (`packages/orchestration/src/scheduler/scheduled-job-scheduler.ts:239`);
- `isDue` membaca `null` sebagai "belum pernah jalan" dan mengembalikan `true` (`:145`).

### Kontrol yang membuktikan ekspresinya benar
`cron-parser` yang di-`require` langsung dari paket yang sama mengembalikan
`2026-09-16T02:00:00.000Z` untuk ekspresi identik. Jadi masalahnya bukan pada ekspresi cron,
melainkan pada mekanisme pemuatannya.

### Tingkat risiko
**Laten, belum aktif**: `scheduled_jobs` berisi **0 baris** per 16 Sep 2026. Namun
`AUTOMATION_ENABLED` dan `WORKFLOW_AUTOMATION_ENABLED` keduanya **default `true`**
(`packages/shared/src/schemas/config.ts:60-61`), sehingga begitu satu job ditambahkan,
sistem akan membanjiri antrian.

Rincian konteks ada di [[Scheduled Jobs & Cron Automations]].

---

## 4. 🟡 Cacat Kontrol: Akuntansi Anggaran Benar, Tetapi Tidak Bernilai Finansial

### Yang bekerja
Reservasi anggaran benar-benar jalan: 106 run menghasilkan 104 reservasi `committed` +
2 `released`, dan `SUM(runs.cost_usd)` = **$0.0130** — cocok persis dengan ledger.

### Yang tidak bekerja
`packages/providers/src/openrouter.ts:18-19` meng-hardcode:

```ts
inputCostPerMillion: 0,
outputCostPerMillion: 0
```

Akibatnya:
- 68 dari 106 run punya `input_tokens > 0`, tetapi hanya **10** yang `cost_usd > 0`;
- kesepuluh run itu terjadi 31 Agu ($0.0045) dan 1 Sep ($0.0085) — **sebelum** baris
  konfigurasi singleton ditulis pada 3 Sep 2026;
- konfigurasi aktif sekarang (`provider=openrouter`, `model_name=minimax/minimax-m3:free`)
  membuat setiap run berbiaya **$0.0000**.

### Dampak
Dua pengaman anggaran menjadi **inert**:
- plafon per run `totalCostUsd >= maxCostUsd`
  (`packages/orchestration/src/engine/agent-runner.ts:361-364`);
- plafon harian `GLOBAL_DAILY_BUDGET_USD` (default **5.0**,
  `packages/shared/src/schemas/config.ts:63`).

Baris `global_daily` yang ada: 29 Agu ($0.0044 terpakai), 1 Sep ($0.0086), 3 Sep ($0),
4 Sep ($0).

Catatan tambahan: **tidak ada notifikasi Telegram** saat anggaran terlampaui — mekanisme
itu tidak ada di kode. Lihat [[Observability & Audit Trail]].

---

## 5. 🟠 Cacat Integrasi: Agent Tidak Dapat Mengakses Second Brain

Tiga fakta yang saling mengunci:

1. Indeks Second Brain disimpan di `Map` **in-process**
   (`packages/memory/src/second-brain/vault-ingestion-service.ts:25-26`).
2. `SecondBrainService` hanya diinstansiasi di agent-service
   (`apps/agent-service/src/server.ts:324-326`) dan di test — **tidak pernah di worker**.
3. Tool `second_brain.*`
   (`packages/tools/src/tools/second-brain-tools.ts:7,67,123,170,215`)
   **tidak didaftarkan** di `apps/worker/src/worker.ts:100-129`.

Agent berjalan di worker, indeks hidup di agent-service. Karena itu `pnpm brain:sync` tidak
pernah terlihat oleh agent, dan indeks itu hilang setiap proses dimatikan.

Ditambah lagi: **pgvector tidak pernah aktif.** Verifikasi DB: 0 kolom bertipe `vector`,
ekstensi hanya `plpgsql, uuid-ossp`, `memory_embeddings.embedding` bertipe `jsonb`, dan
`memory_items` 0 baris. Penyebabnya `001_initial_schema.sql:6-12` membungkus
`CREATE EXTENSION vector` dalam blok yang menelan semua exception.

Sementara itu `GET /api/v1/brain/stats` mengembalikan `durable: true` secara hardcoded
(`apps/agent-service/src/routes/second-brain.ts:44,64,77`).

Lihat [[Second Brain & Grounded RAG]].

---

## 6. 🟡 Konfigurasi yang Dideklarasikan Tetapi Tidak Pernah Dikonsumsi

| Item | Kenyataan |
| :--- | :--- |
| `modelPolicy.temperature` | Tidak pernah diteruskan ke provider; semua agent efektif memakai default provider 0.2 |
| `modelPolicy.fallbackTier` | Tidak dibaca kode mana pun — **tidak ada rantai fallback antar model/provider** |
| `modelPolicy.preferredTier` hasil seeding | Dipersistensi ke kolom `model_policy` (`packages/database/src/agent-seeder.ts:7`), tetapi tidak dibaca saat eksekusi. `ModelPolicySchema` hanya punya `preferredTier`, `fallbackTier`, `temperature` — tidak ada field `model` (`packages/shared/src/schemas/agent.ts:6-10`) |
| `MAX_DELEGATION_DEPTH` | `DepthGuard` ada, tetapi `depth` tidak pernah dipersistensi → praktis no-op |

**Yang benar-benar ditegakkan**: `limits.maxTurns`
(`agent-runner.ts:298`), `limits.timeoutSeconds` (`:142-147`), dan `limits.maxCostUsd`
(`:361-364`).

**Dimensi yang hilang di data**: seluruh 55 task berstatus `depth = 0` — termasuk 42 task
yang punya `parent_id`. `task-delegator.ts:203` menghitung depth anak, tetapi
`taskRepo.create` tidak menyimpannya.

---

## 7. 🟠 Tool yang Dideklarasikan di Allowlist Agent Tetapi Tidak Terdaftar

Didaftarkan worker (`apps/worker/src/worker.ts:100-129`):
`web.search`, `web.fetch_safe`, `company.lookup`, `lead.enrich`, `lead.score`,
`policy.verify`, `communication.create_draft`, `communication.send_approved`, tool memory
(`memory.search`, `memory.get`, `memory.propose_write`), tool artefak
(`artifacts.read`, `artifacts.write`).

Tidak terdaftar, sehingga pemanggilannya gagal dengan
`Tool '<x>' not found in Tool Gateway registry.`:

- seluruh `second_brain.*` (dideklarasikan untuk Chief, Ned, Luna, Argus),
- seluruh `tasks.*` (dideklarasikan untuk Chief),
- `approvals.request` (Chief),
- `brand.get_voice` (Hermes).

Bukti pendukung: sepanjang 106 run hanya tercatat **5** pemanggilan tool, dan **tidak satu
pun** berupa `web.*`, `lead.*`, `company.*`, atau `communication.*`.

---

## 8. 🟡 Fitur yang Ada Tetapi Inert

| Fitur | Mengapa inert |
| :--- | :--- |
| Tahap planner / QA / synthesizer | `stageRunner` dibangun **tanpa `toolExecutor`** (`packages/orchestration/src/delegator/task-delegator.ts:72-81`) → tidak dapat memanggil tool apa pun, termasuk `policy.verify` milik Argus |
| Tool call dari agent-service | `AgentRunner`/`TaskDelegator` di agent-service dibangun tanpa `toolExecutor` (`apps/agent-service/src/server.ts:156-181`); karena `processQueue: false`, jalur itu tidak dieksekusi |
| Idempotensi komunikasi | Dideklarasikan (`packages/tools/src/tools/communication-tools.ts:20-33`, `idempotency: 'required'`), tetapi tidak ada `IdempotencyStore` di `ToolContext`; `idempotency_keys` 0 baris |
| Pengiriman komunikasi | `communicationSender` tidak pernah diisi → `send_approved` gagal dengan `No outbound communication connector configured.` |
| `workflow_checkpoints` (migrasi 014) | 0 baris. `WorkflowRuntime.start` — satu-satunya jalur yang **membuat** checkpoint — tidak dipanggil kode produksi mana pun (hanya test); `ResumeDriver` memang dijalankan worker, tetapi tidak menemukan apa pun untuk di-resume |
| `revision_requested` | Tidak punya kelanjutan — status buntu |
| Pemulihan task `running` yatim | `recoverQueuedTasks` hanya memulihkan status `queued` → **5 task macet `running`** permanen |
| Event `tool.*` dan `artifact.created` | Registry tool di worker dibangun **tanpa `eventBus`** → tidak pernah dipublikasikan |
| Notifikasi approval | `ApprovalCardRenderer` hanya dipakai di test; `sendMessage` tanpa `reply_markup` |
| Kedaluwarsa approval | Lazy saja, tanpa sweeper → task bisa menggantung selamanya |

---

## 9. 🟠 Kegagalan Runtime Terukur

Dari 36 run gagal:

| Penyebab | Jumlah |
| :--- | :--- |
| `OpenRouter HTTP 401 "User not found"` | 15 |
| `MODEL_API_KEY_MISSING` | 12 |
| `HTTP 429` (rate limit) | 3 |
| `Worker lease expired` | 2 |
| OpenRouter 402 / 429 / 502 | 1 masing-masing |
| `Invalid input for tool 'memory.search': expected array, received string` | 1 |

**27 dari 36 (75%) murni masalah kredensial provider** — bukan kegagalan logika
orkestrasi. Dampak turunan: 35 run punya `turns_count = 0`, dan `turns_count` maksimum yang
pernah tercapai adalah 3. Durasi run gagal terpanjang 1147 detik.

Diagnosa: satu kegagalan juga berasal dari **skema input tool yang tidak cocok** dengan
parameter yang dikirim model (`memory.search` menerima string, mengharapkan array) —
indikasi deskripsi tool perlu dipertegas.

---

## 10. 🟠 Kelemahan Keamanan & Audit

| Butir | Anchor |
| :--- | :--- |
| `x-actor-id` pada approval dikendalikan pemanggil → audit tidak tepercaya | `apps/agent-service/src/routes/approvals.ts:54-56` |
| `PUT /api/v1/settings/telegram` menulis ulang `.env` di disk | `apps/agent-service/src/server.ts:422-440` |
| Allowlist Telegram fail-open bila `TELEGRAM_ALLOWED_USER_IDS` kosong | `apps/telegram-bot/src/security/guard.ts:19-22` — guard sendiri tanpa cek `NODE_ENV`; yang mencegahnya di produksi adalah `apps/telegram-bot/src/config.ts:20-21` yang menolak boot |
| Jalur Chromium hanya memvalidasi bentuk URL, tanpa cek DNS, dan berjalan `--no-sandbox` | `packages/tools/src/research/chromium-provider.ts:220-222` (validasi) vs `packages/tools/src/research/safe-web-fetcher.ts:142-144` (cek DNS yang **tidak** ada di Chromium), `:76-77` (`--no-sandbox`, `--disable-setuid-sandbox`) |
| `registerLegacy` menandai tool jaringan sebagai `sideEffects: ['none']` | `packages/tools/src/registry.ts:86-110` |
| Redaksi log berbasis nama kunci saja | `packages/observability/src/logger.ts:11` |

Rincian ada di [[Policy, Security & Approval Gates]].

---

## 11. 🔵 Kebersihan Dokumentasi Repositori

Beberapa dokumen di repositori **tidak dapat dipercaya** dan sebaiknya tidak dijadikan
rujukan:

| Berkas | Masalah |
| :--- | :--- |
| `docs/DESIGN.md`, `docs/design-systems/*/DESIGN.md` | Dump vendor (MUI, HashiCorp) — tidak berkaitan dengan aplikasi ini |
| `README.md` | Menyebut model default Groq `openai/gpt-oss-120b` (`README.md:86-88`) |
| `docs/RUNBOOK.md` | Menyebut model default `z-ai/glm-5.2:free` (`docs/RUNBOOK.md:75`) |
| `.env.example` + `packages/shared/src/model.ts:2` | Menyebut `minimax/minimax-m3:free` (`MODEL_NAME` di `.env.example:30`) |

⇒ **Tiga dokumen berbeda menyebut model default yang berbeda.** Yang benar-benar berlaku di
database saat ini: `provider = openrouter`, `model_name = minimax/minimax-m3:free`.

Sumber yang **akurat** untuk penilaian mandiri: `docs/UPDATE.md:880-950` (950 baris total)
dan `tasks/plan.md`.

Tambahan: UI dashboard memiliki teks hardcoded yang menyesatkan —
`apps/dashboard/src/components/agent-graph.tsx:673` menulis "27 synced markdown notes in
vault vector store", padahal angkanya statis dan tidak ada vector store.

---

## 12. ✅ Yang Terbukti Bekerja

Agar penilaian tetap seimbang, ini daftar yang **benar-benar berfungsi**:

1. **Intake atomik** — task + pesan dalam satu transaksi, mencegah task yatim.
2. **Gerbang kontrol** — `paused`/emergency-stop menolak intake dengan HTTP 423 dan menunda
   job lewat `defer`.
3. **Antrian BullMQ** — `attempts: 3`, backoff eksponensial, `jobId` stabil.
4. **Lease & heartbeat** — 60 detik / 30 detik, dengan pembatalan saat lease hilang
   (terbukti lewat 2 run `Worker lease expired`).
5. **Reservasi anggaran** — ledger cocok persis dengan total biaya run.
6. **Gerbang tool berlapis** — registri, allowlist, dan `ApprovalMatrix` semuanya aktif.
7. **Lima aksi terblokir permanen** dan enam aksi wajib approval manusia
   (`packages/policy/src/approval-matrix.ts:34-49`).
8. **Aliran event end-to-end** — `event_outbox` → `pg_notify` → SSE → dashboard, lengkap
   dengan replay `Last-Event-ID` dan heartbeat 15 detik.
9. **Audit append-only** dengan redaksi rahasia berbasis nama kunci.
10. **Migrasi berbasis lock** — advisory lock `2147483646` mencegah dua migrator berjalan
    bersamaan; setiap berkas dieksekusi dalam transaksi sendiri.
11. **Pemulihan run terbengkalai** — `recoverStaleRuns` menandai run mati sebagai `failed`
    dan membersihkan kolom lease.
12. **Seeding idempoten** — 6 agent + rubric default dipastikan ada saat boot.
13. **Rubric engine** — validasi Zod yang benar-benar menegakkan total bobot 100 dan
    `qualified > needsReview`, dengan penurunan status bila bukti tidak lengkap.

---

## 13. Prioritas Perbaikan

| Prioritas | Tindakan | Alasan |
| :--- | :--- | :--- |
| 1 | Perbaiki migrasi `012` agar host bersih bisa boot | 🔴 memblokir instalasi baru |
| 2 | Ganti `(0, eval)('require')` dengan import statis di scheduler | 🟠 akan membanjiri antrian begitu cron dipakai |
| 3 | Isi tarif OpenRouter yang sebenarnya | 🟡 tanpa ini pengaman anggaran tidak berarti |
| 4 | Persistensi `depth` pada `taskRepo.create` | 🟡 mengaktifkan `DepthGuard` |
| 5 | Pindahkan indeks Second Brain ke penyimpanan bersama + daftarkan toolnya di worker | 🟠 mewujudkan grounding |
| 6 | Tambahkan sweeper approval kedaluwarsa + pemulihan task `running` yatim | 🟠 membersihkan pekerjaan macet |
| 7 | Teruskan `temperature`/`model` ke provider, atau hapus dari definisi agent | 🔵 hilangkan konfigurasi palsu |
| 8 | Buat notifikasi approval keluar (Telegram) | 🔵 hilangkan kebutuhan polling |

---

## 14. Tautan Terkait

- [[010 - System Architecture MOC]]
- [[ATLAS AI OS Blueprint]]
- [[Task & Execution Pipeline]]
- [[Database Migrations & pgvector Setup]]
- [[Scheduled Jobs & Cron Automations]]
- [[Observability & Audit Trail]]
- [[Second Brain & Grounded RAG]]

---

⬅️ Kembali ke [[000 - Home MOC]]
