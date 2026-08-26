# ATLAS AI OS — Implementation Blueprint

> Blueprint teknis untuk membangun sistem orkestrasi multi-agent yang dikendalikan melalui Telegram, memiliki shared memory, task delegation, human approval, dan dashboard observability real-time.

| Metadata | Nilai |
|---|---|
| Status | Core MVP wired; production release gate pending |
| Versi | 0.1.0 |
| Tanggal | 26 Agustus 2026 |
| Target awal | Single-user, self-hosted, production-aware MVP |
| Deployment utama | Ubuntu VPS menggunakan Docker Compose |
| Bahasa utama | TypeScript |

> Follow-up reliability checkpoint (26 August 2026): commits `61bb83f`, `bfdbb09`, and `4121b3d` add paginated startup/periodic recovery for persisted `queued` tasks and CI smoke coverage. Commits `e2992df` and `1d00576` make the OpenAI-compatible provider honor `max_tokens` and preserve a `length` completion result. Commit `76837ea` classifies provider rejections caused by the watchdog as `timed_out` while preserving user/process cancellation as `cancelled`. The local worker suite now passes 10 tests; Docker-backed cross-process recovery remains a release criterion.

> Research provider checkpoint (26 August 2026): commits `98ea6f6` and `a083c83` add an opt-in Brave adapter for `web.search`, `web.fetch_safe`, `company.lookup`, and `lead.enrich`, including strict environment validation, public-DNS/redirect/size/timeout controls, DNS-pinned Node transport, untrusted-content evidence, runtime/worker wiring, and provider-to-Tool-Gateway regression coverage. The default remains `RESEARCH_PROVIDER=none`; live API verification and clean-host operations testing remain release criteria.

> Task integrity and communications checkpoint (26 August 2026): commits `0d25fb7` and `6279440` normalize watchdog timeouts to valid task `failed` state, publish task lifecycle events for API/plan execution, and add a database status constraint with migration repair. Commit `bac3083` persists API and Telegram task-intake messages and replaces the dashboard's browser-local command log with a durable messages/tool-call feed that refreshes from authenticated SSE events. Tool payload input/output is intentionally not rendered in the dashboard.

> Implementation checkpoint (26 August 2026): DB/Redis runtime composition, BullMQ, transactional agent seeding, fail-closed DB/queue readiness probes, request-ID correlation, validated task filters/pagination/resource IDs, PostgreSQL event outbox, API auth/CORS/Redis-backed rate limiting, dependency-aware worker/Telegram readiness, production Compose healthchecks, PostgreSQL migration advisory locking, plan validation, fail-closed QA/approval paths, durable approval request/decision/token/claim/finalize/resume, cross-process run cancellation, Telegram polling with durable update/control state, persisted orchestration history, scoped MemoryTools with expiry enforcement at search and direct lookup boundaries, verified-only agent memory search, scheduled expiry/deprecation/deletion maintenance with canonical-memory audit records, authenticated event streaming with reconnect replay, durable global/per-run budget reservation and settlement, worker leases/heartbeats/stale-run recovery, configured delegation depth enforcement, versioned lead rubric and per-dimension evidence validation, persisted versioned rubric storage with active-version bootstrap hydration, deterministic `lead.score`, provider-output evidence contracts, registered `web.fetch_safe`/`lead.enrich` research boundaries with safe URL, public-hostname, and untrusted-content handling, `policy.verify`, metadata repositories/APIs, worker recovery telemetry, aggregate cost/budget metrics, read-only governance settings, authenticated and audited agent-service rubric control API, API-backed dashboard observability pages with durable pause/resume/emergency-stop controls and versioned server-side proxy routing, Tool Gateway output-schema enforcement with timeout-driven `AbortSignal` propagation, patched dashboard dependencies, durable Telegram `/cost` and `/status` telemetry, fail-closed production model-provider configuration, strict fail-closed parsing of the external-write environment flag, and fail-closed policy handling for every registered external/production side-effect action are implemented and locally tested through commit `76837ea`; the opt-in research provider and DNS-pinned safe-fetch slice is recorded in `98ea6f6` and `a083c83`. The dashboard dependency tree is pinned to Next.js 15.5.24, sharp 0.35.3, and PostCSS 8.5.26; `pnpm audit --audit-level high` reports zero high/critical findings and `pnpm audit signatures` verifies 332 packages. Repository formatting is enforced by Prettier 3.9.6 and `pnpm format:check` passes in CI. Docker build contexts now exclude local secrets and generated/runtime data through `.dockerignore`. A CI Docker Compose boot/readiness/restart/backup-restore smoke job is now defined, but its first successful remote run remains pending. External writes remain disabled: an approved outbound connector, a live-verified research provider, clean-environment recovery drills, backup verification, and production operations controls remain before release. See [`tasks/plan.md`](tasks/plan.md) and [`RUNBOOK.md`](RUNBOOK.md) for evidence and operating constraints.

---

## 1. Ringkasan Eksekutif

ATLAS AI OS adalah sistem tempat satu manusia berkomunikasi dengan satu agent utama bernama **Chief**. Chief bertugas memahami tujuan, menyusun rencana, membagi pekerjaan kepada specialist agents, mengawasi hasil, meminta pemeriksaan QA, dan mengembalikan ringkasan final kepada manusia.

Sistem ini **bukan kumpulan chatbot terpisah** dan bukan simulasi perusahaan semata. Setiap agent merupakan runtime terkontrol yang memiliki:

- system prompt dan tanggung jawab yang spesifik;
- daftar tools yang diizinkan;
- akses terbatas ke shared memory;
- budget, timeout, dan batas delegasi;
- task state yang persisten;
- audit trail atas setiap keputusan dan tindakan;
- human approval untuk tindakan berdampak tinggi.

MVP dimulai dengan lima agent inti:

1. **Chief** — orchestrator dan satu-satunya pintu komunikasi utama.
2. **Ned** — research dan information enrichment.
3. **Layla** — sales, lead qualification, dan scoring.
4. **Hermes** — content, copywriting, dan communication drafting.
5. **Argus** — QA, verification, risk, dan policy checking.

Jumlah agent sengaja dibatasi pada tahap awal. Agent baru hanya ditambahkan setelah ada workflow yang jelas, measurable, dan tidak dapat diselesaikan lebih baik oleh agent yang sudah tersedia.

---

## 2. Tujuan Produk

### 2.1 Tujuan utama

Membangun sebuah AI operating system pribadi yang mampu:

- menerima instruksi natural language melalui Telegram dan dashboard;
- mengubah instruksi menjadi task plan yang terstruktur;
- mendelegasikan subtask kepada agent yang tepat;
- menjalankan agent secara paralel bila aman dan berguna;
- menyimpan percakapan, keputusan, hasil, dan knowledge secara persisten;
- menggunakan tools eksternal melalui kontrak yang terkontrol;
- menunjukkan pekerjaan agent secara real-time;
- meminta persetujuan manusia sebelum tindakan sensitif;
- memulihkan task setelah restart atau kegagalan worker;
- mengukur kualitas, biaya, latency, dan tingkat keberhasilan.

### 2.2 Target pengalaman pengguna

Contoh interaksi yang ditargetkan:

> **User:** Cari 50 calon klien gym di Palembang, nilai kecocokannya untuk layanan WhatsApp CRM kita, dan siapkan pendekatan untuk 10 prospek terbaik. Jangan kirim apa pun sebelum aku menyetujuinya.

Chief kemudian:

1. membuat parent task;
2. meminta Ned mencari dan memperkaya data;
3. meminta Layla menilai lead menggunakan rubric yang tersimpan;
4. meminta Hermes membuat outreach draft;
5. meminta Argus memvalidasi data dan klaim;
6. menyimpan semua output sebagai artifacts;
7. mengirim ringkasan serta tombol **Approve**, **Revise**, dan **Reject**;
8. tidak menghubungi prospek sampai user memberikan persetujuan eksplisit.

### 2.3 Indikator keberhasilan MVP

- Minimal 90% task sederhana selesai tanpa kehilangan state.
- Semua tool call tercatat beserta actor, input, output, durasi, dan status.
- Tidak ada external write action tanpa approval bila policy mewajibkannya.
- Chief dapat mendelegasikan minimal tiga subtask dalam satu parent task.
- Agent dapat dilanjutkan setelah aplikasi atau worker direstart.
- User dapat menghentikan seluruh eksekusi melalui Telegram atau dashboard.
- Jawaban final memiliki tautan ke sumber atau artifact yang digunakan.

---

## 3. Non-Goals MVP

Hal berikut tidak menjadi target versi pertama:

- menjalankan puluhan agent secara bersamaan;
- memberikan akses shell tanpa sandbox;
- mengirim mass outreach secara otomatis;
- mengambil keputusan finansial atau hukum tanpa manusia;
- memberi agent akses penuh ke seluruh VPS;
- membangun marketplace agent;
- multi-tenant SaaS;
- autonomous self-modification;
- fine-tuning model sendiri;
- menggantikan seluruh aktivitas manusia dalam bisnis.

---

## 4. Prinsip Desain

1. **Human owns the outcome**  
   Agent dapat merencanakan dan mengerjakan, tetapi manusia tetap pemilik keputusan akhir.

2. **Least privilege by default**  
   Agent hanya menerima tool dan data minimum yang dibutuhkan.

3. **Persist before execute**  
   Task, plan, dan intended action disimpan sebelum pekerjaan dimulai.

4. **Artifacts over chat-only output**  
   Output penting disimpan sebagai artifact yang dapat diperiksa, dibanding hanya berada di conversation buffer.

5. **Every action is auditable**  
   Semua delegasi, tool call, approval, retry, dan perubahan state dicatat.

6. **Deterministic control, probabilistic reasoning**  
   LLM dipakai untuk reasoning. Permission, state transition, budget, dan approval ditangani kode deterministik.

7. **Fail closed**  
   Bila policy, credential, atau approval tidak jelas, tindakan tidak dijalankan.

8. **No agent theater**  
   Status `WORKING` hanya tampil bila ada run aktif. Dashboard tidak boleh mensimulasikan aktivitas palsu.

---

## 5. Arsitektur Tingkat Tinggi

```mermaid
flowchart TD
    U["User"] --> TG["Telegram / Web UI"]
    TG --> GW["Command Gateway"]
    GW --> CH["Chief Orchestrator"]
    CH --> Q["Task Queue"]
    Q --> WK["Agent Workers"]
    WK --> TL["Tool Gateway"]
    WK <--> MM["Shared Memory"]
    CH --> AP["Approval Engine"]
    CH --> EV["Event Stream"]
    EV --> UI["ATLAS Dashboard"]
    AP --> TG
```

### 5.1 Komponen inti

| Komponen | Tanggung jawab |
|---|---|
| Telegram Bot | Input/output mobile, approval, status, emergency stop |
| Web Dashboard | Command center, task graph, comms, memory, approvals, settings |
| Command Gateway | Authentication, normalization, rate limiting, command routing |
| Chief Orchestrator | Planning, delegation, synthesis, escalation |
| Task Queue | Menjadwalkan run, retry, concurrency, delayed jobs |
| Agent Workers | Menjalankan specialist agents dalam process terpisah |
| Tool Gateway | Policy enforcement untuk semua integrasi dan side effects |
| Shared Memory | Knowledge, event, task, conversation, dan artifact persistence |
| Approval Engine | Menentukan tindakan yang membutuhkan persetujuan manusia |
| Event Stream | Mengirim status real-time ke dashboard |
| Audit Service | Append-only record untuk tindakan dan perubahan penting |

---

## 6. Keputusan Teknologi

### 6.1 Stack MVP yang direkomendasikan

| Layer | Teknologi | Alasan |
|---|---|---|
| Monorepo | pnpm workspaces + Turborepo | Shared types dan pemisahan app/worker yang rapi |
| Dashboard | Next.js App Router + TypeScript | Cepat untuk UI dashboard dan API ringan |
| UI | Tailwind CSS + shadcn/ui + Framer Motion | Konsisten, cepat, dan cocok untuk visual agent graph |
| Agent service | Node.js TypeScript + Fastify | Runtime worker ringan dan mudah diobservasi |
| Queue | Redis + BullMQ | Retry, concurrency, delayed jobs, recovery |
| Database | PostgreSQL | Transaksi, durability, dan skalabilitas |
| Semantic retrieval | pgvector | Menyimpan embedding di database yang sama |
| Realtime | PostgreSQL-backed Server-Sent Events (SSE) | Event stream terautentikasi dengan reconnect replay melalui `Last-Event-ID` |
| Validation | Zod | Shared runtime schemas |
| Telegram | Telegram Bot API | Command interface utama dari ponsel |
| Agent tools | MCP-compatible tool gateway | Kontrak tool terstandar dan dapat dikembangkan |
| Storage | Local/S3-compatible object storage | Artifact, report, CSV, gambar, dan export |
| Deployment | Docker Compose + reverse proxy | Cocok untuk single VPS dan mudah dipulihkan |
| Observability | Structured logs + metrics + traces | Debugging multi-agent membutuhkan bukti, bukan tebakan |

### 6.2 Model provider strategy

Gunakan adapter agar sistem tidak terkunci pada satu provider:

```ts
interface ModelProvider {
  run(request: AgentRunRequest): AsyncIterable<AgentEvent>;
  estimateCost(request: AgentRunRequest): Promise<CostEstimate>;
  cancel(runId: string): Promise<void>;
}
```

Provider yang tersedia melalui adapter saat ini:

- OpenAI;
- OpenAI-compatible;
- Groq;
- DeepSeek;
- Ollama melalui base URL yang dikonfigurasi.

Claude-compatible dan provider lain masih dapat ditambahkan sebagai adapter terpisah. Untuk production, `MODEL_PROVIDER` harus eksplisit dan bukan `mock`; provider non-OpenAI memerlukan `MODEL_NAME`, provider berbasis jaringan memerlukan `MODEL_API_KEY`, dan Ollama memerlukan `MODEL_BASE_URL`.

Untuk eksperimen lokal, runtime berbasis CLI dapat disediakan sebagai adapter terpisah. Untuk production, gunakan autentikasi resmi dan billing yang dapat diaudit.

### 6.3 Mengapa tidak hanya Next.js API routes

Agent run dapat berlangsung lama, membutuhkan retry, cancellation, concurrency control, dan pemulihan setelah restart. Karena itu:

- Next.js menangani dashboard dan proxy terautentikasi; Fastify agent-service menangani control API;
- agent worker berjalan sebagai service terpisah;
- queue menjadi boundary antara request singkat dan pekerjaan jangka panjang.

---

## 7. Struktur Monorepo

```text
atlas-ai-os/
├── apps/
│   ├── dashboard/                # Next.js dashboard
│   ├── agent-service/            # Fastify orchestration API
│   ├── worker/                   # BullMQ agent workers
│   └── telegram-bot/             # Telegram webhook/polling service
├── packages/
│   ├── agents/                   # Agent definitions dan prompts
│   ├── orchestration/            # Planner, router, delegation, synthesis
│   ├── memory/                   # Retrieval, ingestion, summarization
│   ├── tools/                    # Tool registry dan implementations
│   ├── policy/                   # Permissions dan approval rules
│   ├── database/                 # Schema, migrations, repositories
│   ├── events/                   # Event schemas dan event bus
│   ├── providers/                # LLM provider adapters
│   ├── shared/                   # Shared types, Zod schemas, utilities
│   └── observability/            # Logging, metrics, tracing
├── infrastructure/
│   ├── docker/
│   ├── nginx/
│   └── scripts/
├── docs/
│   ├── architecture.md
│   ├── security.md
│   ├── tools.md
│   └── runbooks.md
├── tests/
│   ├── integration/
│   ├── security/
│   └── e2e/
├── docker-compose.yml
├── .env.example
├── AGENTS.md
├── README.md
└── pnpm-workspace.yaml
```

---

## 8. Agent Team MVP

### 8.1 Chief — Orchestrator

**Mission:** memahami tujuan user, membuat plan, mendelegasikan pekerjaan, mengontrol risiko, dan menyusun jawaban final.

**Boleh melakukan:**

- membuat dan memperbarui task;
- mencari knowledge dari shared memory;
- mendelegasikan pekerjaan;
- meminta review dan approval;
- membatalkan run;
- menyusun final response.

**Tidak boleh melakukan langsung:**

- mengirim campaign;
- mengubah production data;
- menjalankan arbitrary shell;
- mengakses secret mentah;
- melewati approval engine.

### 8.2 Ned — Research Agent

**Mission:** mencari, mengumpulkan, memverifikasi, dan merangkum informasi.

**Output wajib:**

- findings terstruktur;
- daftar sumber;
- confidence score;
- tanggal pengambilan data;
- unresolved questions.

### 8.3 Layla — Sales & Lead Scoring Agent

**Mission:** memperkaya data lead, menghitung ICP fit, menjelaskan skor, dan menentukan next-best action.

**Output wajib:**

- score total;
- score per dimensi;
- alasan dan evidence;
- missing data;
- rekomendasi tindakan;
- status `qualified`, `needs_review`, atau `disqualified`.

### 8.4 Hermes — Content & Communication Agent

**Mission:** membuat draft konten dan komunikasi berdasarkan brand voice serta evidence yang disediakan.

**Ketentuan:**

- tidak boleh menciptakan klaim bisnis tanpa sumber;
- tidak boleh mengirim pesan sendiri;
- seluruh outbound content harus berbentuk draft;
- wajib mencantumkan target audience dan objective.

### 8.5 Argus — QA & Risk Agent

**Mission:** memeriksa factuality, kelengkapan, consistency, policy compliance, dan risiko sebelum output diserahkan atau dieksekusi.

**Keputusan yang dihasilkan:**

- `PASS`;
- `PASS_WITH_WARNINGS`;
- `REVISION_REQUIRED`;
- `BLOCKED`.

Argus tidak memperbaiki output secara diam-diam. Ia menghasilkan temuan yang kemudian ditindaklanjuti oleh agent pemilik output.

---

## 9. Format Definisi Agent

Agent disimpan sebagai konfigurasi terversi, bukan hard-coded di UI.

```yaml
id: hermes
name: Hermes
role: content_lead
version: 1
description: Creates evidence-backed content and communication drafts.
model_policy:
  preferred_tier: balanced
  fallback_tier: fast
limits:
  max_turns: 6
  max_delegation_depth: 1
  timeout_seconds: 180
  max_cost_usd: 0.50
permissions:
  tools:
    - memory.search
    - artifacts.read
    - artifacts.write
    - brand.get_voice
  data_scopes:
    - business_knowledge
    - approved_research
  external_writes: false
review:
  required_agent: argus
  human_approval_for:
    - send_message
    - publish_content
```

### 9.1 Ketentuan system prompt

Setiap system prompt minimal berisi:

- identity dan mission;
- success criteria;
- allowed tools;
- forbidden actions;
- required output schema;
- source and evidence rules;
- escalation rules;
- data privacy instructions;
- failure behavior;
- instruction hierarchy.

---

## 10. Orchestration Model

### 10.1 Task lifecycle

```mermaid
stateDiagram-v2
    [*] --> Queued
    Queued --> Planning
    Planning --> Running
    Running --> Review
    Review --> Running: Revision
    Review --> Approval: Sensitive action
    Review --> Completed: No approval needed
    Approval --> Completed: Approved
    Approval --> Cancelled: Rejected
    Running --> Failed
    Failed --> Queued: Retry allowed
    Queued --> Cancelled
```

### 10.2 Delegation rules

- Chief merupakan root agent dengan depth `0`.
- Specialist yang dipanggil Chief berada pada depth `1`.
- Peer delegation maksimal depth `2` pada MVP.
- Agent tidak boleh mendelegasikan kembali ke dirinya sendiri.
- Delegasi harus memiliki prompt self-contained.
- Concurrency default maksimal tiga specialist run.
- Satu task tidak boleh memiliki lebih dari delapan child task pada MVP.
- Semua delegasi memiliki timeout dan cost ceiling.
- Task yang gagal dua kali harus diekskalasi ke Chief atau manusia.
- Chief wajib mensintesis hasil; tidak sekadar menempelkan semua output.

### 10.3 Planning contract

Sebelum menjalankan task kompleks, Chief menghasilkan plan terstruktur:

```json
{
  "goal": "Find and qualify gym leads in Palembang",
  "assumptions": [],
  "questions": [],
  "steps": [
    {
      "id": "step_1",
      "agent": "ned",
      "objective": "Collect and enrich candidate gyms",
      "depends_on": [],
      "parallelizable": true,
      "expected_artifact": "lead_candidates.json"
    }
  ],
  "approval_points": ["outreach_send"],
  "estimated_cost_usd": 0.75
}
```

Plan harus disimpan sebelum child tasks dibuat.

---

## 11. Shared Memory

Shared memory bukan satu prompt raksasa. Sistem menggunakan beberapa lapisan memori dengan aturan retrieval berbeda.

### 11.1 Jenis memori

| Jenis | Contoh | Retensi |
|---|---|---|
| Working memory | Context run yang sedang aktif | Sampai run selesai |
| Conversation memory | Pesan user dan agent | Persisten |
| Episodic memory | Keputusan dan hasil task sebelumnya | Persisten, diringkas |
| Semantic memory | SOP, produk, brand, client knowledge | Persisten dan terversi |
| Entity memory | Lead, client, project, contact | Persisten terstruktur |
| Artifact memory | CSV, report, draft, screenshot, code | Persisten sesuai policy |
| Policy memory | Permissions, approval, compliance | Persisten dan immutable per version |

### 11.2 Memory write rules

Setiap memory item harus menyimpan:

- source;
- source timestamp;
- author atau agent;
- confidence;
- scope;
- sensitivity classification;
- version;
- expiry bila relevan;
- links ke task dan artifact asal.

Agent tidak boleh menulis kesimpulan spekulatif sebagai fakta. Bila informasi belum terverifikasi, status harus `unverified`.

### 11.3 Retrieval pipeline

1. Identifikasi entities dan intent dari task.
2. Terapkan access scope agent.
3. Jalankan structured filters berdasarkan project/client/time.
4. Jalankan semantic retrieval pada kandidat yang diizinkan.
5. Rerank berdasarkan relevance, freshness, confidence, dan source authority.
6. Batasi context sesuai token budget.
7. Catat memory item apa saja yang diberikan kepada agent.

### 11.4 Memory hygiene

- Jangan menyimpan seluruh chain-of-thought.
- Simpan keputusan, evidence, tool result, dan concise rationale.
- Deduplicate knowledge yang sama.
- Tandai knowledge yang superseded.
- Jalankan scheduled stale-memory review.
- Sediakan fitur forget/delete sesuai kebutuhan privasi.

---

## 12. Model Data Awal

### 12.1 Tabel inti

| Tabel | Fungsi |
|---|---|
| `users` | Identitas user dan role |
| `agents` | Agent configuration aktif |
| `agent_versions` | Riwayat prompt, tools, dan policy |
| `tasks` | Parent dan child task |
| `task_dependencies` | Dependency graph |
| `runs` | Satu eksekusi agent |
| `messages` | Conversation events |
| `plans` | Plan terstruktur milik Chief |
| `tool_calls` | Seluruh pemanggilan tool |
| `artifacts` | Metadata output file/data |
| `memory_items` | Shared memory records |
| `memory_embeddings` | Vector representation |
| `approvals` | Permintaan dan keputusan approval |
| `integrations` | Metadata koneksi, tanpa secret mentah |
| `audit_events` | Append-only audit trail |
| `scheduled_jobs` | Cron dan delayed execution |
| `budgets` | Limit global harian dan per-run; aggregate per-agent memerlukan policy limit terpisah |
| `budget_reservations` | Reservasi biaya lintas proses dan settlement biaya aktual |

### 12.2 Status penting

```ts
type TaskStatus =
  | "queued"
  | "planning"
  | "running"
  | "review_pending"
  | "approval_pending"
  | "completed"
  | "failed"
  | "cancelled";

type RunStatus =
  | "created"
  | "active"
  | "waiting_tool"
  | "waiting_child"
  | "waiting_approval"
  | "completed"
  | "failed"
  | "cancelled"
  | "timed_out";
```

---

## 13. Tool Gateway

Semua tindakan agent harus melewati Tool Gateway. Agent tidak berinteraksi langsung dengan database production, shell, atau external API.

### 13.1 Tool contract

```ts
interface ToolDefinition<TInput, TOutput> {
  name: string;
  description: string;
  inputSchema: ZodSchema<TInput>;
  outputSchema: ZodSchema<TOutput>;
  riskLevel: "read" | "low" | "medium" | "high" | "critical";
  requiresApproval: boolean;
  timeoutMs: number;
  // The gateway aborts context.signal when timeoutMs is exceeded.
  execute(context: ToolContext, input: TInput): Promise<TOutput>;
}
```

### 13.2 Tool MVP

**Internal read tools**

- `memory.search`
- `memory.get`
- `tasks.get`
- `tasks.list`
- `artifacts.read`
- `agents.status`

**Internal write tools**

- `tasks.create_child`
- `tasks.update_status`
- `artifacts.write`
- `memory.propose_write`

**Research tools**

- `web.search`
- `web.fetch_safe`
- `company.lookup`
- `lead.enrich`

**Communication tools**

- `telegram.reply`
- `communication.create_draft`
- `communication.send_approved`

**System tools**

- `runs.cancel`
- `runs.retry`
- `system.pause_all`
- `system.resume_all`

### 13.3 Side-effect separation

Pisahkan tool berikut:

- `message.create_draft` — aman, tidak mengirim.
- `message.request_send` — membuat approval request.
- `message.send_approved` — hanya berjalan dengan valid approval token.

Agent tidak pernah menerima tool `send_message` generik yang dapat melewati workflow tersebut.

---

## 14. Human Approval Engine

### 14.1 Approval matrix

| Tindakan | Default |
|---|---|
| Membaca knowledge internal | Otomatis bila scope sesuai |
| Menulis draft/artifact | Otomatis |
| Menambahkan proposed memory | Otomatis, lalu divalidasi |
| Mengubah canonical knowledge | Approval atau trusted workflow |
| Mengirim pesan eksternal | Wajib approval |
| Membuat/menjadwalkan campaign | Wajib approval |
| Mengubah production data | Wajib approval |
| Menjalankan deployment | Wajib approval |
| Menghapus data | Wajib approval dan confirmation kedua |
| Transaksi finansial | Blocked pada MVP |
| Mengubah permissions/policy | Wajib owner approval |

### 14.2 Approval token

Approval harus terikat pada:

- exact action;
- normalized input hash;
- agent dan task;
- expiry time;
- approving user;
- one-time execution.

Jika payload berubah setelah approval, approval otomatis tidak valid.

---

## 15. Telegram Interface

### 15.1 Commands

| Command | Fungsi |
|---|---|
| `/new` | Membuat task baru |
| `/status` | Ringkasan task aktif |
| `/agents` | Status semua agent |
| `/task <id>` | Detail task dan child tasks |
| `/approve <id>` | Menyetujui exact pending action |
| `/reject <id>` | Menolak pending action |
| `/revise <id>` | Memberi revisi |
| `/pause` | Menghentikan pengambilan task baru |
| `/resume` | Melanjutkan sistem |
| `/stop <task_id>` | Membatalkan task tertentu |
| `/emergency_stop` | Membatalkan seluruh run dan memblokir external writes |
| `/cost` | Penggunaan dan budget saat ini |
| `/help` | Bantuan |

Natural language tetap menjadi interface utama. Commands disediakan untuk operasi yang harus eksplisit dan deterministik.

### 15.2 Telegram approval card

Approval message minimal menampilkan:

- action;
- target;
- preview payload;
- alasan agent;
- risk level;
- estimated impact;
- expiry;
- tombol Approve, Reject, dan Revise.

---

## 16. Dashboard ATLAS

### 16.1 Halaman MVP

1. **Command Center**  
   Agent graph, system health, task counters, cost, dan emergency controls.

2. **Tasks**  
   Parent/child task, dependencies, status, retry, cancel, dan artifacts.

3. **Communications**  
   User-to-agent, agent-to-agent delegation, tool calls, dan filters.

4. **Agents**  
   Agent definitions, versions, model policy, tools, limits, dan status.

5. **Shared Brain**  
   Search knowledge, entities, sources, freshness, confidence, dan version history.

6. **Approvals**  
   Pending, approved, rejected, expired, dan executed actions.

7. **Artifacts**  
   Report, CSV, draft, JSON, screenshot, dan output terstruktur.

8. **Integrations**  
   Connection status dan granted scopes.

9. **Audit & Costs**  
   Event timeline, token usage, cost, error, retry, dan performance.

10. **Settings**  
    Global budgets, concurrency, security, retention, dan notification preferences.

### 16.2 Agent graph behavior

- Node `IDLE` bila tidak ada active run.
- Node `QUEUED` bila menunggu worker.
- Node `WORKING` hanya saat run aktif.
- Delegation line menyala berdasarkan real event.
- Error state menunjukkan alasan singkat.
- Clicking node membuka exact run dan artifacts.
- UI tidak menampilkan fabricated thoughts atau hidden chain-of-thought.

---

## 17. Security Baseline

### 17.1 Mandatory controls

- Tidak ada `bypassPermissions`.
- Tidak ada arbitrary Bash tool pada MVP.
- Filesystem tool hanya bekerja dalam sandbox workdir.
- Secret disimpan melalui secret manager atau encrypted store.
- Secret tidak pernah masuk ke prompt atau logs.
- Tool output disanitasi sebelum dikirim kembali ke model.
- Semua fetched web content dianggap untrusted.
- Instruction dari webpage tidak boleh mengubah system policy.
- URL dan network egress dibatasi sesuai kebutuhan tool.
- Setiap external write memakai idempotency key.
- Setiap run memiliki timeout dan cost limit.
- Audit logs append-only.
- Emergency stop harus bekerja tanpa LLM.
- Dashboard dan Telegram account memakai owner authentication/allowlist.

### 17.2 Prompt injection defense

Fetched content ditempatkan sebagai **data**, bukan instruction. Tool Gateway harus:

1. menandai asal content;
2. menghapus active content yang tidak dibutuhkan;
3. membatasi ukuran;
4. menolak credential requests;
5. mencegah webpage menginstruksikan agent memakai tools;
6. meminta approval bila ditemukan konflik policy.

### 17.3 Sandbox policy

Jika kelak filesystem/coding agent ditambahkan:

- satu container per risky run;
- non-root user;
- resource limits;
- read-only base image;
- explicit mounted workdir;
- no Docker socket;
- network off secara default;
- artifact export setelah scan;
- container dihancurkan setelah run.

---

## 18. Reliability dan Recovery

- Gunakan database transaction ketika membuat task dan run.
- Worker mengambil job dengan lease/lock.
- Heartbeat menandai worker aktif.
- Stale run dipulihkan atau ditandai gagal.
- Tool calls memakai idempotency key.
- Retry memakai exponential backoff dan jitter.
- Tidak melakukan retry otomatis untuk destructive action.
- Parent task menunggu child completion melalui event, bukan polling agresif.
- Cancellation harus diteruskan ke child tasks.
- Graceful shutdown menolak job baru dan menyelesaikan checkpoint.
- Worker melakukan startup dan periodic recovery terhadap task berstatus `queued` dengan pagination; BullMQ menggunakan task/run ID sebagai idempotency key sehingga task yang tersimpan tetapi kehilangan enqueue dapat dikirim ulang tanpa duplikasi.
- Backup database dan artifacts dijadwalkan.

---

## 19. Observability dan Evaluasi

### 19.1 Metrics minimum

- tasks created/completed/failed;
- success rate per agent;
- latency per task dan tool;
- retries dan timeout;
- input/output tokens;
- estimated dan actual cost;
- approval rate dan rejection rate;
- human revisions per artifact;
- hallucination/factual error findings oleh QA;
- queue depth dan worker health;
- memory retrieval hit rate.

### 19.2 Evaluation dataset

Buat kumpulan task tetap untuk regression testing:

- research dengan sumber;
- lead scoring dengan expected rubric;
- content draft berdasarkan evidence;
- QA yang harus menangkap klaim salah;
- approval yang tidak boleh dilewati;
- malicious webpage/prompt injection;
- worker restart di tengah task;
- duplicate Telegram webhook;
- budget exhaustion;
- emergency stop.

Model atau prompt baru tidak dipromosikan sebelum melewati evaluation suite.

---

## 20. Environment Variables

`.env.example` hanya berisi placeholder:

```dotenv
NODE_ENV=development
APP_BASE_URL=http://localhost:3000
ATLAS_DOMAIN=localhost

DATABASE_URL=postgresql://atlas:atlas@postgres:5432/atlas
REDIS_URL=redis://redis:6379

TELEGRAM_BOT_TOKEN=
TELEGRAM_ALLOWED_USER_IDS=
TELEGRAM_WEBHOOK_SECRET=

MODEL_PROVIDER=
MODEL_API_KEY=
MODEL_BASE_URL=
MODEL_NAME=

ENCRYPTION_KEY=
ARTIFACT_STORAGE_PATH=/data/artifacts

GLOBAL_DAILY_BUDGET_USD=5
MAX_CONCURRENT_AGENT_RUNS=3
MAX_DELEGATION_DEPTH=2
EXTERNAL_WRITES_ENABLED=false
```

Tidak boleh ada credential asli dalam repository.

---

## 21. Fase Implementasi

### Phase 0 — Repository Foundation

**Deliverables:**

- monorepo;
- linting, formatting, typecheck, unit test;
- Docker Compose untuk PostgreSQL dan Redis;
- migration system;
- shared schemas;
- health endpoints;
- CI dasar;
- `.env.example`;
- `AGENTS.md`.

**Exit criteria:** seluruh app dapat boot, database bermigrasi, dan health check lulus.

### Phase 1 — Task Engine dan Single Agent

**Deliverables:**

- task/run persistence;
- queue dan worker;
- provider adapter;
- Chief single-agent run;
- event persistence;
- cancellation dan timeout;
- basic cost tracking.

**Exit criteria:** satu task dapat dibuat, dijalankan, direstart, dan diselesaikan secara persisten.

### Phase 2 — Multi-Agent Delegation

**Deliverables:**

- agent registry;
- five MVP agent definitions;
- structured planning;
- child tasks;
- parallel execution;
- max-depth enforcement;
- synthesis;
- Argus QA gate.

**Exit criteria:** Chief dapat membagi task kepada minimal tiga agents dan menghasilkan final synthesis.

### Phase 3 — Telegram Control Plane

**Deliverables:**

- secure Telegram bot;
- owner allowlist;
- natural-language command intake;
- status updates;
- approve/reject/revise;
- cancellation;
- emergency stop;
- duplicate webhook protection.

**Exit criteria:** seluruh lifecycle task dasar dapat dikendalikan dari ponsel.

### Phase 4 — Shared Memory

**Deliverables:**

- memory schemas;
- ingestion;
- semantic + structured retrieval;
- source/confidence/freshness metadata;
- memory proposal workflow;
- stale-memory handling;
- privacy deletion.

**Exit criteria:** agent dapat menggunakan knowledge dari task sebelumnya dan menunjukkan source yang dipakai.

### Phase 5 — Tool Gateway dan Lead Workflow

**Deliverables:**

- tool registry;
- risk classification;
- approval tokens;
- research tools;
- lead ingestion/enrichment;
- configurable scoring rubric;
- outreach draft;
- QA report;
- CSV/report artifacts.

**Exit criteria:** contoh gym-lead workflow selesai end-to-end tanpa mengirim outbound message.

### Phase 6 — ATLAS Dashboard

**Deliverables:**

- command center;
- realtime agent graph;
- task graph;
- durable communications feed;
- shared brain viewer;
- approvals;
- audit/cost dashboard;
- system controls.

**Exit criteria:** seluruh state yang ditampilkan berasal dari backend records/events dan konsisten setelah refresh.

### Phase 7 — Production Hardening

**Deliverables:**

- authentication;
- encrypted secrets;
- backup/restore;
- rate limits;
- sandboxing;
- security tests;
- monitoring/alerts;
- full production deployment automation beyond Docker Compose;
- automated incident response and alert routing;
- retention policy.

**Exit criteria:** threat-model checklist lulus dan recovery drill berhasil.

---

## 22. MVP Acceptance Criteria

Status convention: `[x]` means the behavior is implemented and covered by local automated verification; `[ ]` means end-to-end proof or a production dependency is still pending.

### Task dan orchestration

- [ ] User dapat membuat task dari Telegram.
- [x] Chief menyimpan plan sebelum delegasi.
- [x] Child tasks memiliki parent dan dependency yang benar.
- [x] Maksimal delegation depth diterapkan oleh kode.
- [x] Concurrency limit diterapkan oleh queue.
- [x] Chief menghasilkan final synthesis.
- [x] Argus memeriksa final artifact.

### Memory

- [ ] Conversation tetap tersedia setelah restart.
- [x] Artifact dapat ditelusuri ke task asal.
- [x] Retrieved memory dicatat pada run.
- [ ] Knowledge memiliki source, confidence, dan freshness yang tervalidasi dari provider research nyata.
- [x] Agent `memory.search` hanya mengembalikan memory berstatus `verified`.
- [x] Unverified information tidak tersimpan sebagai canonical fact.

### Approval dan security

- [x] External write tidak dapat dilakukan tanpa approval token.
- [x] Semua kelas external/production side-effect terdaftar fail-closed bila external writes tidak diaktifkan secara eksplisit.
- [x] Perubahan payload membatalkan approval.
- [x] Duplicate webhook tidak mengeksekusi tindakan dua kali.
- [x] Secret tidak muncul di logs atau prompts.
- [x] Emergency stop membatalkan active runs.
- [x] Agent tidak memiliki arbitrary shell access.

### Dashboard

- [x] Agent status sesuai dengan real backend state.
- [x] Delegation line berasal dari real delegation event.
- [x] Communications feed memuat history durable messages dan tool-call metadata, dengan refresh SSE dan tanpa merender payload tool.
- [x] Task detail menampilkan messages, tool calls, dan artifacts.
- [x] Audit log dapat difilter berdasarkan task, agent, dan action.
- [x] Cost dapat dilihat per task dan per agent.

---

## 23. Testing Strategy

### Unit tests

- schemas;
- policy decisions;
- task transitions;
- cost calculation;
- approval hash;
- scoring rubric;
- memory ranking;
- agent configuration validation.

### Integration tests

- database + queue transaction;
- parent/child lifecycle;
- provider adapter mock;
- tool gateway;
- Telegram update handling;
- authenticated SSE events with reconnect replay;
- artifact storage;
- retry and cancellation.

### End-to-end tests

- create task → delegate → QA → complete;
- create external action → approval → execute once;
- reject approval → no side effect;
- restart worker → recover task;
- malicious content → blocked;
- emergency stop → all runs cancelled.

---

## 24. First Demonstration Scenario

### Scenario: Palembang Gym Lead Intelligence

**Input:**

> Temukan 30 gym atau fitness center di Palembang yang berpotensi membutuhkan WhatsApp CRM. Nilai setiap lead, pilih 10 terbaik, dan buat draft pendekatan. Jangan kirim pesan.

**Expected workflow:**

1. Chief membuat plan dan rubric requirement.
2. Ned mengumpulkan kandidat beserta sumber.
3. Layla melakukan enrichment dan scoring.
4. Hermes membuat personalized drafts untuk top 10.
5. Argus memeriksa sumber, skor, dan klaim.
6. Chief menghasilkan executive summary.
7. Sistem membuat artifacts:
   - `gym_leads.csv`;
   - `lead_scoring_report.md`;
   - `outreach_drafts.md`;
   - `qa_report.md`.
8. Telegram mengirim ringkasan dan link artifact.
9. Tidak ada pesan outbound yang dikirim.

### Contoh rubric awal

| Metrik | Bobot |
|---|---:|
| Kesesuaian jenis usaha | 15 |
| Banyaknya channel komunikasi | 10 |
| Indikasi volume pelanggan | 10 |
| Kebutuhan follow-up/member retention | 15 |
| Kualitas digital presence | 8 |
| Responsiveness saat ini | 8 |
| Potensi automasi CS | 10 |
| Potensi broadcast yang sah | 8 |
| Kemudahan menemukan decision maker | 6 |
| Kelengkapan dan freshness data | 10 |
| **Total** | **100** |

Rubric harus dapat diubah dari dashboard dan memiliki version history.

---

## 25. Instruksi untuk Coding Agent

Coding agent yang menerima dokumen ini harus mengikuti aturan berikut:

1. Baca dokumen sepenuhnya sebelum membuat perubahan.
2. Jangan langsung membangun seluruh fase sekaligus.
3. Mulai dari Phase 0 dan selesaikan exit criteria-nya.
4. Buat implementation plan yang menyebut file dan package yang akan dibuat.
5. Jangan memasukkan credential asli.
6. Jangan mengaktifkan external writes pada development default.
7. Jangan menambahkan arbitrary shell atau `bypassPermissions`.
8. Semua state transition harus tervalidasi dan diuji.
9. Semua tool harus memiliki schema, timeout, risk level, dan audit record.
10. Gunakan mocks/fakes untuk provider dan external tools pada automated tests.
11. Hindari coupling langsung antara dashboard dan provider SDK.
12. Pertahankan provider abstraction.
13. Dokumentasikan keputusan arsitektur penting.
14. Jalankan lint, typecheck, unit test, dan relevant integration tests sebelum menyatakan fase selesai.
15. Berhenti dan meminta keputusan manusia bila perubahan memperluas scope atau permission.

### Format laporan setiap fase

```markdown
## Phase X Completion Report

### Implemented
- ...

### Verification
- Command: `...`
- Result: PASS/FAIL

### Known limitations
- ...

### Security notes
- ...

### Next phase readiness
- READY/BLOCKED
```

---

## 26. Definition of Done

Satu phase dinyatakan selesai hanya jika:

- code telah diimplementasikan;
- migration berhasil;
- test yang relevan lulus;
- error handling tersedia;
- logging dan audit events tersedia;
- dokumentasi diperbarui;
- security implications telah diperiksa;
- exit criteria phase terbukti;
- tidak ada secret atau debug bypass tertinggal;
- perubahan dapat dijalankan ulang dari clean environment.

---

## 27. Future Roadmap

Setelah MVP stabil:

- scheduled morning briefing;
- WhatsApp CRM connector dengan official API;
- GitHub engineering agent;
- calendar dan email integration;
- client/project-specific memory namespaces;
- visual workflow builder;
- agent evaluation dashboard;
- prompt/version A/B testing;
- voice note input melalui Telegram;
- document and meeting ingestion;
- multi-project business brain;
- role-based multi-user access;
- isolated coding sandboxes;
- custom agent marketplace internal;
- mobile-first command center.

Agent baru seperti Iris, Apollo, Calliope, atau dedicated finance agent hanya ditambahkan berdasarkan kebutuhan workflow dan setelah policy serta evaluation set tersedia.

---

## 28. Risiko Utama

| Risiko | Mitigasi |
|---|---|
| Agent memberikan fakta salah | Source requirement, confidence, Argus QA |
| Prompt injection | Untrusted-content boundary dan Tool Gateway |
| Biaya membengkak | Reservasi per-run dan daily budget; aggregate per-agent perlu policy limit eksplisit |
| Delegation loop | Hard max depth dan child-task count |
| Duplicate external action | Approval token dan idempotency key |
| Memory menjadi basi | Freshness metadata dan stale review |
| Secret bocor | Encrypted store dan prompt redaction |
| Worker mati | Queue persistence, heartbeat, recovery |
| Dashboard terlihat aktif padahal tidak | Event-derived state only |
| Terlalu banyak agent | Agent admission criteria dan evaluasi ROI |

---

## 29. Referensi Awal

- [Business-Ai-Claude](https://github.com/soheru/Business-Ai-Claude) — referensi open-source untuk pola CEO-to-specialist delegation dan dashboard lokal. Gunakan sebagai bahan studi, bukan dependency wajib.
- [Telegram Bot API](https://core.telegram.org/bots/api) — interface bot resmi.
- [Model Context Protocol](https://modelcontextprotocol.io/) — pola standardisasi agent tools.
- [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/) — secure access menuju self-hosted dashboard.

---

## 30. Keputusan Awal yang Dikunci

- [x] Sistem dimulai sebagai single-user self-hosted MVP.
- [x] Telegram menjadi primary remote control.
- [x] Chief menjadi satu-satunya root orchestrator.
- [x] MVP menggunakan lima agent.
- [x] PostgreSQL dan Redis digunakan sejak awal.
- [x] Worker dipisahkan dari Next.js dashboard.
- [x] External writes mati secara default.
- [x] Human approval wajib untuk tindakan sensitif.
- [x] Arbitrary shell tidak tersedia pada MVP.
- [x] Agent state berasal dari real events.
- [x] Provider dibuat swappable melalui adapter.
- [x] Deployment target adalah Docker Compose di VPS.

---

## 31. Immediate Next Action

Langkah berikutnya adalah menutup release gate pada lingkungan yang memiliki Docker, PostgreSQL, Redis, dan kredensial provider yang disetujui:

1. jalankan lint, typecheck, test, dan production build dari clean checkout;
2. boot Compose dari database kosong dan verifikasi migration/agent seeding;
3. uji task execution lintas restart API/worker, duplicate Telegram update, pause/emergency stop, cancellation, dan approval execute-once;
4. buat backup PostgreSQL, lakukan restore ke database terpisah, lalu verifikasi artifact/message/tool-call history;
5. verifikasi reconnect replay, budget reservation/settlement, worker lease recovery, dan backup restore pada host Docker.

External writes tetap nonaktif sampai connector outbound, research provider dan model provider dipilih serta diuji, dan owner memberikan approval production. Untuk research, kode adapter sudah tersedia secara opt-in tetapi belum live-verified di environment ini.
