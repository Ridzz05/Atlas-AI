---
title: "000 - Home MOC"
scope: "second_brain"
category: "index"
author: "Chief"
tags: [moc, index, atlas, home]
updated: "2026-09-16"
---

# 🌐 ATLAS AI OS — Second Brain Hub

Selamat datang di **Second Brain Vault** untuk **ATLAS AI OS**. Vault ini adalah pusat
ingatan kolektif: dokumentasi teknis, profil armada agent, runbook operasional, dan
pengetahuan bisnis yang saling terhubung.

> **Cara vault ini benar-benar terhubung ke runtime.** Catatan Markdown di sini diingesti
> oleh `VaultIngestionService` dan disimpan sebagai `Map` **di dalam memori proses
> agent-service** (`packages/memory/src/second-brain/vault-ingestion-service.ts:25-26`).
> Ini **bukan** basis data vektor: PostgreSQL tidak memiliki satu pun kolom bertipe `vector`,
> dan `pgvector` tidak pernah aktif. Indeksnya hilang setiap proses agent-service dimatikan,
> dan agent yang berjalan di **worker tidak dapat mengaksesnya** karena tool
> `second_brain.*` tidak didaftarkan di sana. Rincian jujurnya ada di
> [[Second Brain & Grounded RAG]] dan [[Implementation Status & Known Gaps]].

---

## 🗺️ Maps of Content (Navigasi Utama)

- 🏛️ [[010 - System Architecture MOC]] — Arsitektur, topologi monorepo, pipeline eksekusi, keamanan, observabilitas, dan daftar cacat terverifikasi.
- 🤖 [[020 - Agent Fleet MOC]] — Profil enam agent: [[Chief - System Orchestrator|Chief]], [[Ned - Research Specialist|Ned]], [[Luna - Data & Market Analyst Specialist|Luna]], [[Layla - Lead Scoring Specialist|Layla]], [[Hermes - Content Specialist|Hermes]], [[Argus - QA & Risk Gate Specialist|Argus]].
- 🛠️ [[030 - Operations & Runbooks MOC]] — Pengembangan lokal, migrasi database, pemulihan bencana, dan deployment produksi.
- 📚 [[040 - Knowledge Base & Rubrics MOC]] — Rubrik penilaian lead, protokol memori, dan lanskap model AI.
- ⚡ [[050 - Automations & Workflows MOC]] — Penjadwalan cron, alur kontrol Telegram, dan status otomasi.

### Pintu Masuk Tercepat

| Pertanyaan | Jawaban |
| :--- | :--- |
| "Bagaimana satu task mengalir dari awal sampai akhir?" | [[Task & Execution Pipeline]] |
| "Apa saja yang rusak / belum jalan?" | [[Implementation Status & Known Gaps]] |
| "Bagaimana cara menjalankannya?" | [[Local Development Setup]] |
| "Rute API apa saja yang benar-benar ada?" | [[Monorepo Layout & Applications]] |

---

## 🧭 Struktur Folder Vault

```text
vault/
├── 00 - Index & Maps of Content (MOC)/  # Portal & peta navigasi
├── 01 - System Architecture/            # Arsitektur, pipeline, keamanan, observabilitas
├── 02 - Agent Fleet/                    # Profil, persona, dan batas eksekusi agent
├── 03 - Operations & Runbooks/          # Setup, migrasi, recovery, deployment
├── 04 - Knowledge & Rubrics/            # Rubrik, memori, dan provider LLM
└── 05 - Workflows & Automations/        # Cron, Telegram, dan alur otomasi
```

> Enam folder di atas adalah **seluruh** struktur vault. Tidak ada folder `06 - Attachments`;
> sampai saat ini tidak ada berkas media atau aset biner di vault ini — diagram ditulis
> sebagai blok Mermaid di dalam catatan masing-masing.

---

## 🔄 Sinkronisasi dengan Runtime ATLAS

Catatan di vault ini dapat dimuat ke indeks Second Brain melalui:

1. Terminal:
   ```bash
   pnpm brain:sync
   ```
   Skrip ini mem-POST ke `http://127.0.0.1:<PORT>/api/v1/brain/ingest` dengan
   `{ vaultPath, scope: "second_brain" }` dan Bearer dari `.env`.
2. Dashboard di `http://localhost:3000/brain` (halaman indeks, pencarian, dan RAG).

Ingesti otomatis juga dijalankan saat agent-service boot
(`apps/agent-service/src/server.ts:348`).

> ⚠️ **Batas kenyataannya:**
> - hasilnya tidak persisten — hilang saat proses agent-service berhenti;
> - `GET /api/v1/brain/stats` selalu melaporkan `durable: true` secara hardcoded
>   (`apps/agent-service/src/routes/second-brain.ts:44,64,77`), jadi jangan percaya klaim itu;
> - agent di worker tidak dapat memanggil `second_brain.*` — toolnya tidak terdaftar
>   (`apps/worker/src/worker.ts:100-129`).
>
> Artinya, hari ini vault ini berguna untuk **manusia** (dashboard dan catatan itu sendiri),
> belum untuk **grounding agent**.

---

## 🏷️ Indeks Tag Global (terverifikasi dari frontmatter)

Hasil pemindaian `tags:` pada 28 catatan vault, 16 Sep 2026 — **88 tag unik**. **Semua tag berbentuk datar
tanpa namespace** — tidak ada tag bergaya `#atlas/architecture` atau `#agent/chief` di
vault ini, jadi jangan mencari dengan bentuk itu di panel tag Obsidian.

- **Induk & peta**: `#atlas` `#moc` `#index` `#home`
- Arsitektur: `#architecture` `#blueprint` `#overview` `#pipeline` `#flow` `#execution` `#orchestration` `#monorepo` `#applications` `#pnpm` `#turbo`
- Keamanan & observabilitas: `#security` `#policy` `#approval` `#ssrf` `#observability` `#audit` `#logging` `#events`
- Memori & pengetahuan: `#memory` `#second-brain` `#rag` `#obsidian` `#retrieval` `#protocol` `#knowledge` `#rubric` `#rubrics` `#models` `#providers` `#openrouter` `#inference` `#rate-limit`
- Armada agent: `#agent` `#agents` `#fleet` `#chief` `#orchestrator` `#ned` `#research` `#luna` `#analytics` `#data` `#market_analysis` `#layla` `#sales` `#lead-scoring` `#icp` `#hermes` `#content` `#copywriting` `#argus` `#qa` `#risk` `#gate`
- Operasional: `#operations` `#setup` `#local-dev` `#runbook` `#deployment` `#production` `#docker` `#caddy` `#recovery` `#backup` `#leases` `#watchdog` `#database` `#postgresql` `#migrations` `#pgvector`
- Otomasi & kontrol: `#workflows` `#automation` `#cron` `#scheduler` `#bullmq` `#telegram` `#commands` `#bot` `#control`
- Status: `#status` `#gaps` `#defects` `#verification`

---

⬅️ Kembali ke [[000 - Home MOC]]
