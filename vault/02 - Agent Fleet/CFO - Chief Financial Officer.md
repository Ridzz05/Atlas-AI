---
title: "CFO - Chief Financial Officer"
scope: "second_brain"
category: "agent"
author: "Chief"
tags: [agent, cfo, finance, executive, fleet, c-suite]
updated: "2026-09-19"
---

# 💰 CFO — Chief Financial Officer

CFO memegang mandat disiplin modal, pengawasan unit economics, dan penjagaan pagu anggaran komputasi dalam **ATLAS AI OS**. Memiliki hak veto atas inisiatif yang dinilai tidak efisien secara biaya.

## 📋 Ikhtisar Agent

| Parameter | Nilai |
| :--- | :--- |
| **ID** | `cfo` |
| **Role** | `cfo` |
| **Sumber definisi** | `packages/agents/src/definitions/cfo.ts` |
| **Tanggung Jawab Utama** | Audit estimasi biaya token, penerbitan Budget Envelope, analisis kelayakan ROI, penegakan pagu pengeluaran harian |
| **Fase SDLC yang Dimiliki** | **Fase 3: Budget & Financial Gate** |
| **Deliverable Output** | `BudgetEnvelope` (Cost Ceiling, Token Quotas, ROI Rationale, Verdict) |

## 🎯 Hak Istimewa & Aturan Finansial

1. **Auto-Approval**: Inisiatif dengan estimasi <= $1.00 disetujui otomatis dengan pagu standar.
2. **Conditional Gate**: Inisiatif $1.00 - $3.00 disetujui dengan peringatan dan batas token ketat.
3. **Veto & Escalation**: Inisiatif > $3.00 atau saat pagu harian menipis otomatis di-pause dan dieskalasikan ke Human Board.
