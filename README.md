# FocusFlow

FocusFlow ingests Plaud.ai share links or direct audio URLs, downloads the audio, runs transcription, and generates meeting summaries with GPT. The current stack is Next.js 15 (App Router) with a shared TypeScript pipeline library.

## Features

- 🎙️ Plaud.ai link resolution with automatic meeting-date extraction
- 📼 Local audio download and optional AssemblyAI transcription
- 🧠 GPT summaries + auto-generated meeting titles
- 📋 Real-time job logs and progress
- 📱 Responsive UI designed for desktop + mobile

## Local Development

```bash
pnpm install
pnpm dev          # runs Next.js dev server on http://localhost:3000
```

Environment variables:

- `OPENAI_API_KEY` *(required for summaries)*
- `OPENAI_BASE_URL` *(optional, defaults to https://api.openai.com)*
- `OPENAI_MODEL` *(optional, defaults to gpt-4)*
- `ASSEMBLYAI_API_KEY` *(optional, enables transcription)*
- `DATA_DIR` *(default `./data` locally; set `/data` inside Docker/Dokploy)*

Copy `.env.example` to `.env` and fill in the values. This same `.env` file can be reused in Dokploy—just ensure `DATA_DIR=/data` when running in containers.

## Production Build

```bash
pnpm -r build     # builds the pipeline package + Next.js app
```

This generates the standalone server under `apps/web/.next/standalone` which the Docker image uses at runtime.

## Docker / Dokploy

The repository ships with a multi-stage `Dockerfile` and `docker-compose.yml` that:

- Builds the monorepo with pnpm
- Runs the standalone Next.js server on port `8080`
- Mounts `/data` for persistent jobs, transcripts, and downloaded audio
- Mounts `/app/prompts` read-only so prompt tweaks do not require rebuilding

### Quick test

```bash
docker compose build
docker compose up
```

Visit http://localhost:8080 to add a Plaud link. Jobs and files will persist under `data/` between restarts.

### Dokploy checklist

1. Create an app using the repository or Dockerfile.
2. Upload your `.env` (or enter the same variables manually). When using the provided sample, make sure `DATA_DIR=/data`.
3. Attach a persistent volume to `/data` for jobs/files. (Optional: mount `/app/prompts` to override prompts.)
4. Expose port `8080` (or configure Dokploy ingress).
5. Deploy and run a smoke job to confirm end-to-end processing.

## Deployment TL;DR

1. `cp .env.example .env` and fill in keys (`OPENAI_API_KEY` mandatory, set `DATA_DIR=/data` for Docker).
2. `docker compose build && docker compose up -d` to verify locally.
3. In Dokploy, point to this repo/Dockerfile, upload the same `.env`, mount a volume at `/data`, expose port 8080.
4. Deploy and run a Plaud share link as a smoke test.

## Project Layout

```
apps/
  web/                 # Next.js app (UI + API routes/queue)
packages/
  pipeline/            # Shared TypeScript pipeline logic (Plaud resolver, downloads, AI clients)
prompts/
  meeting_summary.md   # Summary template
  title_generator.md   # Title template
```

## Customising Prompts

Edit the files in `prompts/` locally. In Docker/Dokploy deployments mount an override directory to `/app/prompts` to change prompts without rebuilding.

## Scripts

- `pnpm dev` – run the Next.js dev server
- `pnpm -r build` – build both the pipeline package and the Next.js app
- `pnpm --filter @focusflow/web start` – start the production server (expects prior build)
- `pnpm --filter @focusflow/web type-check` – TypeScript check for the app

## Smoke Test

1. Paste a Plaud share URL (`https://web.plaud.ai/share/...`).
2. Verify the job resolves the correct meeting date and downloads audio.
3. Check the summary and title once GPT finishes.
4. Restart the app – the job should still appear thanks to the persisted `/data` volume.
