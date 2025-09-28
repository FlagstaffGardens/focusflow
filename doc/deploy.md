# Deployment Guide

## Prerequisites

- Docker 24+
- Optional: Dokploy instance for managed deployment
- `.env` populated with runtime secrets (see `.env.example`)

## Local Docker Run

```bash
docker compose build
docker compose up -d
```

The compose file exposes `http://localhost:8080` and mounts:

- `focusflow-data` → `/data` (jobs, audio files, transcripts, summaries)
- `./prompts` → `/app/prompts` (read-only prompt overrides)

Stop with `docker compose down` (the volume keeps prior jobs).

## Dokploy Deployment

1. **Create application** – choose *Docker* (build from repo) or *Docker Compose* and point to `docker-compose.yml`.
2. **Environment variables** – set at least:
   - `OPENAI_API_KEY`
   - Optional `ASSEMBLYAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL`, `DATA_DIR=/data`
3. **Volumes** – attach a persistent volume to `/data`. Optionally attach a config volume to `/app/prompts` for prompt overrides.
4. **Ports** – expose container port `8080` (Dokploy ingress/HTTPS as needed).
5. **Deploy** – Dokploy will run `pnpm -r build` inside the image and start `node server.js`.
6. **Smoke test** – submit a Plaud share link and confirm the date, audio download, and summary all complete.

## Updating

- Rebuild the image (Dokploy redeploy) after code changes.
- Prompt tweaks only: update the mounted prompts volume and restart the container (no rebuild required).
- To clear state, stop the container and remove the `/data` volume.

## Troubleshooting

- `TypeError: fetch failed` – ensure outbound HTTPS is allowed from the container and that Plaud domains resolve (the resolver now rewrites to `web.plaud.ai`).
- Missing summaries – verify `OPENAI_API_KEY` and, if using a proxy, `OPENAI_BASE_URL`.
- No transcription – add `ASSEMBLYAI_API_KEY` or expect the pipeline to skip transcription with a log message.
