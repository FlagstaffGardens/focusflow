# FocusFlow

FocusFlow ingests Plaud.ai share links or direct audio URLs, downloads the audio, runs transcription, and generates meeting summaries with GPT. The stack is a single Next.js 15 (App Router) application with the pipeline logic colocated under `lib/`.

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
pnpm build        # creates the production build in .next/
```

This produces the Next.js standalone server under `.next/standalone`, which the Docker image copies during the final stage.

## Docker / Dokploy

The repository ships with a multi-stage `Dockerfile` and `docker-compose.yml` that:

- Builds the app with pnpm
- Runs the standalone Next.js server listening on port `3000`
- Mounts `/data` for persistent jobs, transcripts, and downloaded audio

### Quick test

```bash
docker compose build
docker compose up
```

By default the compose stack exposes port `3000` only inside the container (ideal for Traefik/Dokploy routing). If you want to reach it directly on your machine, add a small override with `ports: ['3000:3000']` when running locally.

### Dokploy checklist

1. Create an app using the repository or Dockerfile.
2. Upload your `.env` (or enter the same variables manually). When using the provided sample, make sure `DATA_DIR=/data`.
3. Attach a persistent volume to `/data` for jobs/files.
4. Route traffic to container port `3000` via Dokploy/Traefik (no host port publish required).
5. Deploy and run a smoke job to confirm end-to-end processing.

## Deployment TL;DR

1. `cp .env.example .env` and fill in keys (`OPENAI_API_KEY` mandatory, set `DATA_DIR=/data` for Docker).
2. `docker compose build && docker compose up -d` to verify locally.
3. In Dokploy, point to this repo/Dockerfile, upload the same `.env`, mount a volume at `/data`, and configure ingress to target container port 3000.
4. Deploy and run a Plaud share link as a smoke test.

## Project Layout

```
app/                   # App Router routes & layouts
components/            # UI components
lib/
  pipeline/            # Job queue, Plaud resolver, AI clients
prompts/
  meeting_summary.md   # Summary template
  title_generator.md   # Title template
```

## Customising Prompts

Edit the files in `prompts/` locally. They are baked into the image; if you need runtime overrides you can still mount a directory to `/app/prompts`, but it’s optional.

## Scripts

- `pnpm dev` – run the Next.js dev server
- `pnpm build` – generate the production build
- `pnpm start` – serve the prebuilt app (`pnpm build` first)
- `pnpm lint` – lint with Next.js defaults
- `pnpm type-check` – TypeScript project check

## Smoke Test

1. Paste a Plaud share URL (`https://web.plaud.ai/share/...`).
2. Verify the job resolves the correct meeting date and downloads audio.
3. Check the summary and title once GPT finishes.
4. Restart the app – the job should still appear thanks to the persisted `/data` volume.
