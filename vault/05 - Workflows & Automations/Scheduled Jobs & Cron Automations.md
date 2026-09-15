---
title: "Scheduled Jobs & Cron Automations"
scope: "second_brain"
category: "workflows"
author: "Chief"
tags: [workflows, cron, scheduler, bullmq, automation]
updated: "2026-09-16"
---

# ⏱️ Scheduled Jobs & Cron Automations

Catatan ini menjelaskan **niat desain** penjadwalan berkala di **ATLAS AI OS**, lalu memisahkannya dari **apa yang benar-benar terjadi di runtime** per 16 Sep 2026. Kesimpulan singkat: kerangka penjadwal ada dan tersambung, tetapi **pemuat ekspresi cron-nya rusak secara fatal** sehingga setiap job yang aktif akan dieksekusi berulang tiap tick. Sampai hari ini belum ada satu pun job tersimpan, jadi kerusakan itu **laten**, bukan aktif.

---

## 🎯 Niat Desain

Penjadwal dimaksudkan menjalankan task ATLAS tanpa manusia: menarik definisi job dari database, mengevaluasi apakah job sudah jatuh tempo, lalu membuat task + memasukkannya ke antrean yang sama seperti task manual (sehingga delegasi, QA, dan audit tetap berlaku). `ScheduledJobScheduler` tinggal di `packages/orchestration/src/scheduler/scheduled-job-scheduler.ts`.

Dua loop yang dimaksudkan:

| Loop | Interval | Niat |
| :--- | :--- | :--- |
| **Sync** | `SCHEDULED_JOB_SYNC_INTERVAL_SECONDS` = **30** | Menyegarkan daftar job yang di-track dari tabel `scheduled_jobs`. |
| **Tick** | `SCHEDULED_JOB_TICK_INTERVAL_SECONDS` = **60** | Mengevaluasi `isDue` dan men-dispatch job yang jatuh tempo. |

Anchor interval: `packages/shared/src/schemas/config.ts:57-58`.

---

## 🐞 Cacat Fatal: Pemuat Ekspresi Cron Gagal Diam-diam

Kalkulator `nextRunAt` default memuat `cron-parser` lewat **indirect eval**:

```ts
const dynamicRequire = (0, eval)('require');
```

Anchor: `packages/orchestration/src/scheduler/scheduled-job-scheduler.ts:16-24` (ter-emit apa adanya di `dist/.../scheduled-job-scheduler.js:7`).

Rantai kegagalannya:

1. Indirect eval **kehilangan scope modul**, sehingga `require` tidak terdefinisi → `ReferenceError`.
2. `ReferenceError` itu **ditelan `catch`** di dalam kalkulator → fungsi mengembalikan **`null`** tanpa log apa pun.
3. `dispatch` lalu menulis hasil `null` itu ke `recordRun(job.id, this.nextRunCalculator(job), undefined)` (`packages/orchestration/src/scheduler/scheduled-job-scheduler.ts:239`) ⇒ kolom waktu run berikutnya **tidak pernah terisi**.
4. `isDue` memperlakukan `!job.nextRunAt` sebagai **due** (`:145`), jadi job yang sama dieksekusi lagi pada tick berikutnya — selamanya.

Ini bukan soal ekspresi cron-nya salah. Kontrol: `cron-parser` yang di-`require` **langsung** dari paket `packages/orchestration` mengembalikan `2026-09-16T02:00:00.000Z` untuk ekspresi yang identik. **Ekspresinya benar; mekanisme pemuatannya yang salah.**

### Bukti Eksekusi

| Pengamatan | Hasil |
| :--- | :--- |
| 1 job, `cronPattern: '0 9 * * *'`, `nextRunAt: null` | **1 dispatch** saat start **+ 1 dispatch setiap tick berikutnya** |
| 4 tick | **4 task** tercipta dari **1 job** |
| `nextRunAt` setelah dispatch | tetap **`null`** |

Artinya: tanpa perbaikan, "jadwal harian" berubah menjadi "task baru tiap 60 detik".

---

## 🗄️ Skema Nyata Tabel `scheduled_jobs`

Kolom **sebenarnya** mengikuti bentuk migrasi `012_scheduled_jobs.sql`, **bukan** gaya lama:

| Kolom | Fungsi |
| :--- | :--- |
| `job_type` | Jenis otomasi (`daily_briefing`, `lead_discovery`, `research_sync`, `memory_consolidation`, `workflow_resume`, `custom_automation` — cabang di `buildGoalForJob`). |
| `cron_pattern` | Ekspresi cron 5 kolom (mis. `0 9 * * *`), wajib non-kosong. |
| `timezone` | Zona waktu evaluasi, default `UTC`. |
| `assigned_agent` | ID agent penerima task (`chief`, `ned`, `luna`, `layla`, `hermes`, `argus`). |
| `enabled` | Status aktif/non-aktif job. |
| `created_by` | Aktor pembuat job. |
| `last_error` | Pesan kegagalan dispatch terakhir. |
| `last_run_at` / `next_run_at` | Penanda waktu run. |
| `payload`, `name`, `id` | Data tambahan yang dipakai `buildGoalForJob`. |

> ⚠️ Nama `cronExpression`, `prompt`, `agentId`, dan `nextRunAt` (gaya dokumen lama) **bukan** nama kolom database. Yang benar: `cron_pattern`, `job_type`, `assigned_agent`, `next_run_at`.

### Kontaminasi Skema Terkait (masih berdarah)

Migrasi `001_initial_schema.sql:254-265` sudah lebih dulu membuat `scheduled_jobs` dengan bentuk **berbeda** (`cron_expression` / `agent_id` / `is_active`). Migrasi `012` lalu mendeklarasikan ulang `CREATE TABLE IF NOT EXISTS scheduled_jobs` (bentuk baru) dan menambah `CREATE INDEX ... ON scheduled_jobs (enabled)`.

Pada host bersih, `CREATE TABLE IF NOT EXISTS` menjadi no-op, index `enabled` gagal (`column "enabled" does not exist`), `runMigrations` melempar dan **ROLLBACK** sehingga **013–014 tidak pernah jalan** (`packages/database/src/migrator.ts:79-100`; `packages/runtime/src/index.ts:73-76` tidak menangkapnya ⇒ semua service menolak boot). Ini sebabnya database yang hidup sekarang "terlihat sehat": ia pernah dibangun ulang/diperbaiki manual, baris `012` tercatat di `schema_migrations`, dan bentuk tabelnya mengikuti versi `012`. Detail lengkap ada di [[Database Migrations & pgvector Setup]].

---

## 🌐 Endpoint Otomasi

Route yang benar-benar terdaftar di `apps/agent-service/src/routes/automations.ts`:

| Method & Path | Baris | Kegunaan |
| :--- | :--- | :--- |
| `GET /api/v1/automations/scheduled-jobs` | `:64` | Daftar job terjadwal. |
| `POST /api/v1/automations/scheduled-jobs` | `:75` | Membuat job baru (validasi `CreateScheduledJobSchema`). |
| `POST /api/v1/automations/scheduled-jobs/:id/run` | `:91` | Menjalankan job sekarang (jalur manual `runJobNow`). |
| `POST /api/v1/automations/trigger` | `:37` | Pemicu manual otomasi (taskRepo → queue → delegator). |
| `GET /api/v1/automations/health` | `:130` | Kesehatan subsistem otomasi (boolean `scheduledJobs`, `workflowCheckpoints`). |
| `GET /api/v1/automations/workflows/checkpoints` | `:117` | Inspeksi checkpoint per `runId`. |

Jalur manual (`:91`) memakai kalkulator/`dispatch` yang sama; ia tidak melewati bug parser, hanya memicu dispatch tepat waktu.

---

## 🧊 Workflow Checkpoints: Ada di Skema, Inert di Runtime

Tabel `workflow_checkpoints` berasal dari migrasi **014**. Statusnya:

- **0 baris** di database hidup (snapshot 16 Sep 2026).
- **Tidak ada pemanggil produksi** untuk `WorkflowRuntime.start` — dialah satu-satunya jalur yang **membuat** checkpoint baru (`workflow-runtime.ts:55-66`, upsert di `:65`), dan ia hanya dipanggil dari test (`packages/orchestration/test/workflow-runtime.test.ts`). Tidak ada metode bernama `createCheckpoint` di repo ini.
- `WorkflowRuntime.transition` (upsert `:77`) **memang** terjangkau di produksi lewat `ResumeDriver` → `WorkflowAutomationService`, tetapi hanya untuk checkpoint yang sudah ada; karena tidak ada yang pernah menulis satu pun, loop itu tidak menemukan apa-apa untuk diproses.
- `ResumeDriver` (`packages/orchestration/src/workflow/resume-driver.ts:15`) tetap disusun di dalam `WorkflowAutomationService` (`packages/orchestration/src/automation/workflow-automation.ts:35-36`) yang dijalankan worker ketika `WORKFLOW_AUTOMATION_ENABLED` aktif, tetapi **tidak pernah meng-resume apa pun** karena tidak ada checkpoint yang pernah ditulis.

Konsekuensi: `GET /api/v1/automations/workflows/checkpoints` akan selalu kosong, dan klaim "durable workflow resume" belum punya isi apa pun untuk di-resume. Selain itu, pada host bersih tabel ini bahkan tidak terbentuk karena migrasi 013–014 dibatalkan (lihat bagian skema di atas).

---

## 🔧 Konfigurasi & Risiko Laten

Semua anchor `config.ts` di bawah menunjuk ke **`packages/shared/src/schemas/config.ts`** (bukan `apps/telegram-bot/src/config.ts`).

| Variabel | Default | Anchor | Catatan |
| :--- | :--- | :--- | :--- |
| `SCHEDULED_JOB_TICK_INTERVAL_SECONDS` | **60** | `config.ts:58` | Interval evaluasi due. |
| `SCHEDULED_JOB_SYNC_INTERVAL_SECONDS` | **30** | `config.ts:57` | Interval penyegaran daftar job. |
| `AUTOMATION_ENABLED` | **true** | `config.ts:60` | Penjadwal dinyalakan bila repo job tersedia. |
| `WORKFLOW_AUTOMATION_ENABLED` | **true** | `config.ts:61` | Loop resume workflow dinyalakan. |

⇒ Risiko bug parser adalah **laten**: begitu satu baris masuk ke `scheduled_jobs`, penjadwal langsung menyala tanpa perlu mengubah konfigurasi apa pun, dan job itu akan dieksekusi tiap tick.

---

## 💼 Contoh Job Terjadwal (Niat, Bukan Kondisi Berjalan)

Contoh berikut menggambarkan **apa yang dirancang** untuk diotomasi (cabang `buildGoalForJob`, `packages/orchestration/src/scheduler/scheduled-job-scheduler.ts:253`). Sampai bug pemuat cron diperbaiki, **setiap contoh di bawah akan berubah menjadi task berulang tiap tick**, bukan sekali per jadwal.

| `job_type` | Jadwal contoh | Niat |
| :--- | :--- | :--- |
| `daily_briefing` | `0 9 * * *` | Ringkasan harian untuk owner; Ned merekap memory/episodic 24 jam, Hermes menyusun narasi, Argus QA. Instruksi eksplisit: **jangan** kirim via Telegram, cukup dashboard + artifact. |
| `lead_discovery` | `0 8 * * *` | Cari calon klien potensial dari payload; Ned research/enrichment, Layla scoring, Hermes draft outreach, Argus QA; simpan artifact CSV/Markdown, tanpa outbound tanpa approval. |
| `research_sync` | `0 */6 * * *` | Sinkronisasi riset & knowledge; Ned verifikasi sumber, Argus validasi factuality. |
| `memory_consolidation` | `0 0 * * *` | Review episodic memory, ringkas keputusan, usulkan deprecasi knowledge basi. |
| `workflow_resume` | — | Melanjutkan workflow tertunda dari checkpoint (saat ini tidak ada checkpoint — inert). |
| `custom_automation` | bebas | Ambil `goal` dari `payload.goal`. |

---

## 📊 Status Runtime (16 Sep 2026)

Yang **berjalan**:

- Kerangka penjadwal (`ScheduledJobScheduler`) ter-wire di worker, dengan loop sync 30 s dan tick 60 s ketika `AUTOMATION_ENABLED` (default true) dan repo job tersedia.
- `dispatch` benar-benar membuat task dan memasukkannya ke antrean BullMQ yang sama dengan task manual (`atlas-agent-tasks`, job `agent-task`, `packages/orchestration/src/queue/bullmq-task-queue.ts:18-31`).
- Endpoint otomasi (CRUD job, run manual, health, checkpoints) terdaftar dan hidup.

Yang **rusak / inert**:

- **Parser cron: rusak fatal** (`scheduled-job-scheduler.ts:16-24`). `nextRunAt` selalu `null`; `isDue` selalu `true`; satu job = satu task per tick.
- **`workflow_checkpoints`: inert** — 0 baris, tanpa pemanggil produksi; `ResumeDriver` tidak pernah meng-resume apa pun.
- **Migrasi `012` tidak idempoten** terhadap `001` ⇒ pada host bersih boot gagal dan 013–014 hilang.

Yang **nyata di database** saat ini:

| Fakta | Nilai |
| :--- | :--- |
| `scheduled_jobs` | **0 baris** |
| `workflow_checkpoints` | **0 baris** |
| `tasks` | **55** (40 `completed`, 10 `failed`, **5 macet di `running`**) |
| `runs` | **106** (70 `completed`, 36 `failed`) |
| Jendela data run | `2026-08-28T18:50Z` → `2026-09-03T20:23Z` (platform idle sejak itu) |

Belum ada satu pun task yang lahir dari jalur penjadwalan (`scheduled_jobs` = 0 baris); seluruh 55 task berasal dari intake manual/Telegram `[INFERENCE]`. Karena itu bug di atas belum pernah menghantam produksi — tetapi juga berarti **jalur otomasi ini belum pernah dibuktikan bekerja end-to-end**.

---

## 🔗 Tautan Terkait

- [[050 - Automations & Workflows MOC]]
- [[Task & Execution Pipeline]]
- [[Telegram Bot Command Reference]]
- [[Database Migrations & pgvector Setup]]
- [[Disaster Recovery & Lease Watchdog]]
- [[Chief - System Orchestrator]]

---

⬅️ Kembali ke [[000 - Home MOC]]
