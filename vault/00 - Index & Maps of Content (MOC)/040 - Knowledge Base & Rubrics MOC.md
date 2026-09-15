---
title: "040 - Knowledge Base & Rubrics MOC"
scope: "second_brain"
category: "moc"
author: "Chief"
tags: [moc, knowledge, rubrics]
updated: "2026-09-16"
---

# 📚 Knowledge Base & Rubrics MOC

Peta navigasi basis pengetahuan bisnis, standar evaluasi deterministik, protokol memori, dan
lanskap model inferensi pada **ATLAS AI OS**.

---

## 📑 Catatan Domain Pengetahuan

1. [[Lead Qualification Rubric v1]] — Rubrik deterministik yang dipakai tool `lead.score`: 10 dimensi dengan bobot total 100, ambang `qualified` ≥ 80 dan `needsReview` ≥ 60, kelengkapan bukti, serta aturan penurunan status bila bukti tidak lengkap.
2. [[Personal Knowledge & Memory Protocol]] — Tiga lapis memori: `messages` (percakapan), `memory_items` (memori jangka panjang lewat `DatabaseMemoryStore`), dan Second Brain (indeks vault **in-process**, bukan vektor di database).
3. [[AI Model Provider Landscape]] — Provider yang didukung (`mock`, `openai`, `openai-compatible`, `openrouter`, `groq`, `ollama`, `deepseek`), penanganan `HTTP 429` dengan retry berjenjang tanpa jitter, dan **tidak adanya** rantai fallback otomatis.

---

## 🎯 Prinsip Evaluasi Deterministik

Seluruh penilaian dampak bisnis (skor lead, verdict QA, keputusan approve/reject) berada di
kode, bukan di tangan model:

| Penilaian | Mekanisme | Anchor |
| :--- | :--- | :--- |
| Skor lead | `RubricEngine` + rubric tervalidasi Zod, bobot wajib berjumlah 100 | `packages/tools/src/scoring/rubric-engine.ts:44-89` |
| Verdict QA | `QAGate`: hanya `PASS` dan `PASS_WITH_WARNINGS` dianggap lulus | `packages/orchestration/src/qa/qa-gate.ts:109` |
| Izin tool | `ApprovalMatrix` + allowlist per agent | `packages/tools/src/registry.ts:138-162` |
| Persetujuan manusia | Token HMAC sekali pakai, TTL 3600 detik | `packages/policy/src/token-verifier.ts:13,25-28` |

Konsekuensinya: model hanya mengusulkan, sedangkan mesin yang memutuskan. Inilah alasan
verdict QA yang tidak dikenal pun tetap berakhir `BLOCKED` (`qa-gate.ts:97-101`).

---

## ⚠️ Batasan yang Perlu Diingat

- Rubrik dan verdict sudah benar-benar dipakai; namun **tool `lead.*` belum pernah dipanggil
  sekali pun** sepanjang 106 run (hanya 5 pemanggilan tool tercatat untuk seluruh platform).
- Memori jangka panjang (`memory_items`) dan embedding (`memory_embeddings`) sama-sama
  berisi **0 baris**, sehingga "pengetahuan yang tumbuh" belum terwujud.
- `AI Model Provider Landscape` pada versi lama menyebut "strategi fallback otomatis" —
  klaim itu **dihapus** karena tidak ada rantai fallback di kode.

---

## 🔗 Navigasi

- [[000 - Home MOC]]
- [[010 - System Architecture MOC]]
- [[Second Brain & Grounded RAG]]
- [[Implementation Status & Known Gaps]]

---

⬅️ Kembali ke [[000 - Home MOC]]
