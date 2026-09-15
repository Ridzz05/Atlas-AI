---
title: "Luna - Data & Market Analyst Specialist"
scope: "second_brain"
category: "agent_profile"
author: "Chief"
agent_id: "luna"
role: "data_analyst"
tags: [agent, luna, analytics, data, market_analysis]
updated: "2026-09-16"
---

# 📊 Luna - Data & Market Analyst Specialist

Profil operasional, tanggung jawab, dan protokol kerja untuk **Luna**, spesialis analisis data dan pasar dalam armada **ATLAS AI OS**. Luna adalah agent yang **terdaftar resmi namun belum pernah dieksekusi** — statusnya dijelaskan jujur di bagian Verifikasi Runtime.

---

## 📋 Ikhtisar Agent

| Parameter | Nilai |
| :--- | :--- |
| **Agent ID** | `luna` |
| **Nama** | Luna |
| **Role** | `data_analyst` |
| **Peran Utama** | Data & Market Analyst Specialist |
| **Sumber definisi** | `packages/agents/src/definitions/luna.ts` — didaftarkan di `packages/agents/src/registry.ts:12-19` |
| **Target Reviewer** | [[Argus - QA & Risk Gate Specialist]] |
| **Jejak Eksekusi** | **0 run** (snapshot DB 16 Sep 2026) |

---

## 🎯 Tanggung Jawab Utama

1. **Pemrosesan Dataset Mentah**: mengambil temuan mentah dari riset web [[Ned - Research Specialist]] atau input pengguna, lalu menata data numerik (harga, tarif, jumlah pengguna, estimasi trafik, margin).
2. **Analisis Komparatif & Statistik**: rata-rata, median, rentang harga, perbandingan antar kompetitor, tabel komparasi multidimensi berformat Markdown.
3. **Identifikasi Peluang & Kelayakan Bisnis**: ekstraksi wawasan strategis dan celah pasar berdasarkan bukti empiris.
4. **Dokumentasi Keterbatasan Data**: mencatat asumsi yang belum terverifikasi dan variabel yang hilang secara transparan.

---

## 🎯 Format Output Wajib (Required Structure)

1. **Executive Summary**: intisari kesimpulan analitik ringkas.
2. **Quantitative Breakdown**: tabel komparasi terstruktur (metrik, harga, volume, estimasi pasar).
3. **Key Findings & Trends**: pola statistik, anomali, tren dominan.
4. **Strategic Opportunities / Feasibility**: rekomendasi aksi turunan data terverifikasi.
5. **Data Limitations & Missing Variables**: catatan variabel yang belum dapat dipastikan.

---

## 🛑 Aturan Ketat (Rules)

1. **Strict Numerical Integrity** — Semua angka, rata-rata, dan perbandingan bersumber dari data riset riil atau input pengguna. Dilarang mengarang persentase, angka statistik, atau tingkat pertumbuhan.
2. **Structured Comparisons** — Perbandingan multivariabel wajib berupa tabel Markdown yang rapi.
3. **Language Purity** — Seluruh output dalam bahasa target (Indonesia/Inggris) tanpa karakter asing (mis. Mandarin).
4. **Actionable Insights** — Angka wajib dihubungkan ke dampak bisnis praktis (mis. perbandingan margin, kelayakan segmen).
5. **Audit Discipline** — Klaim yang tidak dapat diverifikasi wajib dicatat di bawah *Data Limitations*.

---

## 📏 Batas Eksekusi (dan Apa yang Sungguh-Sungguh Ditegakkan)

| Parameter | Nilai | Ditegakkan? | Anchor |
| :--- | :--- | :--- | :--- |
| `maxTurns` | **10** | ✅ Ya | `packages/orchestration/src/engine/agent-runner.ts:298` |
| `timeoutSeconds` | **180** s | ✅ Ya | `packages/orchestration/src/engine/agent-runner.ts:142-147` |
| `maxCostUsd` | **0.75** USD | ✅ Ya | `packages/orchestration/src/engine/agent-runner.ts:361-364` |
| `maxDelegationDepth` | **1** | ⚠️ Guard ada, praktis no-op | `task-delegator.ts:174-179`; `packages/policy/src/depth-guard.ts:12-40` |
| `temperature` | 0.15 (deklarasi) | ❌ Tidak pernah dibaca kode eksekusi | lihat bagian koreksi |

> **Depth tidak pernah dipersistensi.** `task-delegator.ts:203` menghitung `depth` anak, tetapi `taskRepo.create` tidak menuliskannya ⇒ **semua 55 task di DB `depth = 0`** dan `DepthGuard` praktis no-op.

---

## 🛠️ Tools: Deklarasi vs Registrasi Nyata

Deklarasi allowlist (`packages/agents/src/definitions/luna.ts:33-40`) vs registrasi worker (`apps/worker/src/worker.ts:100-129`):

| Tool | Dideklarasikan | Terdaftar di worker | Catatan |
| :--- | :--- | :--- | :--- |
| `artifacts.read` | ✅ | ✅ | Benar-benar tersedia |
| `artifacts.write` | ✅ | ✅ | Benar-benar tersedia |
| `memory.search` | ✅ | ✅ | Benar-benar tersedia |
| `second_brain.search` | ✅ | ❌ | Gagal `Tool 'second_brain.search' not found in Tool Gateway registry.` |
| `second_brain.read_note` | ✅ | ❌ | idem |
| `second_brain.list_notes` | ✅ | ❌ | idem |

Konsekuensi arsitektural untuk tool `second_brain.*`: selain tidak terdaftar, indeks Second Brain disimpan sebagai `Map` di memori proses (`packages/memory/src/second-brain/vault-ingestion-service.ts:25-26`) dan `SecondBrainService` **tidak pernah diinstansiasi di worker** — hanya di `apps/agent-service/src/server.ts:324-326`. Karena agent berjalan di proses worker, hasil `pnpm brain:sync` pun tidak akan pernah terlihat oleh Luna meski tool-nya didaftarkan.

---

## ⛔ Koreksi Penting: `modelPolicy` Tidak Dikonsumsi

- Baris lama "Balanced (fallback: Fast, temp: 0.15)" hanya **deklarasi**. `temperature` dan `fallbackTier` tidak pernah dibaca kode eksekusi; `AgentRunner` tidak meneruskan `temperature`/`maxTokens` ke provider, jadi Luna (bila dijalankan) efektif memakai default provider **0.2**.
- `modelPolicy` dipersistensikan ke kolom `model_policy` (`packages/database/src/agent-seeder.ts:7`) tetapi tidak ada konsumer di jalur eksekusi.
- Tidak ada rantai fallback antar model/provider.

---

## 🧪 Verifikasi Runtime

### Status Runtime (16 Sep 2026)

- **`luna` belum pernah dieksekusi: 0 run.** Ini satu-satunya agent di armada tanpa jejak eksekusi (distribusi: chief 54, argus 22, ned 15, hermes 13, layla 2, luna 0).
- **Luna memang ditawarkan ke planner.** Prompt planner menyebut agent ID yang sah — `ned, luna, layla, hermes, argus` (`packages/orchestration/src/planner/task-planner.ts:56`) — dan `PlanValidator` hanya memeriksa keanggotaan registry, sehingga step ber-`agent: 'luna'` akan lolos validasi.
- **Rencana fallback tidak memuat Luna.** `generateFallbackPlan` (`task-planner.ts:134-216`) hanya menyusun langkah `ned`, `layla`, `hermes`, `argus` (alur lead) atau `ned`, `argus` (alur umum). `[INFERENCE]` Karena fallback inilah jalur yang paling sering terpakai saat plan LLM gagal, Luna tidak pernah terpilih.
- Batas eksekusinya sendiri belum pernah diuji runtime: `maxTurns` 10 / `timeoutSeconds` 180 / `maxCostUsd` 0.75 semuanya belum pernah menyala.
- Konteks armada: 36 dari 106 run gagal, **27 di antaranya kegagalan kredensial** (`OpenRouter HTTP 401 "User not found"` ×15, `MODEL_API_KEY_MISSING` ×12); jendela data run berakhir `2026-09-03T20:23Z` dan platform idle sejak itu.
- Biaya armada total `$0.0130`; sejak 3 Sep 2026 tiap run `$0.0000` karena tarif provider dinolkan (`packages/providers/src/openrouter.ts:18-19`).
- QA bersifat **post-execution dan terminal**: verdict selain `PASS`/`PASS_WITH_WARNINGS` membuat task induk `failed` dan sintesis dilewati (`task-delegator.ts:353-371`); tidak ada loop rework, sehingga tidak ada mekanisme yang "memaksa" Luna ikut dalam plan berikutnya.

---

## 🔗 Tautan Navigasi

- Armada Agent: [[020 - Agent Fleet MOC]]
- Peneliti Data: [[Ned - Research Specialist]]
- Kualifikasi Prospek: [[Layla - Lead Scoring Specialist]]
- Penyusun Draf: [[Hermes - Content Specialist]]
- Wasit Kualitas: [[Argus - QA & Risk Gate Specialist]]
- Pengarah Orkestrasi: [[Chief - System Orchestrator]]
- Pipeline: [[Task & Execution Pipeline]]
- Indeks Vault: [[Second Brain & Grounded RAG]]

⬅️ Kembali ke [[000 - Home MOC]]
