---
title: "Implementation Status & Known Gaps"
scope: "second_brain"
category: "architecture"
author: "Chief"
tags: [atlas, status, gaps, defects, audit, verification]
updated: "2026-09-20"
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

## 2. ✅ DIPERBAIKI — Cacat Boot-Blocker: Migrasi `012` (ditemukan 16 Sep, diperbaiki 20 Sep 2026)

> **Status: sudah diperbaiki.** Berkas `012_scheduled_jobs.sql` kini berisi blok `DO $$`
> yang menambahkan setiap kolom yang hilang (`enabled`, `job_type`, `cron_pattern`,
> `timezone`, `assigned_agent`, `created_by`, `last_error`) **sebelum** index dibuat, jadi
> `column "enabled" does not exist` tidak mungkin terjadi lagi.
>
> Perbaikan itu sendiri **belum cukup** dan sudah dilengkapi: `001_initial_schema.sql:257-258`
> mendeklarasikan `cron_expression NOT NULL` dan `agent_id NOT NULL REFERENCES agents(id)`,
> sedangkan `scheduled-job.repository.ts:17-34` tidak pernah mengisi keduanya. Artinya
> kegagalan hanya berpindah dari boot ke penulisan pertama. Sekarang `012` melepas
> `NOT NULL` pada kedua kolom itu.
>
> Dijaga oleh test baru `packages/database/test/scheduled-jobs-schema.test.ts`, yang
> membandingkan kolom NOT NULL-tanpa-DEFAULT di `001`+`012`, kolom yang benar-benar di-INSERT
> repository, dan kolom yang dilepas `012`. Tanpa `DROP NOT NULL`, test melaporkan
> `["cron_expression","agent_id"]` sebagai tidak terisi.
>
> **Yang masih terbuka:** migrasi belum pernah dijalankan terhadap PostgreSQL kosong dari
> working tree ini, jadi "host bersih bisa boot" masih kesimpulan statis, bukan hasil eksekusi.

### Bukti (16 Sep 2026, sebelum perbaikan)
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

## 3. ✅ DIPERBAIKI — Cacat Eksekusi: Cron Menembak Berulang Setiap Tick

> **Status: sudah diperbaiki (sebelum 20 Sep 2026).**
> `packages/orchestration/src/scheduler/scheduled-job-scheduler.ts:1` sekarang memakai
> `import cronParser from 'cron-parser'` statis dan `defaultNextRunCalculator` (:17-25)
> memanggil `parser.parseExpression(...)`. `grep "(0, eval)"` di `packages/` dan `apps/`
> mengembalikan 0 hasil, jadi `nextRunAt` tidak lagi `null` dan `isDue` tidak lagi
> menganggap setiap job selalu jatuh tempo.

### Bukti (16 Sep 2026, sebelum perbaikan)
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
| `MAX_DELEGATION_DEPTH` | ✅ **DIPERBAIKI** — `task.repository.ts:24-33` sekarang menulis `input.depth ?? 0` dan `task-delegator.ts:222-223` menghitung `depth = parent.depth + 1`, jadi `DepthGuard` punya nilai nyata untuk ditegakkan. (Catatan terpisah: limit per-agen `limits.maxDelegationDepth` masih tidak pernah dibaca — delegator memakai env global.) |

### 6.1 Invariant orkestrasi yang sudah diperbaiki (20 Sep 2026)

| Butir | Anchor | Status |
| :--- | :--- | :--- |
| **Lease steal** — worker yang gagal `acquireLease` tetap menulis status terminal; `updateStatus` cocok pada `id` saja dan mengosongkan kolom lease, sehingga run milik worker sah ditandai gagal | `run.repository.ts:266-305` vs `agent-runner.ts:532-536` | ✅ diperbaiki: `updateStatus(..., workerId?)` dengan guard `worker_id IS NULL OR worker_id = $5`; runner mengirim `this.workerId` |
| **Double execution** — handler worker tanpa precondition status task; tiap retry BullMQ membuat `runId` baru sehingga lease tidak bisa mendeduplikasi | `apps/worker/src/worker.ts:266-305`, `agent-runner.ts:129` | ✅ diperbaiki: `checkTaskRunnable` — hanya `queued`/`approval_pending` boleh jalan |
| **Budget leak** — `recoverStaleReservations` hanya dipanggil saat bootstrap runtime, jadi reservasi yatim menahan plafon harian sampai proses restart | `runtime/src/index.ts:124` | ✅ diperbaiki: sapuan menumpang interval recovery 30 detik di worker |
| **Cancel tidak sampai ke graf** — worker memanggil `executePlan` tanpa signal dan delegator tidak pernah membaca store pembatalan durabel; emergency stop meninggalkan planner/spesialis/QA/sintesis berjalan sampai selesai | `apps/worker/src/worker.ts:295`, `task-delegator.ts:111` | ✅ diperbaiki: `isCancellationRequestedForTask` (join ke `tasks.parent_id`) + `AbortController` internal yang dipoll sebelum perencanaan dan tiap batch |
| **Argus tidak bisa memanggil tool** — `stageRunner` dibangun tanpa `toolExecutor`, jadi `policy.verify` di allowlist Argus tidak pernah bisa dipanggil | `task-delegator.ts:71-82` | ✅ diperbaiki: `stageRunner` menerima `toolExecutor`, `cancellationStore`, `approvalExecutionStore`, `toolCallRepo` |
| **Task `running` yatim permanen** — sweep run mensyaratkan `lease_expires_at IS NOT NULL`, sehingga run `active` tanpa lease abadi dan task-nya ikut tidak pernah dipulihkan; sweep juga hanya jalan saat boot | `run.repository.ts:207-245` | ✅ diperbaiki: cabang `lease_expires_at IS NULL` + penjaga waktu `staleAfterSeconds`, dan sapuan menumpang interval recovery worker |
| **Budget bypass senyap** — reservasi dilewati total bila salah satu dari `budgetRepo`/`runRepo`/`globalDailyBudgetUsd` tidak ada | `agent-runner.ts:260` | ✅ diperbaiki: `warn` sekali menyebut repo mana yang hilang |

Test karakterisasi: `packages/orchestration/test/agent-runner-lease.test.ts`,
`packages/orchestration/test/delegation-cancellation.test.ts`,
`apps/worker/test/worker-idempotency.test.ts`, `apps/worker/test/worker.test.ts`,
`packages/database/test/run.repository.test.ts`.

Semua item di atas sudah ditutup. Yang **belum** hanya yang menunggu keputusanmu: siklus
status task/run, visibilitas memori, plafon biaya, dan vokabulari verdict QA.

**Yang benar-benar ditegakkan**: `limits.maxTurns`
(`agent-runner.ts:298`), `limits.timeoutSeconds` (`:142-147`), dan `limits.maxCostUsd`
(`:361-364`).

**Dimensi `depth` sudah diperbaiki**: `task.repository.ts:24-33` menulis `input.depth ?? 0`
dan `task-delegator.ts:222-223` menghitung depth anak, sehingga `DepthGuard` aktif. Yang
masih salah adalah sumber limitnya — delegator memakai `MAX_DELEGATION_DEPTH` dari env dan
mengabaikan `limits.maxDelegationDepth` milik agen tujuan.

### 6.2 ✅ Gerbang CI hijau menyeluruh (20 Sep 2026)

Sebelum ini **tidak satu pun langkah setelah "Setup pnpm" pernah berjalan**. Job `validate`
mati di langkah kedua, dan `compose-smoke` (`needs: validate`) selalu ter-skip — jadi
seluruh rangkaian gerbang di belakangnya belum pernah dieksekusi sekali pun, dan cacatnya
tersembunyi berlapis di balik langkah pertama yang rusak.

Empat cacat yang menutupinya, semuanya diperbaiki:

| Cacat | Sebab | Perbaikan |
| --- | --- | --- |
| `Setup pnpm` gagal | `version: 11` di `pnpm/action-setup` bentrok dengan `packageManager: pnpm@11.23.0` | input `version` dihapus; `packageManager` jadi sumber tunggal |
| `Dependency audit` gagal | `next>sharp` di-pin `0.35.3`, satu patch di bawah rilis yang dipatch (GHSA-rgj7-g3m4-5g8c) | override dinaikkan ke `0.35.4`; `pnpm build` tetap lolos dan binding native-nya terbukti merender PNG |
| `Secret scan` gagal | grep inline mencari `8669353401` telanjang, yang ada di dalam `ci.yml` sendiri **dan** di `scripts/check-secrets.mjs` — langkah itu mencocokkan dirinya sendiri | pola dipindah ke `scripts/check-secrets.mjs` sebagai pemilik tunggal, `lint.mjs` mengimpornya, CI memanggil skripnya |
| `Run Tests` gagal | `scripts/native-dev.test.mjs` menjalankan `pnpm.cmd`, shim khusus Windows, di runner Linux | nama perintah mengikuti platform; cabang ComSpec tetap diuji di Windows |

Dua cacat terakhir hanya terlihat setelah cacat sebelumnya diperbaiki, dan keduanya
membutuhkan bukti dua arah: pola secret-scan diuji dengan berkas probe agar terbukti masih
menangkap (bukan sekadar lolos), dan pola anotasi kegagalan test diuji terhadap keluaran
turbo yang gagal sungguhan sebelum dipakai.

Status terverifikasi pada `7ebc653`: `validate` 15/15 langkah lolos, dan `compose-smoke`
berjalan untuk **pertama kali** — boot compose, readiness, serta backup/restore — dan lolos.

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

### 10.1 Temuan baru (recon 20 Sep 2026) — sudah diperbaiki

| Butir | Anchor | Status |
| :--- | :--- | :--- |
| Hash approval token tidak mengikat payload bersarang — `JSON.stringify(payload, Object.keys(payload).sort())` memakai replacer array (daftar-putih), sehingga objek bersarang jadi `{}` dan dua payload berbeda menghasilkan hash identik | `packages/policy/src/token-verifier.ts:6` | ✅ diperbaiki: serialisasi kanonik rekursif + test regresi |
| Manifest tool boleh **menurunkan** gerbang approval — `approval: 'auto'` memaksa `requiresApproval=false`, menimpa `ApprovalMatrix`; `registerLegacy` memberi `'auto'` secara default | `packages/tools/src/registry.ts:184-187`, `:105` | ✅ diperbaiki: manifest hanya boleh menaikkan; keputusan "tanpa approval" pindah ke `ApprovalMatrix.NO_APPROVAL_ACTIONS` |
| Tiga gerbang SDLC gagal-terbuka — fallback `extractJSON` mengembalikan `technicalFeasibility:'approved'`, `financialApproval:'approved'`, `verdict:'PASS'`, jadi satu respons LLM yang tidak bisa di-parse = budget disetujui otomatis | `packages/orchestration/src/sdlc/sdlc-engine.ts:126-135`, `:183-191`, `:365-377` | ✅ diperbaiki: `needs_revision` / `escalated_to_human` / `REVISE` + test |
| `PUT /api/v1/settings/telegram` menulis nilai klien ke `.env` tanpa menolak newline → injeksi baris env (mis. `API_AUTH_TOKEN=` untuk mematikan autentikasi) | `apps/agent-service/src/server.ts:421-463` | ✅ diperbaiki: schema menolak `\r`/`\n` + test |
| `POST /api/v1/brain/ingest` menerima `vaultPath` absolut sembarang → pembacaan berkas arbitrer yang bisa dibaca balik via `/brain/search` | `apps/agent-service/src/routes/second-brain.ts:93-141` | ✅ diperbaiki: `vaultPath` wajib resolve ke root vault terkonfigurasi + test |

Masih terbuka dari temuan yang sama: `x-actor-id` pada approval dikendalikan pemanggil,
proxy dashboard tidak punya autentikasi pemanggil (kini digerbangi basic auth di Caddy),
dan SSRF jalur Chromium tidak memeriksa hasil DNS.

✅ **Allowlist gagal-terbuka sudah diperbaiki** (20 Sep 2026): `ToolContext.allowedTools`
kini **wajib** di `packages/tools/src/types.ts`, dan `registry.ts:151` menolak tool yang
tidak ada di daftar tanpa syarat. Lubang "allowlist tidak diset berarti izinkan semua"
menjadi error kompilasi, bukan bug runtime.

### 10.2 Sweep seluruh codebase (21 Sep 2026) — sudah diperbaiki

Sweep 9 domain (56 temuan). Yang berikut sudah diperbaiki, masing-masing dengan test yang
**gagal sebelum** dan lolos sesudah:

| Butir | Anchor | Status |
| :--- | :--- | :--- |
| Allowlist Telegram gagal-terbuka: `isUserAllowed` mengembalikan `true` saat daftar kosong, dan `config.ts` hanya menolak di `NODE_ENV=production` — jadi `test`/dev menerima **setiap** pengguna Telegram (kontrol penuh: buat task, emergency stop, approval) | `apps/telegram-bot/src/security/guard.ts` | ✅ diperbaiki: guard gagal-tertutup; keputusan dev dipindah eksplisit ke `config.allowAllUsers` |
| API tidak punya `setErrorHandler` → `error.message` mentah (nama tabel, host DB, path filesystem) bocor ke klien **tanpa** log | `apps/agent-service/src/server.ts` | ✅ diperbaiki: satu handler, log penuh + request id, 500 generik |
| `pgcrypto` dibuat tanpa guard di 014/015 → rantai migrasi bisa batal di host tanpa contrib; `uuid_generate_v4()` juga membuat 001 bergantung `uuid-ossp` | `014`/`015`, `001` | ✅ diperbaiki: `gen_random_uuid()` (core sejak PG13) menghapus ketergantungan; ekstensi dalam `DO $$ … EXCEPTION` |
| `event_outbox` di-index pada `created_at`, padahal **setiap** query memfilter dan mengurut `occurred_at` | `002` + `017` (baru) | ✅ diperbaiki: indeks `(occurred_at, event_id)` |
| `hasPending(taskId)` memeriksa key yang salah: `enqueue` memakai `runId` bila ada, jadi job ber-key runId tidak terlihat → recovery meng-enqueue job kedua untuk task yang masih jalan | `packages/orchestration/src/queue/*` | ✅ diperbaiki: `primaryJobId`/`probedJobIds` + `hasPending({taskId, runId})` + cek durabel run aktif di worker |
| `executePlan` di-enter ulang memakai UUID **baru** untuk child yang sudah ada, padahal `taskRepo.create` dilewati → `runs.task_id` melanggar FK dan error aslinya hilang | `packages/orchestration/src/delegator/task-delegator.ts` | ✅ diperbaiki: pakai ulang baris yang sudah ada |
| `claim()` idempotency tidak pernah melihat `expires_at` → satu crash meracuni key itu **permanen**; `mapRow` mengirim `null` untuk `runId` yang `optional()` | `packages/database/src/repositories/idempotency.repository.ts` | ✅ diperbaiki: `ON CONFLICT DO UPDATE … WHERE expired`, `?? undefined` |
| Kontrol `idempotency: 'required'` adalah no-op: claim hanya jalan bila store **dan** key ada, dan tak ada pemanggil produksi yang menyediakan keduanya | `packages/tools/src/registry.ts` | ✅ diperbaiki: gagal-tertutup tanpa store, key diturunkan registry, `DatabaseIdempotencyStore` di-wire di worker |
| Gerbang intake (pause/emergency stop) hanya ada di 1 dari 5 route pembuat task | `apps/agent-service/src/routes/intake-gate.ts` (baru) | ✅ diperbaiki: `preHandler` di kelima route + test inventaris |
| Run yang kehabisan giliran atau dipotong provider dilaporkan `completed`; tool call tanpa executor dicatat `success` | `packages/orchestration/src/engine/agent-runner.ts` | ✅ diperbaiki: keduanya gagal-tertutup |
| Voice assistant mematikan `SpeechRecognition`-nya sendiri setelah transkrip pertama (`transcript` ada di dependency array); `onTaskCreated` tak pernah terpanggil (`res.data` padahal route mengembalikan task langsung) | `apps/dashboard/src/components/chief-voice-assistant.tsx` | ✅ diperbaiki: ref untuk nilai yang berubah, deps `[lang]`; respons tidak lagi di-envelope |
| Command Center menampilkan `$0.00` / `0` untuk metrik yang gagal diambil, dan `WorkflowLiveStream` menelan error fetch menjadi keadaan kosong | `apps/dashboard/src/app/page.tsx`, `workflow-live-stream.tsx` | ✅ diperbaiki: penanda "tidak tersedia" + state error |

Masih terbuka dari sweep yang sama: tidak ada jalur produksi yang mempromosikan proposal memori
ke `verified`, `review.requiredAgent` dideklarasikan tetapi tidak ada tahap yang menegakkannya,
dan `IdempotencyRepository.expireStale` tidak pernah dipanggil (kini hanya higiene — `claim`
menyembuhkan dirinya sendiri).

Rincian ada di [[Policy, Security & Approval Gates]].

### 10.3 Gelombang lanjutan (21 Sep 2026) — sudah diperbaiki

Kelas bug yang muncul di gelombang ini: **fakta yang tidak pernah diperiksa**. Sebuah nilai
ditulis seolah-olah hasil pengukuran padahal tidak ada yang mengukurnya.

| Butir | Anchor | Status |
| :--- | :--- | :--- |
| Biaya provider: `[OI]CompatibleProvider` memakai tarif gpt-4o-mini untuk **semua** endpoint yang tidak menimpanya, sehingga `ollama` (lokal, gratis) ditagih tarif berbayar dan plafon harian dimakan run gratis; OpenRouter di-hardcode `0` sehingga plafon tak pernah menyala | `packages/providers/src/openai.ts`, `factory.ts`, `openrouter.ts` | ✅ diperbaiki: harga yang tidak dideklarasikan = tidak diketahui; OpenRouter ditanya (`usage.include`) dan memakai biaya yang dilaporkannya; `:free` dideklarasikan nol secara jujur |
| `ModelRunResult.costUsd` tidak bisa membedakan "gratis" dari "tidak diketahui" | `packages/providers/src/types.ts` | ✅ diperbaiki: `costUsdKnown` wajib; runner memperingatkan sekali per run bahwa plafon tidak bisa ditegakkan |
| Audit hanya mencatat eksekusi **sukses** — setiap penolakan (allowlist, policy, input tidak sah, token approval) dan setiap kegagalan tidak meninggalkan jejak durabel | `packages/tools/src/registry.ts` | ✅ diperbaiki: audit jadi tanggung jawab satu wrapper; `outcome` = `succeeded`/`denied`/`failed`/`approval_pending` |
| Tulisan audit berada **di dalam** `try` eksekusi, jadi sink audit yang rusak mengubah tool call yang sudah selesai menjadi `success: false` → runner menandainya gagal dan model mengulang = kirim ganda | `packages/tools/src/registry.ts` | ✅ diperbaiki: kegagalan sink audit dicatat sebagai error, tidak mengubah hasil |
| `approvals.decided_by` diisi dari header `x-actor-id` yang dikendalikan pemanggil — pembayaran bisa tercatat "approved by cfo" | `apps/agent-service/src/routes/approvals.ts` | ✅ diperbaiki: aktor = principal yang benar-benar terautentikasi; header dicatat sebagai klaim tak terverifikasi |
| `recordRun` menstempel `last_run_at = NOW()` saat inisialisasi jadwal, jadi job yang belum pernah jalan melaporkan "terakhir jalan: barusan" | `packages/database/src/repositories/scheduled-job.repository.ts` | ✅ diperbaiki: `initializeSchedule` hanya menulis `next_run_at` (CAS) |
| Seeding menimpa riwayat `agent_versions` tiap boot — audit "run X memakai chief v3" tak bisa lagi dipetakan ke prompt v3 yang sebenarnya | `packages/database/src/agent-seeder.ts` | ✅ diperbaiki: `DO NOTHING` (riwayat imutabel) + peringatan saat definisi di disk menyimpang dari versi tersimpan |
| Manifest tool tidak divalidasi: `riskLevel: 'critcal'` atau side effect karangan lolos ke policy engine | `packages/tools/src/registry.ts` | ✅ diperbaiki: validasi `ToolManifestSchema`, gagal-tertutup dengan path yang salah. Langsung menemukan satu nilai hidup (`'external_write'` vs `'write_external'`) |
| `registerLegacy` menyintesis `sideEffects: ['none']` untuk tool yang tidak mendeklarasikan apa pun — klaim paling tidak konservatif yang mungkin | `packages/shared/src/schemas/tool-manifest.ts` | ✅ diperbaiki: `'unknown'` ditambahkan ke enum; konsumen mana pun harus gagal-tertutup atas nilai itu |
| Dua kontrol dashboard mem-POST ke route yang tidak ada (`POST /brain/notes`, `POST /messages`) — gagal hanya saat operator mengisi formulir, dengan 404 polos | `apps/dashboard/src/app/brain/page.tsx`, `communications/page.tsx` | ✅ diperbaiki: kontrol dinyatakan tidak tersedia beserta alasannya (mem-wire ke `ingestDocument` akan membuat catatan yang hilang saat sync sambil melaporkan "tersimpan") |
| Tidak ada yang memeriksa dashboard dan API satu sama lain — keduanya aplikasi terpisah yang bicara lewat HTTP | `scripts/dashboard-api-contract.test.mjs` (baru) | ✅ diperbaiki: test kontrak membaca kedua sisi dan menuntut setiap `atlasFetch` punya route terdaftar; jalan di `pnpm test` |

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
| ~~1~~ | ~~Perbaiki migrasi `012` agar host bersih bisa boot~~ | ✅ selesai 20 Sep 2026 (lihat §2). Sisa: jalankan migrasi di DB kosong untuk membuktikan |
| ~~2~~ | ~~Ganti `(0, eval)('require')` dengan import statis di scheduler~~ | ✅ selesai (lihat §3) |
| 3 | Isi tarif OpenRouter yang sebenarnya | 🟡 tanpa ini pengaman anggaran tidak berarti |
| ~~4~~ | ~~Persistensi `depth` pada `taskRepo.create`~~ | ✅ selesai (lihat §6) |
| 5 | Pindahkan indeks Second Brain ke penyimpanan bersama + daftarkan toolnya di worker | 🟠 mewujudkan grounding |
| 6 | Tambahkan sweeper approval kedaluwarsa + pemulihan task `running` yatim | 🟠 pemulihan task `running` yatim ✅ selesai 20 Sep 2026 (lihat §6.1); sweeper approval kedaluwarsa belum |
| 7 | Teruskan `temperature`/`model` ke provider, atau hapus dari definisi agent | 🔵 hilangkan konfigurasi palsu |
| 8 | Buat notifikasi approval keluar (Telegram) | 🔵 hilangkan kebutuhan polling |
| 9 | ~~jadikan `ToolContext.allowedTools` wajib lalu gagal-tertutup di `registry.ts:151`~~ | ✅ selesai 20 Sep 2026 (lihat §10.1) |
| ~~10~~ | ~~Putuskan apakah SDLC dijalankan di atas `TaskDelegator` atau tetap proses sendiri~~ | ✅ diputuskan + dieksekusi: SDLC kini task biasa di atas pipeline (lihat §6.1) |
| 11 | ~~teruskan `AbortSignal` ke `executePlan` dan beri `stageRunner` sebuah `cancellationStore`~~ | ✅ selesai 20 Sep 2026 (lihat §6.1) |
| 12 | ~~jangan lewati reservasi anggaran secara senyap saat salah satu repo tidak ada~~ | ✅ selesai 20 Sep 2026 (peringatan sekali; lihat §6.1) |
| ~~13~~ | ~~Buat gerbang CI benar-benar berjalan sampai langkah terakhir~~ | ✅ selesai 20 Sep 2026: `validate` 15/15 dan `compose-smoke` pertama kali berjalan (lihat §6.2) |

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
