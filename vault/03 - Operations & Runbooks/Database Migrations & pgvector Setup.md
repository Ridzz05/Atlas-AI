---
title: "Database Migrations & pgvector Setup"
scope: "second_brain"
category: "operations"
author: "Chief"
tags: [database, postgresql, pgvector, migrations]
updated: "2026-09-16"
---

# 🗄️ Database Migrations & pgvector Setup

Catatan ini dulu menjanjikan "penyimpanan vektor pgvector". **Itu tidak benar.** Isi di bawah adalah keadaan nyata skema ATLAS AI OS: bagaimana `Migrator` bekerja, apa yang benar-benar tercatat di `schema_migrations`, mengapa pgvector tidak pernah aktif, dan cacat fatal yang membuat host bersih tidak bisa boot.

---

## 🧩 Status `pgvector`: TIDAK AKTIF

Bukti dari database hidup (snapshot 16 Sep 2026):

- Kolom bertipe `vector` di seluruh schema: **0**.
- Ekstensi yang benar-benar terpasang: **`plpgsql` dan `uuid-ossp`** saja — tidak ada `vector`.
- Kolom embedding yang ada, `memory_embeddings.embedding`, bertipe **`jsonb`** dan berisi **0 baris**; `memory_items` juga 0 baris. Deklarasinya `embedding JSONB` di `packages/database/src/migrations/001_initial_schema.sql:196` — bukan tipe vektor.

Penyebabnya ada di migrasi pertama, `packages/database/src/migrations/001_initial_schema.sql:6-12`:

```sql
DO $$
BEGIN
    CREATE EXTENSION IF NOT EXISTS "vector";
EXCEPTION WHEN OTHERS THEN
    -- Fall back gracefully if pgvector C-extension is not installed on host PostgreSQL
    NULL;
END $$;
```

`CREATE EXTENSION vector` dibungkus blok `DO $$ ... EXCEPTION WHEN OTHERS THEN NULL`. Kegagalan apa pun ditelan tanpa suara: tidak ada error, tidak ada log, dan **tidak ada satu pun tabel di migrasi `001`–`014` yang memakai tipe `vector`**. Bahkan di produksi yang memakai image `pgvector/pgvector:pg16` (lihat [[Production Deployment & Docker]]), skema tetap tidak pernah meminta tipe `vector`, jadi ekstensi itu tidak pernah dipakai.

**Konsekuensi operasional:** jangan merancang backup, indeks, tuning, atau query dengan asumsi ada vektor di Postgres. Pencarian "semantik" di ATLAS AI OS hidup di memori proses, bukan di database — lihat [[Second Brain & Grounded RAG]] dan [[Local Development Setup]].

---

## 🔒 Cara Kerja `Migrator` yang Sebenarnya

Semua migrasi dijalankan oleh `Migrator` di `packages/database/src/migrator.ts`, dipanggil otomatis oleh runtime saat boot (`packages/runtime/src/index.ts:73-76`). Tidak ada skrip migrasi terpisah di `package.json`.

1. **Advisory lock dengan konstanta numerik.** Migrator membuka satu koneksi khusus, lalu:
   ```sql
   SELECT pg_advisory_lock($1)   -- $1 = MIGRATION_LOCK_KEY
   ```
   dengan `const MIGRATION_LOCK_KEY = 2147483646` (`packages/database/src/migrator.ts:6`). Pemanggilan ada di `packages/database/src/migrator.ts:52` (di dalam `runMigrations` yang mulai `:47`), dan pembebasan (`pg_advisory_unlock`) di `packages/database/src/migrator.ts:93-96` pada blok `finally`, sehingga lock tetap dilepas meski eksekusi gagal.
   → **Bukan** `hashtext('atlas_migrations')` seperti yang diklaim catatan lama.
2. **Tabel pelacakan minimal.** `schema_migrations` hanya punya dua kolom (`packages/database/src/migrator.ts:34-40`):
   ```sql
   CREATE TABLE IF NOT EXISTS schema_migrations (
     version VARCHAR(255) PRIMARY KEY,
     applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   );
   ```
   → **Tidak ada kolom hash konten.** Migrator membandingkan hanya **nama file** (`version`), jadi file migrasi yang isinya diubah setelah dieksekusi tidak akan pernah dijalankan ulang dan tidak ada peringatan apa pun. Ini penting saat mengedit `.sql` yang sudah tercatat.
3. **Satu transaksi per file, bukan satu transaksi besar.** Untuk setiap file: `BEGIN` → eksekusi SQL file → `INSERT INTO schema_migrations (version)` → `COMMIT`; bila gagal → `ROLLBACK` lalu error dilempar (`packages/database/src/migrator.ts:79-100`). Artinya migrasi yang sudah sukses sebelum titik gagal **tetap tercatat** dan tidak diulang pada boot berikutnya.
4. File dibaca dari direktori migrasi (`getDefaultMigrationsDir()` di `packages/database/src/migrator.ts:8-27`), diurutkan berdasarkan nama, dan yang sudah ada di `schema_migrations` dilewati.

---

## 🧨 Cacat Fatal: Migrasi `012` Membatalkan `013`–`014`

**Pada host bersih, migrasi gagal dan semua service menolak boot.** Ini terverifikasi dengan menjalankan `Migrator` asli (`packages/database/dist/migrator.js`) terhadap schema kosong:

| Langkah | Hasil |
|---|---|
| `001` … `011` | ✅ sukses |
| `012_scheduled_jobs.sql` | ❌ error `column "enabled" does not exist` → `runMigrations` melempar |
| `013_idempotency_keys.sql` | ⛔ tidak pernah dijalankan |
| `014_workflow_checkpoints.sql` | ⛔ tidak pernah dijalankan |

Akibatnya, pada host bersih **tidak ada tabel `idempotency_keys` maupun `workflow_checkpoints`**. Karena `packages/runtime/src/index.ts:73-76` tidak menangkap error itu, `createAtlasRuntime` gagal ⇒ **semua service menolak boot**.

### Akar masalah

Dua migrasi mendeklarasikan tabel yang sama dengan bentuk berbeda:

- `packages/database/src/migrations/001_initial_schema.sql:254-265` sudah membuat `scheduled_jobs` dengan kolom `cron_expression`, `agent_id`, `is_active`.
- `packages/database/src/migrations/012_scheduled_jobs.sql` memakai `CREATE TABLE IF NOT EXISTS scheduled_jobs` dengan bentuk yang berbeda jauh: `job_type`, `cron_pattern`, `timezone`, `assigned_agent`, `enabled`, `created_by`, `last_error`, dst. Karena `IF NOT EXISTS`, tabelnya tidak dibuat ulang; pernyataan itu jadi no-op.
- Baris berikutnya di file yang sama membuat indeks pada kolom yang tidak ada:
  ```sql
  CREATE INDEX IF NOT EXISTS scheduled_jobs_enabled_idx ON scheduled_jobs (enabled);
  ```
  → `column "enabled" does not exist`.

Perlu dicatat: `DROP`/`ALTER` untuk menyelaraskan bentuk tabel **tidak ada** di `012`, sehingga cacat ini deterministik pada database baru dan hanya bisa dihindari dengan memperbaiki urutan/bentuk migrasi secara manual.

### Kenapa database sekarang terlihat sehat

DB yang berjalan saat ini **bukan** hasil boot bersih: ia pernah dibangun ulang/diperbaiki manual setelah 31 Agustus. Baris `012` tercatat di `schema_migrations`, bentuk tabel `scheduled_jobs` mengikuti deklarasi versi `012`, dan `001`–`014` semuanya tercatat. Jadi "migrasi jalan" di mesin ini **tidak** membuktikan bahwa alur migrasi otomatis aman untuk deployment baru.

---

## 📋 Isi 14 File Migrasi

| # | File | Isi |
|---|---|---|
| 001 | `001_initial_schema.sql` | Schema awal: `users`, `tasks`, `runs`, `messages`, `audit_events`, `budgets`, `scheduled_jobs`, dan tabel inti lain; juga blok `CREATE EXTENSION vector` yang gagal senyap |
| 002 | `002_event_outbox.sql` | `event_outbox` (event bus lewat tabel + `pg_notify`, bukan Redis pub/sub) |
| 003 | `003_durable_approval_execution.sql` | State eksekusi approval yang tahan proses |
| 004 | `004_telegram_control_state.sql` | Deduplikasi update Telegram + control state (`telegram_updates`) |
| 005 | `005_durable_run_cancellation.sql` | Kolom permintaan pembatalan lintas proses pada `runs` |
| 006 | `006_durable_budget_reservations.sql` | Reservasi anggaran + settlement biaya |
| 007 | `007_run_leases.sql` | Kolom lease worker di `runs`: `worker_id`, `heartbeat_at`, `lease_expires_at` |
| 008 | `008_memory_maintenance.sql` | Pemeliharaan memori |
| 009 | `009_persisted_lead_rubrics.sql` | `lead_rubrics` (versi rubrik immutable, satu versi aktif) |
| 010 | `010_task_status_integrity.sql` | CHECK constraint status task kanonik (`queued` … `cancelled`) |
| 011 | `011_model_provider_settings.sql` | `model_provider_settings` (API key terenkripsi) |
| 012 | `012_scheduled_jobs.sql` | Deklarasi ulang `scheduled_jobs` dengan bentuk `job_type`/`cron_pattern`/`enabled` → **cacat fatal** |
| 013 | `013_idempotency_keys.sql` | `idempotency_keys` (lapisan idempotensi tool) |
| 014 | `014_workflow_checkpoints.sql` | `workflow_checkpoints` (checkpoint + riwayat transisi workflow) |

---

## 📦 Seeding Saat Boot

Setelah migrasi, runtime masih di `createAtlasRuntime` menjalankan seeding (`packages/runtime/src/index.ts:79-136`):

1. `seedAgents` — menulis **6** profil agent kanonik (`chief`, `ned`, `luna`, `layla`, `hermes`, `argus`) ke tabel `agents`. Catatan lama hanya menyebut 5 dan **melewatkan `luna`**.
2. `rubricRepo.ensureDefault(...)` — memastikan satu rubrik lead scoring default ada, lalu `getActive()`; bila tidak ada rubrik aktif, runtime melempar `No active lead rubric is configured.`
3. `RubricEngine.hydrate(...)` — memuat semua rubrik tersimpan dari tabel `lead_rubrics` ke mesin rubrik di memori.

Seeding ini juga bagian dari jalur boot: gagal seeding = service tidak jalan. Lihat [[Lead Qualification Rubric v1]] untuk isi rubriknya.

---

## 🚦 Status Runtime (16 Sep 2026)

- ❌ **pgvector tidak aktif**: 0 kolom `vector`, ekstensi hanya `plpgsql, uuid-ossp`, `memory_embeddings` bertipe `jsonb` dan kosong. Klaim "pencarian vektor persisten" harus dianggap fiksi.
- ❌ **Migrasi pada host bersih gagal** di `012` (`column "enabled" does not exist`) → `013`/`014` tidak pernah jalan → tidak ada `idempotency_keys` dan `workflow_checkpoints` → semua service menolak boot.
- ✅ **Database saat ini** "sehat" karena perbaikan manual: `001`–`014` tercatat di `schema_migrations`, 26 tabel ada, tabel `idempotency_keys`/`workflow_checkpoints` eksis (keduanya 0 baris).
- ⚠️ **Tidak ada hash konten** di `schema_migrations`, jadi mengedit file migrasi yang sudah diterapkan tidak memberi efek apa pun pada database yang sudah ada.
- ℹ️ Advisory lock berjalan: boot paralel beberapa container tidak akan saling menimpa migrasi (kunci `2147483646`, dilepas di `finally`).

---

## 🔗 Tautan Terkait

- [[030 - Operations & Runbooks MOC]]
- [[Local Development Setup]]
- [[Production Deployment & Docker]]
- [[Second Brain & Grounded RAG]]
- [[Lead Qualification Rubric v1]]

⬅️ Kembali ke [[000 - Home MOC]]
