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

By default the service only listens on port `3000` inside the container (perfect for Dokploy/Traefik routing). If you want to reach it from the host while testing locally, add an override with `ports: ['3000:3000']`.

The compose file mounts a single volume:

- `focusflow-data` → `/data` (jobs, audio files, transcripts, summaries)

Stop with `docker compose down` (the volume keeps prior jobs).

## Dokploy Deployment

1. **Create application** – choose *Docker* (build from repo) or *Docker Compose* and point to `docker-compose.yml`.
2. **Environment variables** – upload the repo `.env` or enter values manually. Ensure `DATA_DIR=/data` inside the container. Required keys:
   - `OPENAI_API_KEY`
   - Optional `ASSEMBLYAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL`, `DATA_DIR=/data`
3. **Volumes** – attach a persistent volume to `/data`. (Optional prompt overrides can still mount to `/app/prompts`, but it is not required.)
4. **Ports** – configure Dokploy/Traefik to route to container port `3000` (no host publish necessary).
5. **Deploy** – Dokploy builds the image (running `pnpm build`) and starts `node server.js` from the standalone output.
6. **Smoke test** – submit a Plaud share link and confirm the date, audio download, and summary all complete.

## Updating

- Rebuild the image (Dokploy redeploy) after code changes.
- Prompt tweaks only: either rebuild the image or temporarily mount a directory to `/app/prompts` (optional override).
- To clear state, stop the container and remove the `/data` volume.

## Troubleshooting

- `TypeError: fetch failed` – ensure outbound HTTPS is allowed from the container and that Plaud domains resolve (the resolver now rewrites to `web.plaud.ai`).
- Missing summaries – verify `OPENAI_API_KEY` and, if using a proxy, `OPENAI_BASE_URL`.
- No transcription – add `ASSEMBLYAI_API_KEY` or expect the pipeline to skip transcription with a log message.
