---
title: "Layla - Lead Scoring Specialist"
scope: "second_brain"
category: "agent"
author: "Chief"
tags: [agent, layla, sales, lead-scoring, fleet]
updated: "2026-09-16"
---

# 🎯 Layla — Lead Scoring Specialist

Layla mengevaluasi kandidat prospek bisnis terhadap kriteria Ideal Customer Profile (ICP) memakai rubrik deterministik terbobot, lalu menghasilkan rekomendasi kualifikasi. Ia dipanggil sebagai subtask hasil delegasi [[Chief - System Orchestrator]], bukan oleh pengguna secara langsung.

## 📋 Ikhtisar Agent

| Parameter | Nilai |
| :--- | :--- |
| **ID** | `layla` |
| **Role** | `lead_scoring` |
| **Sumber definisi** | `packages/agents/src/definitions/layla.ts` — didaftarkan di `packages/agents/src/registry.ts:12-19` |
| **Jejak Eksekusi** | **2 run** (snapshot DB 16 Sep 2026) |
| **Tanggung Jawab Utama** | Enrichment prospek, penilaian ICP terbobot, penentuan status kualifikasi, dan rekomendasi prioritas tindak lanjut |

## 🎯 Format Output Wajib (Required Structure)

1. **Total Skor ICP**: 0–100.
2. **Rincian Skor per Dimensi**: Business Type Fit, Channel Count, Customer Volume, Retention Need, Responsiveness.
3. **Bukti Konkret & Rasional** untuk setiap poin nilai.
4. **Indikator Data Hilang**.
5. **Status Kualifikasi** — tepat satu di antara `qualified`, `needs_review`, `disqualified`.
6. **Rekomendasi Prioritas**: langkah pendekatan berikutnya.

## 🛑 Aturan Ketat (Rules)

1. **Deterministic Scoring** — Setiap poin nilai wajib dijustifikasi bukti terdokumentasi dari riset [[Ned - Research Specialist|Ned]]. Dilarang mengarang metrik prospek; atribut yang tidak diketahui diberi nilai 0 atau netral dan ditandai sebagai data hilang.
2. **Language Purity** — Seluruh evaluasi dalam bahasa target (Indonesia/Inggris) tanpa token bahasa asing.
3. **Weighted Rubric** — Pembobotan mengikuti rubrik versi yang berlaku; parameter dimasukkan ke alat skor, bukan dihitung bebas di luar alat. Lihat [[Lead Qualification Rubric v1]].

## 📏 Batas Eksekusi (dan Apa yang Sungguh-Sungguh Ditegakkan)

| Parameter | Nilai | Ditegakkan? | Anchor |
| :--- | :--- | :--- | :--- |
| `maxTurns` | **8** | ✅ Ya | `packages/orchestration/src/engine/agent-runner.ts:298` |
| `timeoutSeconds` | **180** s | ✅ Ya | `packages/orchestration/src/engine/agent-runner.ts:142-147` |
| `maxCostUsd` | **0.5** USD | ✅ Ya | `packages/orchestration/src/engine/agent-runner.ts:361-364` |
| `maxDelegationDepth` | **1** | ⚠️ Guard ada, praktis no-op | `task-delegator.ts:174-179`; `packages/policy/src/depth-guard.ts:12-40` |
| `temperature` | 0.2 (deklarasi) | ❌ Tidak pernah dibaca kode eksekusi | lihat bagian koreksi |

> **Depth anak tidak dipersistensi.** `task-delegator.ts:203` menghitung `depth` namun `taskRepo.create` tidak menuliskannya ⇒ **semua 55 task di DB `depth = 0`** dan `DepthGuard` tidak pernah menolak delegasi.

## 🛠️ Tools: Deklarasi vs Registrasi Nyata

Seluruh tool yang dideklarasikan Layla **benar-benar terdaftar** di worker — sama seperti [[Argus - QA & Risk Gate Specialist|Argus]], dan berbeda dari [[Chief - System Orchestrator|Chief]], [[Ned - Research Specialist|Ned]], dan [[Luna - Data & Market Analyst Specialist|Luna]] yang mendeklarasikan `second_brain.*`/`tasks.*` tanpa registrasi:

| Tool | Dideklarasikan | Terdaftar di worker | Catatan |
| :--- | :--- | :--- | :--- |
| `company.lookup` | ✅ | ✅ | Nyata (`apps/worker/src/worker.ts:100-129`) |
| `lead.enrich` | ✅ | ✅ | Nyata |
| `lead.score` | ✅ | ✅ | Rubrik deterministik; `riskLevel: 'low'`, tanpa approval (`packages/tools/src/tools/lead-scoring-tools.ts:14-17`) |
| `artifacts.read` | ✅ | ✅ | Nyata |
| `artifacts.write` | ✅ | ✅ | Nyata |

Allowlist lengkapnya di `packages/agents/src/definitions/layla.ts:32` — **tidak ada tool "hantu"** pada Layla.

Catatan: `registerLegacy` menyintesis metadata untuk tool tanpa manifest dengan `sideEffects: ['none']` (`packages/tools/src/registry.ts:86-110`), padahal `company.lookup`/`lead.enrich` melakukan egress jaringan — laporan side-effect-nya **under-report**.

## ⛔ Koreksi Penting: `modelPolicy` Tidak Dikonsumsi

- `temperature` (0.2) dan `fallbackTier` (`fast`) **tidak pernah dibaca kode eksekusi**; `AgentRunner` tidak meneruskan `temperature`/`maxTokens` ke provider, sehingga Layla efektif memakai default provider **0.2**.
- `modelPolicy` dipersistensikan ke kolom `model_policy` (`packages/database/src/agent-seeder.ts:7`) tetapi tidak dikonsumsi kode mana pun.
- Tidak ada rantai fallback antar model/provider.

## 🧪 Verifikasi Runtime

### Status Runtime (16 Sep 2026)

- **Jejak eksekusi**: `layla` **2 run** (distribusi armada: chief 54, argus 22, ned 15, hermes 13, layla 2, luna 0).
- **Tool-nya terdaftar dan nyata, tetapi belum pernah dipanggil**: DB mencatat **0 pemanggilan `lead.*` dan `company.*`** sepanjang 106 run. Total `tool_calls` sistem hanya 5 (`memory.search` 2 sukses + 1 gagal, `artifacts.write` 1, `artifacts.read` 1).
- Layla adalah langkah `step_2` pada rencana fallback alur lead: `ned` → `layla` → `hermes` → `argus` (`packages/orchestration/src/planner/task-planner.ts:137-180`), dengan `approval_points: ['communication.send_approved']`.
- QA bersifat **post-execution dan terminal**: verdict selain `PASS`/`PASS_WITH_WARNINGS` membuat task induk `failed` dan sintesis dilewati (`task-delegator.ts:353-371`). **Tidak ada loop rework** — `REVISION_REQUIRED` sama buntunya dengan `BLOCKED`, sehingga skor Layla yang ditolak tidak pernah dikembalikan untuk diperbaiki otomatis.
- Kegagalan run armada: 36 gagal, **27 di antaranya kegagalan kredensial** (`OpenRouter HTTP 401 "User not found"` ×15, `MODEL_API_KEY_MISSING` ×12). Sebagian sisanya verdict QA sah (`SCOPE MISMATCH`, `CRITICAL SCOPE MISMATCH`, `Truncated content`).
- Biaya armada total `$0.0130`; sejak 3 Sep 2026 tiap run `$0.0000` karena tarif provider dinolkan (`packages/providers/src/openrouter.ts:18-19`) ⇒ plafon `maxCostUsd` Layla tidak pernah menyala. Jendela data run berakhir `2026-09-03T20:23Z` — platform idle.

## 🔗 Tautan Terkait

- [[020 - Agent Fleet MOC]]
- [[Lead Qualification Rubric v1]]
- [[Chief - System Orchestrator]]
- [[Ned - Research Specialist]]
- [[Hermes - Content Specialist]]
- [[Argus - QA & Risk Gate Specialist]]
- [[Task & Execution Pipeline]]

⬅️ Kembali ke [[000 - Home MOC]]
