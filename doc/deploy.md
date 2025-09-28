# Deployment Guide

## Prerequisites

- Docker and Docker Compose v2 (`docker compose` CLI)
- Populate `.env` with production secrets (see `README.md`)

## Build & Run Locally

```bash
docker compose build
docker compose up
# App now available on http://localhost:8080
```

The stack mounts a named volume `focusflow-data` at `/data`, preserving:

- `jobs.json`
- cached audio files under `/data/files`
- SQLite database (`sqlite:////data/app.db`)

Restarting containers keeps past jobs/transcripts intact.

## Dokploy Deployment

1. In Dokploy, create a new application using the **Docker Compose** template.
2. Upload `docker-compose.yml` from the repo or reference the Git repository directly.
3. Add the same environment variables defined in `.env` (SECRET_KEY, API keys, etc.).
4. Create a persistent volume in Dokploy and map it to `/data` for the `focusflow` service.
5. Expose port 8080 (or map via Dokploy ingress) to access the UI.
6. Deploy. Review logs, then run a smoke job to verify transcription + summary.

## Smoke Test

After deployment:

1. Upload a short Plaud.ai share link or sample audio URL.
2. Wait for the job to complete.
3. Verify summary renders correctly and data persists after restarting the container.

For changes to summarization/transcription logic, follow the smoke script in
`doc/ai_endpoints.md` before re-deploying.
