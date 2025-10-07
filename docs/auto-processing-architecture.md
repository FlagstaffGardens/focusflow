# FocusFlow Auto-Processing Architecture (Incoming Calls)

This document proposes a robust, low‑ops architecture to automatically transcribe, summarize, and sync to Notion for any newly discovered incoming calls — while keeping costs controlled and operations observable.

## Objectives

- Immediately process newly discovered incoming calls end‑to‑end.
- Preserve the existing discovery flow (Google Drive → DB) and UI.
- Keep the implementation simple, idempotent, and safe to run on a single Dokploy instance; optionally support future horizontal scale.
- Provide clear throttle/eligibility controls to avoid runaway costs.

## Current State (V2 recap)

- Discovery: `lib/cron/scheduler.ts` calls `discoverNewRecordings()` every 5 minutes to create DB rows in `jobs` with `status='discovered'`.
- Manual processing: `POST /api/jobs/[id]/process` runs: Drive stream → AssemblyAI → OpenAI → Notion → `status='completed'`.
- Notion sync: `lib/notion/sync.ts` creates/updates a page using Notion API and embeds summary + collapsible transcript.
- Data model: `lib/db/schema.ts` captures call metadata, transcript/summary, Notion info, timestamps, and error fields.

This works well but requires a manual click to start processing.

## Proposed Architecture

### High‑Level

- Keep the existing cron‑based discovery.
- Add a background “Auto‑Processor” that continuously claims eligible jobs (incoming calls only), then runs the same pipeline as the manual endpoint.
- Ensure job claiming is atomic (idempotency under retries and restarts).
- Bound concurrency and add backoff/retry semantics for resilience.

### Components

- Discovery Cron (existing)
  - Unchanged: `*/5 * * * *` polls Drive, inserts `jobs.status='discovered'`.

- Auto‑Processor Cron (new)
  - Runs every minute (configurable) to find and claim eligible jobs in batches.
  - Eligibility (configurable):
    - `status = 'discovered'`
    - `call_direction = 'incoming'`
    - `duration_seconds >= AUTO_MIN_DURATION` (e.g., 20–30s to filter pocket dials)
    - Optional: only within last `X` days; only certain `call_type` (phone/whatsapp)
  - Claims jobs with a single atomic UPDATE to prevent double processing:
    - `UPDATE jobs SET status='transcribing', transcription_started_at=now() WHERE id IN (...) AND status='discovered' RETURNING *`.
  - Processes claimed jobs with a bounded concurrency pool (e.g., 1–2 parallel jobs per instance).

- Processing Pipeline (extracted library)
  - Extract logic from `app/api/jobs/[id]/process/route.ts` into `lib/jobs/processor.ts`:
    - `processJob(jobId: string): Promise<void>` does: Drive stream → temp file → AssemblyAI → OpenAI → Notion → status updates.
    - Manual route delegates to this function; Auto‑Processor calls it directly.
  - Standardize status transitions: `transcribing → transcribed → summarizing → syncing → completed` with timestamps.
  - Persist transcript and summary in DB (already implemented).

- Notion Sync (existing)
  - Called by pipeline after summary; if Notion is not configured, skip and still mark job as completed.
  - Optionally add duplicate detection by title+date (future enhancement).

- Observability & Ops
  - Structured logs per jobId; counts by status in `/api/gdrive/poll` (existing) + new `/api/jobs/stats` (optional).
  - Track `retry_count` and `error_message` in DB.
  - Alerts can be added later (e.g., webhook on consecutive failures).

### Sequence

1. Cron discovers files and inserts `jobs (status='discovered')`.
2. Auto‑Processor (every minute):
   - SELECT id of eligible jobs (incoming + min duration), up to `AUTO_MAX_BATCH`.
   - Atomically claim each with an UPDATE WHERE `status='discovered'` RETURNING to avoid race.
   - For each claimed job (bounded concurrency):
     - Transcribe with AssemblyAI (temporary local file; no persisted audio).
     - Summarize with OpenAI (streaming; prompt from `prompts/` or `PROMPT_PATH`).
     - Sync to Notion if configured.
     - Set `status='completed'` and `completed_at`.
   - On any step error:
     - Update `status='failed'`, `error_message`, increment `retry_count`.
3. UI polls `/api/jobs` as today and shows live progress.

## Idempotency & Concurrency

- Atomic claim via UPDATE..WHERE..RETURNING prevents double‑work.
- Concurrency is a small fixed pool (`AUTO_CONCURRENCY`, default 1–2) to respect external API rate limits.
- If a job crashes mid‑process and remains in `transcribing`/`summarizing` for too long, a watchdog can reset to `discovered` after `AUTO_STALE_PROCESSING_MS` (optional future enhancement).

## Cost Controls

- `AUTO_MIN_DURATION` (skip short calls)
- `AUTO_MAX_PARALLEL` and a soft cap on jobs/minute
- Optional daily budget guard: stop auto‑processing when `AUTO_DAILY_MAX_JOBS` reached (future enhancement)
- Optional filter by `call_type` (e.g., exclude WhatsApp if quality is poor)

## Security

- No public endpoint is required to trigger processing; the Auto‑Processor runs inside the app container.
- Existing BASIC_AUTH and CRON_SECRET remain for UI/admin endpoints.
- Drive access is read‑only.

## Config Surface (env)

- `AUTO_PROCESS_ENABLED=true|false` (default: true)
- `AUTO_PROCESS_CRON=*/1 * * * *` (default: every minute)
- `AUTO_PROCESS_DIRECTIONS=incoming|incoming,outgoing` (default: incoming)
- `AUTO_MIN_DURATION=20` (seconds, default: 20)
- `AUTO_MAX_BATCH=3` (number of jobs to claim per tick)
- `AUTO_CONCURRENCY=1` (parallel jobs per instance)

## Data Model Additions (optional)

- Keep current schema; optionally add:
  - `auto_processed boolean` (default false)
  - `notion_sync_attempts integer` (for troubleshooting)
  - Indexes: `(status)`, `(call_direction, status)` to speed up eligibility queries

## Implementation Plan

1) Extraction
- Create `lib/jobs/processor.ts` with a `processJob(jobId)` function moved from `/api/jobs/[id]/process`.
- Update the API route to call this function and return the resulting DB state.

2) Auto‑Processor Cron
- Add `lib/cron/auto-processor.ts` that:
  - Reads config and bails if `AUTO_PROCESS_ENABLED !== 'true'`.
  - On schedule, selects eligible job IDs (incoming + duration >= min + status='discovered').
  - Claims jobs via single UPDATE WHERE `status='discovered'` RETURNING.
  - Runs `processJob(id)` with a small concurrency pool.
- Wire it in `instrumentation.ts` alongside discovery cron.

3) Safety & Backoff
- Wrap each `processJob` with try/catch; on error set `failed`, increment `retry_count`.
- (Optional) Exponential backoff: re‑enqueue failed jobs after N minutes; manual retry remains available in UI.

4) Observability
- Log job lifecycle with consistent prefix `[jobId]`.
- (Optional) add `/api/jobs/stats` to summarize counts by status, failures by step, and average durations.

## Risks & Mitigations

- API limits (AssemblyAI/OpenAI/Notion):
  - Mitigation: `AUTO_CONCURRENCY` 1–2, small `AUTO_MAX_BATCH`.
- Duplicate processing:
  - Mitigation: atomic UPDATE claim; DB uniqueness on `gdrive_file_id` already prevents duplicate discovery.
- Long calls/timeouts:
  - Mitigation: Next.js route has `maxDuration=300`; Auto‑Processor runs outside route constraints. Add internal per‑step timeouts.
- Notion failures:
  - Mitigation: do not block completion; store error, allow manual re‑sync via existing endpoint.

## Future Enhancements

- Google Drive push notifications (webhooks) to reduce discovery latency.
- Postgres advisory locks or a lightweight job table for horizontal scale (multi‑replica workers).
- PII redaction / keyword spotting; diarized speaker labels are already supported via AssemblyAI.
- Smarter Notion dedupe by searching for Title+Date matches.
- Model routing (short calls → cheaper model; long calls → higher‑quality model).

---

This approach adds auto‑processing with minimal changes, reuses your proven pipeline, and keeps operations predictable. It is safe to run as a single worker in Dokploy today, with a clear path to scale and richer controls later.

