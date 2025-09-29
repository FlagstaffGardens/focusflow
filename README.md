# FocusFlow

FocusFlow ingests Plaud.ai share links or direct audio URLs, transcribes the audio (via AssemblyAI if configured), and generates meeting summaries with an OpenAI-compatible model. The app runs as a single Next.js 15 (App Router) project.

## Getting Started

1. Install Node.js 20 (see `.nvmrc`) and enable pnpm via corepack (`corepack enable`).
2. `pnpm install`
3. Copy `.env.example` to `.env` and fill in the required keys.
4. `pnpm dev` to launch the dev server at http://localhost:3000.

## Environment Variables

```
PORT=3000                   # Port used by `pnpm dev` / `pnpm start`
DATA_DIR=./data             # Directory for downloads, transcripts, summaries

# Optional: simple HTTP Basic Auth protecting the UI + API
BASIC_AUTH_USER=
BASIC_AUTH_PASSWORD=

# Optional: transcription via AssemblyAI
ASSEMBLYAI_API_KEY=

# Required for summarisation
OPENAI_API_KEY=
OPENAI_BASE_URL=https://api.openai.com
OPENAI_MODEL=gpt-4

# Rate limiting (per IP); defaults to 60 req / minute when unset
# RATE_LIMIT_WINDOW_MS=60000
# RATE_LIMIT_MAX_REQUESTS=60

# Prompt template override
PROMPT_PATH=prompts/meeting_summary.md
```

## Docker Compose

You can run FocusFlow end-to-end with Docker:

1. Ensure your root `.env` has the required secrets (`OPENAI_API_KEY`, etc.). This same file is loaded by Docker Compose.
2. Build and start the stack: `docker compose up --build`.
3. The UI is available at http://localhost:3000. Job data, transcripts, and summaries persist in the named volume `focusflow-data`.

The compose file mounts `./prompts` read-only so you can tweak prompt templates without rebuilding, and it exposes `/app/data` through the named volume to preserve queue state across restarts.

## Production Build

- `pnpm build` to create the optimized Next.js build.
- `pnpm start` serves the built app (ensure `PORT` is set).

Persist the directory referenced by `DATA_DIR` (or the `focusflow-data` volume under Docker) so jobs, transcripts, and summaries survive restarts.

## Scripts

- `pnpm dev` – Next.js development server.
- `pnpm build` – Production build.
- `pnpm start` – Serve the production build.
- `pnpm lint` – Run ESLint.
- `pnpm type-check` – TypeScript project check.

## Notes

- The job queue keeps an in-memory view of jobs and flushes the JSON state asynchronously to `DATA_DIR`. It is still single-process; move to a proper database/worker setup before scaling horizontally.
- HTTP Basic auth is enforced when `BASIC_AUTH_USER`/`BASIC_AUTH_PASSWORD` are set. Combine this with an upstream TLS-terminating proxy in production.
- All `/api` routes are rate limited (defaults: 60 requests per minute per IP). Tune `RATE_LIMIT_*` env vars for your environment.
