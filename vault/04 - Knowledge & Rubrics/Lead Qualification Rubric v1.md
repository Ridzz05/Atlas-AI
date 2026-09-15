---
title: "Lead Qualification Rubric v1"
scope: "second_brain"
category: "knowledge"
author: "Layla"
tags: [knowledge, rubric, lead-scoring, sales, icp]
updated: "2026-09-16"
---

# 🎯 Lead Qualification Rubric v1

Rubrik kualifikasi calon klien (*Lead Scoring Rubric*) berbasis Ideal Customer Profile (ICP) yang dieksekusi oleh [[Layla - Lead Scoring Specialist|Layla]] melalui tool `lead.score`.

> **Niat desain:** penilaian prospek yang **deterministik** (bukan opini LLM bebas), dengan bobot dimensi tetap, ambang batas eksplisit, dan tuntutan bukti per dimensi.

---

## 📊 Matriks Bobot Dimensi (Total: 100 Poin)

Bobot di bawah **cocok persis** dengan `DEFAULT_LEAD_RUBRIC.maxScores` (`packages/tools/src/scoring/rubric-engine.ts:74-85`):

| No | Dimensi Penilaian | Bobot Maksimal | Deskripsi |
| :---: | :--- | :---: | :--- |
| 1 | **`businessTypeFit`** | 15 Poin | Kesesuaian model bisnis prospek dengan ICP. |
| 2 | **`memberRetentionNeed`** | 15 Poin | Urgensi retensi pelanggan berulang (membership, paket berulang). |
| 3 | **`channelCount`** | 10 Poin | Jumlah titik komunikasi aktif milik prospek. |
| 4 | **`customerVolume`** | 10 Poin | Estimasi volume transaksi / jumlah member bulanan. |
| 5 | **`csAutomationPotential`** | 10 Poin | Potensi penghematan waktu bila layanan pelanggan diotomasi. |
| 6 | **`dataFreshness`** | 10 Poin | Kebaruan data kontak dan aktivitas terakhir. |
| 7 | **`digitalPresenceQuality`** | 8 Poin | Kerapian profil digital dan kelengkapan katalog produk. |
| 8 | **`responsiveness`** | 8 Poin | Kecepatan merespons pesan / keaktifan layanan pelanggan. |
| 9 | **`broadcastPotential`** | 8 Poin | Potensi pengiriman update jadwal, promo, atau pengingat masa berlaku. |
| 10 | **`decisionMakerEase`** | 6 Poin | Kemudahan menemukan dan menghubungi pengambil keputusan. |

Skor per dimensi divalidasi terhadap bobot maksimal; skor yang melebihi bobotnya **melempar error**, bukan dipotong diam-diam (`rubric-engine.ts:168-170`).

---

## ✅ Validasi Rubrik (Zod)

Definisi rubrik divalidasi `LeadRubricDefinitionSchema` dengan dua syarat keras (`rubric-engine.ts:44-70`):

1. **Total bobot wajib sama dengan 100** — selisih sekecil apa pun ditolak (`:54-61`).
2. **`qualified` wajib lebih besar dari `needsReview`** (`:62-68`).

Artinya rubrik yang tidak konsisten tidak bisa didaftarkan/hidup (`RubricEngine.register` dan `RubricEngine.hydrate` sama-sama memvalidasi).

---

## 🚦 Ambang Batas Kualifikasi (*Thresholds*)

Ambang tersimpan di `DEFAULT_LEAD_RUBRIC.thresholds` (`rubric-engine.ts:86-89`) dan diterapkan berurutan (`:179-186`):

| Status | Syarat | Rekomendasi sistem (teks asli kode) |
| :--- | :--- | :--- |
| 🟢 `qualified` | skor ≥ **80** (`:87`, `:179-181`) | *Top tier candidate — highly recommended for personalized WhatsApp CRM consultation.* |
| 🟡 `needs_review` | skor ≥ **60** (`:88`, `:182-184`) | *Moderate fit — needs secondary manual review on digital responsiveness before outreach.* |
| 🔴 `disqualified` | skor < 60 (`:185-187`) | *Low ICP fit — insufficient customer volume or retention requirement.* |

Skor akhir dibulatkan dan dijepit ke rentang 0–100 sebelum dibandingkan (`rubric-engine.ts:174-175`). Status hanya boleh salah satu dari `qualified | needs_review | disqualified` (`:107`).

---

## 🔍 Perilaku Nyata: Bukti Tidak Lengkap Menurunkan Status

Ini sering terlewat: bila ada dimensi berskor > 0 yang **tanpa bukti teks**, `RubricEngine.validateEvidence` menandainya sebagai tidak lengkap (`rubric-engine.ts:151-161`), lalu pada saat hasil dirakit:

- **`qualified` diturunkan menjadi `needs_review`** (`rubric-engine.ts:190-193`).
- Nama dimensi yang buktinya hilang ditempelkan ke awal teks rekomendasi (`:192`).
- Hasil akhir tetap membawa `evidenceComplete: false` dan daftar `missingEvidence` (`:203-204`).

Jadi skor tinggi tanpa bukti **tidak** menghasilkan status `qualified`.

---

## 💾 Persistensi Rubrik & Urutan Boot

- Versi rubrik dapat dipersistensi di tabel **`lead_rubrics`** (`LeadRubricRepository`).
- Saat boot, runtime memastikan rubric default ada (`ensureDefault`, versi `v1`, `createdBy: 'system'`), memuat daftar rubric tersimpan, mengambil rubric aktif, dan **melempar error bila tidak ada rubric aktif** (`packages/runtime/src/index.ts:122-135`).
- Rubric yang tidak ada di kumpulan hasil hidrasi juga ditolak (`rubric-engine.ts:134-135`), dan versi duplikat ditolak (`:129-130`).
- Jalur produksi defaultnya adalah tool `lead.score` (`LeadScoringTool`, `packages/tools/src/tools/lead-scoring-tools.ts:10`), bukan pemanggilan engine manual.

---

## 🧊 Status Runtime (16 Sep 2026)

| Aspek | Kenyataan |
| :--- | :--- |
| Tool terdaftar di worker? | **Ya.** `lead.score`, `lead.enrich`, dan `company.lookup` terdaftar bersama tool lain di worker (`apps/worker/src/worker.ts:100-129`). |
| Pernah dipanggil? | **Tidak, sekali pun.** Total `tool_calls` di DB hanya **5**: `memory.search` ×3 (2 sukses, 1 gagal), `artifacts.write` ×1, `artifacts.read` ×1. Tidak ada `lead.*`, `company.*`, `web.*`, maupun `communication.*`. |
| Volume kerja Layla | Hanya **2 run** tercatat (armada: chief 54, argus 22, ned 15, hermes 13, layla 2, luna 0). |
| Efek praktis | Rubrik ini **belum pernah dieksekusi pada satu lead nyata** — bobot, ambang, dan aturan bukti di atas baru terbukti lewat kode dan unit test (mis. `packages/tools/test/tools.test.ts:844` untuk kasus bukti tidak lengkap, `:945` untuk penolakan versi duplikat), belum lewat data produksi. |

---

## 🔗 Tautan Terkait

- [[040 - Knowledge Base & Rubrics MOC]]
- [[Layla - Lead Scoring Specialist]]
- [[Ned - Research Specialist]]
- [[Hermes - Content Specialist]]
- [[Task & Execution Pipeline]]
- [[Policy, Security & Approval Gates]]

---

⬅️ Kembali ke [[000 - Home MOC]]
