---
title: "CTO - Chief Technology Officer"
scope: "second_brain"
category: "agent"
author: "Chief"
tags: [agent, cto, technology, executive, fleet, c-suite]
updated: "2026-09-19"
---

# 🛠️ CTO — Chief Technology Officer

CTO menetapkan standar arsitektur sistem, kelayakan teknis perangkat lunak, kebijakan penggunaan alat (*tool policies*), serta batasan keamanan operasional dalam **ATLAS AI OS**.

## 📋 Ikhtisar Agent

| Parameter | Nilai |
| :--- | :--- |
| **ID** | `cto` |
| **Role** | `cto` |
| **Sumber definisi** | `packages/agents/src/definitions/cto.ts` |
| **Tanggung Jawab Utama** | Analisis kelayakan teknis dari Strategic Brief, penetapan whitelist tool yang diizinkan, perlindungan kredensial & privasi data |
| **Fase SDLC yang Dimiliki** | **Fase 2: Architecture & Design** |
| **Deliverable Output** | `TechnicalSpec` (Architecture Summary, Allowed/Disallowed Tools, Security Constraints, Verdict) |

## 🎯 Batasan & Kebijakan Keamanan

1. **Least-Privilege Tool Policy** — Hanya memberikan akses ke tool baca (read-only) secara default. Tool destruktif atau mutasi luar diblokir ketat.
2. **Credential Safety** — Memastikan token, kunci API, dan data sensitif selalu ter-masking.
