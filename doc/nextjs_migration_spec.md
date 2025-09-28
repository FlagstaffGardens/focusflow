# FocusFlow Next.js MVP Migration Spec

## 1. Goals
- Replace the Reflex UI with a maintainable Next.js 15 (App Router) build while keeping the existing speech → summary workflow intact.
- Ship an MVP that mirrors today’s behaviour: Plaud resolution, audio download, optional AssemblyAI transcription, GPT summarization, log streaming, and persistence to the filesystem under `data/`.
- Refresh the interface using shadcn/ui for faster iteration without expanding scope into multi-user auth or complex analytics.

## 2. Functional Requirements
1. **Job Lifecycle**
   - Accept Plaud.ai share URLs or direct audio URLs.
   - Resolve Plaud links using current fallback chain (temp API → content API → HTML parsing → JSON scan).
   - Download audio to `data/files/<jobId>.<ext>` with visible progress.
   - Transcribe through AssemblyAI when `ASSEMBLYAI_API_KEY` is present; otherwise skip with log note.
   - Summarize via `/openai/v1/responses` (streaming, two-message payload) per `doc/ai_endpoints.md`.
   - Generate meeting titles with AI when available; fallback mirrors existing heuristics.
   - Persist job metadata, logs, transcript, summary, resolved URL, and artifacts to JSON files under `data/` (compatible with current format where possible).
   - Support retry, summary regeneration, and deletion (cleans up audio + JSON artifacts).

2. **User Interface**
   - Jobs list with status badge, created timestamp, and navigation to detail view.
   - Detail pane exposing summary (Markdown), transcript toggle, streaming logs, metadata (URL, resolved URL, meeting date, title, duration estimate).
   - Job creation sheet with validation, meeting date override, and environment health indicators (AssemblyAI / OpenAI availability flags).
   - Action buttons (retry, regenerate summary, delete) with confirmation and toast feedback.
   - Responsive layout, dark mode-ready, accessible (shadcn + Radix primitives).

3. **Observability & Logging**
   - Append log lines as pipeline progresses; store to `data/logs/<jobId>.log` (mirrors JSON `logs` array for UI hydration).
   - Real-time log streaming via Server-Sent Events (SSE); fallback to polling if SSE unavailable.
   - Error logging includes HTTP status + truncated response bodies for external calls per handbook.

4. **Testing**
   - Smoke script (Node) equivalent to `scripts/smoke_pipeline.py` running resolve → download → transcribe → summarize → cleanup using staging credentials.
   - Unit coverage for Plaud resolver, GPT payload builder, transcript formatter, title generator.
   - Lightweight Playwright flow verifying job creation and log streaming (with mocked external services).
- Smoke focus: Docker build & startup, environment variable validation, end-to-end job processing, SSE reconnect reliability.

## 3. Non-functional Requirements
- Environment managed through `.env` (validated via `zod`/`envsafe`) loaded by both Next.js runtime and pipeline worker.
- Long-running work handled in a dedicated Node process (or background task within Next.js dev server) to avoid serverless timeouts.
- File-based persistence remains the single source of truth to ease parity with existing Reflex setup and simplify deployment.
- Keep dependencies minimal; avoid introducing databases, Prisma, or Redis for MVP.

### Environment Variables
- Required: `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL`.
- Optional: `ASSEMBLYAI_API_KEY` (controls transcription feature toggle).
- Development: `.env.local` loaded by both web app and worker.
- Production: runtime env injection (Docker/Kubernetes secrets); no reliance on build-time env.
- Validation: fail fast at process boot with descriptive errors when required vars missing.

## 4. Architecture Overview

### 4.1 Components
- **Next.js 15 App Router** (`apps/web`): renders UI, exposes API routes & server actions, serves SSE endpoint.
- **Pipeline Worker** (`apps/worker` or background module): Node process using a simple queue (`p-queue` or custom) to execute jobs sequentially/safely.
- **Filesystem Store** (`data/`):
  - `jobs.json` — array of job records (id, status, timestamps, summary/transcript hashes, etc.).
  - `files/` — downloaded audio artifacts.
  - `logs/<jobId>.log` — newline-delimited log entries (mirrors UI `logs` array for hydration).
  - `transcripts/<jobId>.txt` & `summaries/<jobId>.md` — content caches (optional but keeps large blobs out of `jobs.json`).
- **Shared Pipeline Library** (`packages/pipeline`): TypeScript port of existing Python helpers (Plaud resolver, download manager, AssemblyAI client, GPT client, prompt renderer, title generator, cleanup utilities).

### 4.2 Job Flow
1. User submits URL via UI; server action validates input, creates job record in `jobs.json` (status `queued`), and enqueues job onto in-memory/disk-backed queue consumed by worker.
2. Worker processes job in steps, emitting log events after each major action. Logs written both to memory (for SSE broadcast) and to `logs/<jobId>.log` plus `jobs.json` for persistence.
3. Upon completion/error, worker updates job record (status, summary/transcript paths, title, error message). SSE notifies clients; UI fetcher rehydrates state from API.
4. Delete/reset operations modify `jobs.json`, prune associated files, and broadcast update.

### 4.3 Error Recovery
- Persist queue state to `data/queue.json` so in-flight jobs survive process restarts.
- Save per-step checkpoints (resolve, download, transcribe, summarize) in each job record to allow partial progress recovery.
- Apply configurable job timeout (default 10 minutes); timed-out jobs move to `error` with next steps logged.
- Maintain a lightweight dead-letter list (`data/dead_letter.json`) for jobs that exceed retry limits; surface in UI for manual follow-up.
- Worker restarts reload queue state and resume non-terminal jobs automatically.

### 4.4 Worker Topology
- **Option A** – dedicated worker process (`apps/worker`): production-friendly isolation but adds orchestration overhead.
- **Option B** – in-process queue inside Next.js runtime: simplest for MVP deployments.
- **Recommendation:** Launch with Option B, keeping interfaces clean so we can split into Option A later without large rewrites.
- Minimal queue abstraction (`lib/job-queue.ts`) persists jobs and hides the processing loop.
  ```ts
class SimpleJobQueue {
  private processing = false;

  constructor(private store: JobStore) {}

  async enqueue(job: JobPayload) {
    await this.store.save(job);
    if (!this.processing) {
      this.processing = true;
      void this.process();
    }
  }

  private async process() {
    while (true) {
      const next = await this.store.next();
      if (!next) break;
      await runJob(next);
    }
    this.processing = false;
  }
}
  ```

## 5. Data Shapes
- **Job Record (stored in `jobs.json`)**
```jsonc
{
  "id": "job_123",
  "url": "https://plaud.ai/share/abc",
  "resolved_url": "https://.../audio.mp3",
  "meeting_date": "2025-09-28",
  "status": "summarizing",
  "title": "Weekly Sync" ,
  "summary_path": "summaries/job_123.md",
  "transcript_path": "transcripts/job_123.txt",
  "file_path": "files/job_123.mp3",
  "created_at": 1732849200,
  "updated_at": 1732852800,
  "error": "" ,
  "logs": ["Resolving Plaud link ...", "Downloaded 22 MB (75%)", ...]
}
```
- Keep format backward-compatible where feasible so existing history can migrate by copying `data/`.

## 6. Pipeline Design

### 6.1 Plaud Resolver
- Reimplement current Python routine in TypeScript, preserving API-first approach and fallbacks.
- Log each attempt (`temp_url`, `share-content`, HTML regex, JSON scan) with truncated URLs.
- Respect timeouts and User-Agent headers; bubble errors while defaulting to original URL if all attempts fail.

### 6.2 Downloader
- Use `node-fetch`/`undici` with streaming writes to `data/files/`.
- Emit progress events every ~100ms; include byte counts and percentage when `content-length` present.
- Validate content-type similar to `_guess_ext` logic; throw descriptive errors otherwise.

### 6.3 Transcription
- Upload audio to AssemblyAI via chunked POST; include only `speaker_labels` and `format_text` in body.
- Poll transcript endpoint every 2s; stop at completion or error, logging HTTP status + response snippet on failure.
- Format transcript identical to current Python output (speaker headers, blank lines, optional highlights).
- Persist transcript to dedicated `.txt` file and reference path in job record.

### 6.4 Summarization
- Render prompt template `prompts/meeting_summary.md` by substituting `{{transcript}}` and `{{meeting_date}}`.
- Call `/openai/v1/responses` with streamed accumulation per handbook (collapse final `output_text`).
- Save summary to `.md` file and update job record; generate title through AI-first then heuristic fallback.

### 6.5 Cleanup & Retry
- Deleting a job removes audio, transcript, summary, log files, and job record.
- Retry resets status to `queued`, clears `error`, keeps existing transcript/summary depending on action (full re-run vs re-summarize only) matching current behaviour.
- Regenerate summary reuses transcript, writes new summary/title, and logs outcome.

## 7. API Surface (Initial)
- `POST /api/jobs` → create job + enqueue.
- `GET /api/jobs` → list jobs (reads `jobs.json`).
- `GET /api/jobs/[id]` → job detail (hydrates transcript/summary content if requested).
- `POST /api/jobs/[id]/retry`
- `POST /api/jobs/[id]/regenerate-summary`
- `DELETE /api/jobs/[id]`
- `GET /api/jobs/[id]/logs/stream` → SSE stream emitting `{ message, ts }`.
- Internal server actions wrap these endpoints for UI to avoid extra fetch boilerplate while REST endpoints remain available for debugging and future integrations.

### 7.1 SSE Streaming Approach
- Implement SSE via Next.js App Router `Response` streams with heartbeat comments every 30 seconds to keep proxies happy.
- Clients reconnect automatically using `EventSource`; `Last-Event-ID` ensures no duplicated log lines.
- After repeated failures, UI degrades to 5-second polling of `/api/jobs/[id]`.
- SSE is the only real-time channel; no WebSocket dependency.

## 8. UI Outline (shadcn/ui)
- Sidebar + main content layout built with shadcn `ResizablePanel`, `ScrollArea`, `Button`, `Badge`, `Card`.
- Jobs table/snackbar using `DataTable` pattern; status color-coded.
- Log console uses `ScrollArea` + `Code` styling with auto-scroll on new events.
- Summary viewer renders Markdown via `react-markdown` with syntax highlighting for code blocks.
- Transcript accordion backed by virtualized list (`react-virtuoso`) when length exceeds threshold.
- Toast system for submit/retry/delete events using shadcn `Toast`.

## 9. Tooling & Dev Experience
- pnpm workspace with:
  - `apps/web` (Next.js 15, TypeScript, Tailwind, shadcn).
  - `packages/pipeline` shared between app & worker.
- Background worker launched via custom script (`pnpm dev:worker`) or integrated into Next dev command (nodemon-style reload).
- Testing: Vitest for unit, Playwright for e2e (mocked external APIs with MSW), dedicated smoke Node script hitting real services.
- ESLint (Next.js preset) + Prettier + lint-staged; commit hooks optional but light.

## 10. Deployment Plan
- Docker Compose with two services: `web` (Next.js + pipeline worker in same container or separate `worker` service) and data volume mounted at `/data`.
- Environment variables loaded from `.env` or Docker secrets; `data/` persisted via bind mount or named volume.
- Production deploy targets (Fly.io, Render, plain VM) run Node 20+; ensure worker has long-running process and access to filesystem.
- CI: GitHub Actions running lint, unit tests, Playwright (mocked), and smoke script (guarded by secrets). Require successful smoke before deploy per handbook.

## 11. Timeline Estimate
| Phase | Scope | Duration |
|-------|-------|----------|
| 0 | Repo bootstrap, tooling, shadcn setup | 1 day |
| 1 | Port pipeline helpers + filesystem store | 2 days |
| 2 | Background worker + SSE + API routes | 2 days |
| 3 | UI build (jobs list, detail, actions) | 2 days |
| 4 | Testing, smoke script, docs, Docker | 1 day |

Total: ~8 working days. Add buffer for polishing UI or handling edge cases.

## 12. Open Questions (Current Answers)
- **Legacy data migration:** Provide optional script; copying existing `data/` works when structure matches.
- **Retry behaviour:** Default to reuse transcripts; expose full pipeline rerun as explicit option.
- **Authentication:** Not in MVP scope; document HTTP basic auth add-on for later.
- **Deployment target:** Start with Dokploy single-container deployment, revisit alternatives post-MVP.

## 13. Deployment Simplification Strategy
- Single `PORT` (default 8080) exposed; avoid reverse-proxy gymnastics.
- Evaluate env vars at runtime only; no build-time `process.env` leakage.
- `/api/health` endpoint for liveness/readiness plus quick smoke ping.
- Graceful shutdown: flush logs, persist queue state, let active job finish or mark as retry.
- SSE-only realtime keeps networking simple; no WebSocket upgrades.
- Dockerfile uses single-stage Node 20 image with clear `ENTRYPOINT` booting Next.js + worker (Option B).

## 14. Migration Execution Plan
### Phase 0: Archive & Document (Day 0)
- Move Reflex app into `/archive/reflex-v1/` for historical reference.
- Capture deployment pain points and guardrails in `doc/reflex-postmortem.md`.
- Extract reusable Plaud/AssemblyAI helpers from Python before porting to TS.

### Phase 1: Data Migration
- Optional script to convert legacy `app.db` into `jobs.json`; verify accuracy with spot checks.
- Preserve `data/files/` audio + transcripts; ensure new app reads existing paths without renames.
- Run smoke pipeline on migrated data prior to cutover.

## 15. Quick Wins from Reflex Experience
- Lean on server state + URL params; avoid heavy client state libraries.
- SSE for live updates only; keep infra minimal.
- All configuration at runtime; document required envs prominently.
- Start with single-process deployment; introduce extra processes later if necessary.
- Use direct filesystem operations instead of ORM/database layers.
- Emit actionable error messages with suggested recovery steps.

