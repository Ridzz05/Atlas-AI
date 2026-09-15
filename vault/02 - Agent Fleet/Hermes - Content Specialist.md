---
title: "Hermes - Content Specialist"
scope: "second_brain"
category: "agent"
author: "Chief"
tags: [agent, hermes, content, copywriting, fleet]
updated: "2026-09-16"
---

# ✍️ Hermes — Content Specialist

Hermes menyusun draf komunikasi persuasif, agenda rapat, proposal kemitraan, dan naskah outreach yang bersandar pada data faktual serta panduan *brand voice*. Ia dipanggil sebagai subtask hasil delegasi [[Chief - System Orchestrator]].

## 📋 Ikhtisar Agent

| Parameter | Nilai |
| :--- | :--- |
| **ID** | `hermes` |
| **Role** | `content_creator` |
| **Sumber definisi** | `packages/agents/src/definitions/hermes.ts` — didaftarkan di `packages/agents/src/registry.ts:12-19` |
| **Jejak Eksekusi** | **13 run** (snapshot DB 16 Sep 2026) |
| **Tanggung Jawab Utama** | Draf komunikasi berbukti (*draft-only*), agenda, proposal, copywriting outreach |

## 🎯 Format Output Wajib (Required Structure)

Setiap draf wajib memuat:
1. **Audiens Sasaran (*Target Audience*)**.
2. **Sasaran Komunikasi (*Objective*)**.
3. **Proposisi Nilai Utama / Butir Agenda**.
4. **Ajakan Bertindak (*Call to Action / Next Steps*)**.

## 🛑 Batasan & Aturan Ketat (Constraints & Rules)

1. **Temporal & Scope Anchoring** — Menghormati waktu yang diberikan pengguna (mis. "besok pukul 10 Pagi WIB"); dilarang membiarkan tanggal/jam penting bertuliskan `[TBD]`.
2. **Strict Language Purity** — 100% bahasa target (Indonesia/Inggris), tanpa token Mandarin/asing.
3. **Zero Fabrication** — Dilarang mengarang fakta, statistik, klaim harga, atau nama mitra yang tidak terverifikasi.
4. **Tone & Brand Voice** — Nada kolaboratif, profesional, hormat; hindari kalimat konfrontatif.
5. **Clean User-Facing Artifacts** — Tidak membocorkan metadata agent internal, catatan debug, atau skor keyakinan ke deliverable siap distribusi.
6. **Draft Restriction** — Semua pesan keluar **hanya draf**. Hermes tidak dapat mengirim pesan langsung tanpa persetujuan manusia.

## 📏 Batas Eksekusi (dan Apa yang Sungguh-Sungguh Ditegakkan)

| Parameter | Nilai | Ditegakkan? | Anchor |
| :--- | :--- | :--- | :--- |
| `maxTurns` | **8** | ✅ Ya | `packages/orchestration/src/engine/agent-runner.ts:298` |
| `timeoutSeconds` | **180** s | ✅ Ya | `packages/orchestration/src/engine/agent-runner.ts:142-147` |
| `maxCostUsd` | **0.5** USD | ✅ Ya | `packages/orchestration/src/engine/agent-runner.ts:361-364` |
| `maxDelegationDepth` | **1** | ⚠️ Guard ada, praktis no-op | `task-delegator.ts:174-179`; `packages/policy/src/depth-guard.ts:12-40` |
| `temperature` | 0.4 (deklarasi) | ❌ Tidak pernah dibaca kode eksekusi | lihat bagian koreksi |

> **Depth anak tidak dipersistensi.** `task-delegator.ts:203` menghitung `depth` namun `taskRepo.create` tidak menuliskannya ⇒ **semua 55 task di DB `depth = 0`** dan `DepthGuard` praktis no-op.

## 🛠️ Tools: Deklarasi vs Registrasi Nyata

Deklarasi allowlist (`packages/agents/src/definitions/hermes.ts:32`) vs registrasi worker (`apps/worker/src/worker.ts:100-129`):

| Tool | Dideklarasikan | Terdaftar di worker | Catatan |
| :--- | :--- | :--- | :--- |
| `memory.search` | ✅ | ✅ | Benar-benar tersedia |
| `artifacts.read` | ✅ | ✅ | Benar-benar tersedia |
| `artifacts.write` | ✅ | ✅ | Benar-benar tersedia |
| `communication.create_draft` | ✅ | ✅ | Nyata; `riskLevel: 'low'`, tanpa approval |
| `brand.get_voice` | ✅ | ❌ | Gagal `Tool 'brand.get_voice' not found in Tool Gateway registry.` |
| `communication.send_approved` | ❌ **tidak dideklarasikan** | ✅ | Terdaftar, tetapi **tidak dapat dipakai Hermes** — lihat di bawah |

`communication.send_approved` adalah satu-satunya tool dengan `requiresApproval: true` (`packages/tools/src/tools/communication-tools.ts:83`). Tiga penghalang membuatnya tidak pernah benar-benar mengirim apa pun:

1. **Allowlist.** Tool itu tidak ada di daftar tool Hermes, sehingga `ToolRegistry.execute` menolaknya lebih dulu dengan `Tool 'communication.send_approved' is not permitted for agent 'hermes'.` (`packages/tools/src/registry.ts:138-162`).
2. **Kebijakan approval + external writes.** `ApprovalMatrix` menetapkan `communication.send_approved` sebagai `HUMAN_APPROVAL_REQUIRED_ACTIONS` dan `EXTERNAL_WRITE_ACTIONS` (`packages/policy/src/approval-matrix.ts:42-57`); selama `EXTERNAL_WRITES_ENABLED=false` (default, `packages/shared/src/schemas/config.ts:66`) eksekusi diblokir dengan alasan `External writes are currently disabled by global configuration.` (`approval-matrix.ts:72-79`).
3. **Tanpa konektor.** Bahkan bila lolos, eksekusinya gagal `No outbound communication connector configured.` karena `communicationSender` tidak pernah diisi (`packages/tools/src/tools/communication-tools.ts:87-88`).

Definisi Hermes juga menetapkan `review.humanApprovalFor: ['communication.send_approved']` — sama seperti [[Chief - System Orchestrator]] — namun jalur approval itu tidak pernah tercapai.

## ⛔ Koreksi Penting: `modelPolicy` Tidak Dikonsumsi

- `temperature` (0.4) dan `fallbackTier` (`fast`) **tidak pernah dibaca kode eksekusi**; `AgentRunner` tidak meneruskan `temperature`/`maxTokens` ke provider, sehingga Hermes efektif memakai default provider **0.2** — bukan 0.4 "kreatif".
- `modelPolicy` dipersistensikan ke kolom `model_policy` (`packages/database/src/agent-seeder.ts:7`) tetapi tidak dikonsumsi.
- Tidak ada rantai fallback antar model/provider.

## 🧪 Verifikasi Runtime

### Status Runtime (16 Sep 2026)

- **Jejak eksekusi**: `hermes` **13 run** (distribusi armada: chief 54, argus 22, ned 15, hermes 13, layla 2, luna 0).
- **Nol pengiriman nyata.** Tabel `approvals` berisi **0 baris**, dan `event_outbox` tidak pernah mencatat event `approval.*` — jadi belum pernah ada satu pun permintaan approval terbuat, apalagi disetujui.
- **Nol pemanggilan tool komunikasi.** DB mencatat **0 pemanggilan `communication.*`** sepanjang 106 run; total `tool_calls` sistem hanya 5 (`memory.search` 2 sukses + 1 gagal, `artifacts.write` 1, `artifacts.read` 1).
- **Idempotensi tidak aktif.** `communication.send_approved` mendeklarasikan idempotency (`packages/tools/src/tools/communication-tools.ts:20-33`), tetapi tidak ada `IdempotencyStore` yang pernah dipasang ke `ToolContext` ⇒ deklarasi itu tidak berpengaruh. Tabel `idempotency_keys` (migrasi 013) berisi **0 baris** — dan pada schema bersih migrasi 013 bahkan tidak pernah dijalankan karena `012_scheduled_jobs.sql` gagal (`column "enabled" does not exist`), sehingga `runMigrations` melempar dan `013`/`014` dilewati.
- **Manusia harus polling.** Notifikasi approval Telegram tidak menyertakan `reply_markup` (tanpa Inline Keyboard), dan `ApprovalCardRenderer` hanya dipakai di test. Status persetujuan dicek lewat `/status` atau dashboard `/approvals`.
- **Approval bisa menggantung.** TTL token approval 3600 detik (1 jam) dan token bersifat deterministik HMAC-SHA256 (`packages/policy/src/token-verifier.ts:13,25-28`); kedaluwarsa bersifat *lazy* tanpa sweeper, sehingga task dapat tertinggal di `approval_pending`. Status `revision_requested` tidak punya kelanjutan.
- QA bersifat **post-execution dan terminal**: verdict selain `PASS`/`PASS_WITH_WARNINGS` membuat task induk `failed` dan sintesis dilewati (`task-delegator.ts:353-371`); tidak ada loop rework untuk memperbaiki draf Hermes.
- Kegagalan run armada: 36 gagal, **27 di antaranya kegagalan kredensial** (`OpenRouter HTTP 401 "User not found"` ×15, `MODEL_API_KEY_MISSING` ×12).
- Biaya armada total `$0.0130`; sejak 3 Sep 2026 tiap run `$0.0000` karena tarif provider dinolkan (`packages/providers/src/openrouter.ts:18-19`). Jendela data run berakhir `2026-09-03T20:23Z` — platform idle.

## 🔗 Tautan Terkait

- [[020 - Agent Fleet MOC]]
- [[Chief - System Orchestrator]]
- [[Layla - Lead Scoring Specialist]]
- [[Ned - Research Specialist]]
- [[Argus - QA & Risk Gate Specialist]]
- [[Policy, Security & Approval Gates]]
- [[Task & Execution Pipeline]]

⬅️ Kembali ke [[000 - Home MOC]]
