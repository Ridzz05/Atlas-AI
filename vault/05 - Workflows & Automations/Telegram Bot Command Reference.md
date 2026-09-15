---
title: "Telegram Bot Command Reference"
scope: "second_brain"
category: "workflows"
author: "Chief"
tags: [workflows, telegram, commands, control, bot]
updated: "2026-09-16"
---

# 📱 Telegram Bot Command Reference

Permukaan kendali manusia untuk **ATLAS AI OS** lewat Telegram: intake task, status sistem, jeda darurat, biaya, dan keputusan approval. Catatan ini memuat **daftar perintah yang benar-benar dikenal kode**, plus batas nyatanya per 16 Sep 2026 — terutama bahwa **tidak ada tombol interaktif** dan **tidak ada notifikasi push**.

---

## 📜 Daftar Perintah Nyata

Sumber tunggal: `apps/telegram-bot/src/handlers/commands.ts:32-76` (switch `handle`; `case 'approve'|'reject'|'revise'` ada di `:67-74`). Perintah dikenali **case-insensitive** dan boleh ditulis dengan atau tanpa `/`.

| Perintah | Argumen | Yang terjadi |
| :--- | :--- | :--- |
| `/help` | — | Mengirim teks command reference (handler yang sama dengan `/start`). |
| `/start` | — | Idem `/help`. |
| `/agents` | — | Menampilkan roster agent inti. |
| `/status` | — | Menampilkan task aktif & yang mengantre. |
| `/task` | `<id>` | Detail satu task. |
| `/new` | `<goal>` | Membuat task baru untuk [[Chief - System Orchestrator|Chief]]. |
| `/pause` | — | Menyetel sistem **paused**; tidak ada task baru yang di-dispatch ke worker sampai di-resume. |
| `/resume` | — | Melanjutkan intake task dan dispatch worker. |
| `/stop` | `<taskId>` | Membatalkan satu task aktif. |
| `/emergency_stop` | — | **Perintah darurat**: membatalkan semua run dan membekukan aksi eksternal. |
| `/cost` | — | Ringkasan biaya. |
| `/approve` | `<id>` | Menyetujui aksi yang menunggu keputusan (`handleApproveDurable`). |
| `/reject` | `<id>` | Menolak aksi yang menunggu keputusan. |
| `/revise` | `<id> <notes>` | Meminta revisi atas aksi yang menunggu keputusan. |

Catatan bentuk: `emergency_stop` memakai **garis bawah**, dan `/task`, `/stop`, `/approve`, `/reject`, `/revise` **membutuhkan argumen**.

### ⚠️ Jebakan: `/emergency-stop` Tidak Dikenal

Perintah darurat adalah **`/emergency_stop`** (garis bawah). Menulis `/emergency-stop` (tanda hubung) **tidak dikenal** dan akan dijawab:

```
Unknown command: `/emergency-stop`. Use `/help` to see available commands.
```

Jadi salah ketik pada perintah darurat = tidak ada yang terjadi, bukan fallback.

---

## 💬 Pesan Teks Bebas Dianggap Task Baru

Setiap pesan yang **tidak** diawali `/` diperlakukan sebagai task baru untuk Chief — sama seperti `/new`. Cabangnya dipilih lewat pemeriksaan `text.startsWith('/')` (`apps/telegram-bot/src/bot.ts:191`); bila tidak diawali `/`, teks mentah langsung dikirim sebagai argumen goal (`:198-199`).

Tidak ada mode percakapan bebas terpisah: obrolan santai pun masuk sebagai goal task.

---

## 🔔 Tidak Ada Tombol Inline & Tidak Ada Notifikasi Push

Bagian "Inline Keyboard" pada dokumentasi lama **salah** dan sudah dihapus dari catatan ini. Kenyataan kodenya:

- Pengiriman pesan Telegram memakai `sendMessage` dengan payload `{ chat_id, text }` — **tanpa `reply_markup`**. Tidak ada tombol 🟢 Approve / 🔴 Reject.
- `ApprovalCardRenderer` **hanya dipakai di test**, tidak di jalur produksi.
- **Tidak ada notifikasi push.** Saat agent menunggu approval, tidak ada pesan yang dikirim ke manusia.

**Konsekuensi operasional:** manusia harus **polling** — `/status` di Telegram, atau halaman **`/approvals`** di dashboard. Permintaan approval tidak akan "muncul sendiri".

---

## 🧵 Transport: Klien HTTP Sendiri + Polling `getUpdates`

Bot **tidak memakai `grammy`**. Ia memakai klien HTTP buatan sendiri, `FetchTelegramApiClient`, yang memanggil `getUpdates` secara polling (`apps/telegram-bot/src/bot.ts:62` mendefinisikan klien, `:276-282` adalah loop polling `while (!signal.aborted)`, dimulai dari `:221`). Bila konfigurasi tidak menandai mode polling (`isPolling` false), service **menolak start** (`:208-210`) dan meminta `TELEGRAM_WEBHOOK_SECRET` di-unset agar kembali ke polling.

Health service Telegram ada di port **8082** (`packages/shared/src/schemas/config.ts:20-23`).

---

## 🔐 Keamanan: Allowlist Pengguna **Fail-Open Saat Kosong**

Guard pengguna (`apps/telegram-bot/src/security/guard.ts:16-28`) membalik default pada mode pengembangan: bila `TELEGRAM_ALLOWED_USER_IDS` **kosong**, ia menulis log peringatan lalu **mengizinkan** permintaan (`:19-22`). Siapa pun yang menemukan bot dapat mengirim perintah.

> ⚠️ Komentar di `guard.ts:18` berbunyi *"but in production strictly enforce"* — **tidak ada
> satu pun pemeriksaan `NODE_ENV`** di guard ini. Komentar itu tidak mencerminkan kode.

Kabar baiknya, jalur produksi menutup celah ini di dua lapis:

1. `parseTelegramConfig` **melempar error** bila `NODE_ENV === 'production'` dan allowlist kosong (`apps/telegram-bot/src/config.ts:20-21`) — bot menolak start.
2. Compose produksi mewajibkan variabel itu terisi (`TELEGRAM_ALLOWED_USER_IDS:?`).

> ⚠️ Yang menutup celah ini adalah **lapisan config, bukan guard-nya**. Guard sendiri tidak
> memeriksa `NODE_ENV` sama sekali: bila konstruktornya menerima allowlist kosong, ia
> mengizinkan siapa pun di lingkungan mana pun. Yang mencegahnya di produksi adalah
> `parseTelegramConfig` yang menolak boot lebih dulu. Jangan mengandalkannya: jalankan
> pengembangan dengan allowlist terisi, dan ingat bahwa siapa pun di jaringan lokal yang
> bisa menjangkau service itu dapat mengendalikan sistem.

Guard yang sama juga men-deduplikasi update Telegram lewat `isDuplicateUpdate`
(`guard.ts:31-48`), memakai `updateStore` (`claimUpdate`) bila tersedia, atau cache
in-memory maksimum 10.000 ID (`:9`, `:40-44`).

---

## ⏳ Approval Token & Dua Jalan Buntu

Berlaku untuk `/approve`, `/reject`, dan `/revise`:

- **TTL token = 3600 detik (1 jam)** — bukan 15 menit (`packages/policy/src/token-verifier.ts:13`).
- Token **deterministik**: `HMAC-SHA256(secret, requestId:action:payloadHash:expiresAt)` (`token-verifier.ts:25-28`), bukan angka acak.
- **Kedaluwarsa bersifat lazy**: tidak ada sweeper yang menyapu token kedaluwarsa. Task bisa tertinggal `approval_pending` **selamanya** bila tidak ada yang memutuskan.
- **`revision_requested` tidak punya kelanjutan** (dead end), tetapi bukan status task: `/revise` memanggil `approvalRepo.decide(id, 'revision_requested', actor, notes)` yang hanya `UPDATE approvals SET status = …` (`packages/database/src/repositories/approval.repository.ts:27-38`; pemanggil di `apps/telegram-bot/src/handlers/commands.ts:380`). **Status task tidak berubah** — ia tetap `approval_pending`, dan `revision_requested` bukan anggota enum status task (`packages/shared/src/schemas/task.ts:3-13`).

Detail lengkap kebijakan ada di [[Policy, Security & Approval Gates]].

---

## 📊 Status Runtime (16 Sep 2026)

| Fakta | Nilai |
| :--- | :--- |
| `telegram_updates` | **0 baris** |
| `approvals` | **0 baris** |
| Event `approval.*` di `event_outbox` | **0** |
| `tasks` | **55** (40 `completed`, 10 `failed`, **5 macet di `running`**) |
| `runs` | **106** (70 `completed`, 36 `failed`) |
| Jendela data run | `2026-08-28T18:50Z` → `2026-09-03T20:23Z` (platform idle sejak itu) |

Artinya: perintah dasar (`/new`, `/status`) sudah pernah dipakai untuk menghasilkan 55 task `[INFERENCE]`, tetapi **jalur approval belum pernah dieksekusi sekali pun** — `/approve`, `/reject`, `/revise` secara praktis belum terbukti bekerja, dan kelima task berstatus `running` menunjukkan pemulihan tidak selalu tuntas `[INFERENCE]` (lihat [[Disaster Recovery & Lease Watchdog]]).

---

## 🔗 Tautan Terkait

- [[050 - Automations & Workflows MOC]]
- [[Chief - System Orchestrator]]
- [[Policy, Security & Approval Gates]]
- [[Task & Execution Pipeline]]
- [[Disaster Recovery & Lease Watchdog]]

---

⬅️ Kembali ke [[000 - Home MOC]]
