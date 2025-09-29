# FocusFlow Deployment Playbook (Dokploy + Docker Compose)

A reference guide for running FocusFlow in production using Dokploy, Docker Compose, and Traefik.

---

## 1. Prerequisites

- Dokploy instance with Docker and Traefik installed (default Dokploy setup).
- GitHub access to `FlagstaffGardens/focusflow` (or your fork).
- Valid API credentials in hand:
  - `OPENAI_API_KEY` (required).
  - `OPENAI_BASE_URL`, `OPENAI_MODEL` if overriding defaults.
  - Optional: `ASSEMBLYAI_API_KEY`, `BASIC_AUTH_USER`, `BASIC_AUTH_PASSWORD`.
- Any host-level limiters (firewall, SELinux) allow Docker bridge networking.

---

## 2. Repository Structure Highlights

| Path | Purpose |
|------|---------|
| `Dockerfile` | Multi-stage build; produces standalone Next.js runtime. |
| `docker-compose.yml` | Single-service stack (Next.js + volume + healthcheck). |
| `.env.example` | Canonical env vars (copy → `.env`). |
| `data/` | Local runtime artefacts (persist via volume). |
| `app/api/...` | All API routes depend on Node runtime (file I/O). |
| `lib/pipeline` | Job queue, transcription, summarisation. |
| `prompts/` | Prompt templates mounted read-only in Compose. |

---

## 3. Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `PORT` | Runtime port inside container (default 3000). | Yes |
| `DATA_DIR` | Absolute/relative path for job data. | Yes |
| `HOST_PORT` | Host binding (set `0` to auto-select; recommended with Traefik). | Optional |
| `OPENAI_API_KEY` | Summarisation key. | Yes |
| `OPENAI_BASE_URL` | Override for OpenAI-compatible endpoint. | Optional |
| `OPENAI_MODEL` | Model name (default `gpt-4`). | Optional |
| `ASSEMBLYAI_API_KEY` | Enables transcription stage. | Optional |
| `BASIC_AUTH_USER/PASSWORD` | Protects UI/API via middleware. | Optional |
| `RATE_LIMIT_*` | Rate-limit tuning. | Optional |
| `PROMPT_PATH` | Override prompt location (relative inside container). | Optional |

> Copy `.env.example` → `.env`, populate values, then point Dokploy to that file or replicate entries in the UI.

---

## 4. Dockerfile Summary

- Base image: `node:20-bookworm-slim` (Corepack enabled).
- Builder stage runs `pnpm install` + `pnpm build` to produce Next.js standalone output.
- Runner stage copies `.next/standalone`, `.next/static`, `public/`, and `package.json`.
- Runs under non-root `focusflow` user, exposes port 3000, and executes `node server.js`.
- Health check hits `http://127.0.0.1:3000/api/health` every 30s.

**Container binding:** `ENV HOSTNAME=0.0.0.0` and Compose-level overrides ensure Next.js listens on all interfaces—critical for Dokploy/Traefik.

---

## 5. docker-compose.yml Breakdown

```yaml
services:
  focusflow:
    build: .
    env_file:
      - .env
    environment:
      HOSTNAME: 0.0.0.0
      HOST: 0.0.0.0
    expose:
      - "3000"
    ports:
      - "${HOST_PORT:-3000}:3000"
    volumes:
      - focusflow-data:/app/data
      - ./prompts:/app/prompts:ro
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3000/api/health',{cache:'no-store'}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s

volumes:
  focusflow-data:
```

Key points:
- `expose: ["3000"]` makes port 3000 available to Traefik on the Docker network.
- `ports` binding is optional for Dokploy; set `HOST_PORT=0` to avoid collisions. Dokploy/Trafik route by hostname rather than static ports.
- `focusflow-data` volume holds jobs/transcripts/summaries; ensure Dokploy mounts/persists it.
- Health check must succeed (HTTP 200) or Dokploy marks the container unhealthy and Traefik will not route traffic.

---

## 6. Local Validation

```bash
# one-time dependencies
pnpm install
pnpm build
pnpm lint

# run locally
docker compose up --build

# verify health
curl http://localhost:3000/api/health
```

When using the Docker container locally, `docker logs focusflow-focusflow-1` should show:
```
▲ Next.js 15.x.x
- Local:        http://0.0.0.0:3000
- Network:      http://<container_id>:3000
```

---

## 7. Dokploy Deployment Checklist

1. **Create App → Docker Compose → GitHub source** pointing to repo.
2. **Environment variables** (Dokploy UI): paste all required values, including `HOST_PORT=0` (auto-host-port) and any secrets.
3. **Volumes**: ensure `focusflow-data` is added and mapped to `/app/data` (persistent storage).
4. **Deploy**: Dokploy runs `docker compose up --build`. Confirm container status transitions to `Up (healthy)`.
5. **Domain**: in Domains tab, assign service `focusflow`, container port `3000`, leave path `/`. Enabling HTTPS is optional.
6. **Verify**: `curl http://<traefik-host>/api/health` should return health JSON. UI loads at same host.
7. (Optional) enable autoredeploy on new commits or configure scheduled backups for `focusflow-data` volume.

Troubleshooting tips:
- If Dokploy reports port conflicts, set `HOST_PORT=0` (or a unique value) before redeploy.
- If container is `unhealthy`, check `docker logs focusflow-...` and ensure `/api/health` responds (inspect DNS/hostname bindings).
- To debug inside container: `docker exec -it <container> /bin/sh` → use `node -e ...` commands to probe the health endpoint.

---

## 8. Monitoring & Maintenance

- **Logs**: `docker compose logs -f focusflow` (local) or Dokploy UI → Service Logs.
- **Health**: `/api/health` exposes env status (OpenAI/AssemblyAI presence, data dir).
- **Queue operations**: REST endpoints `/api/jobs`, `/api/jobs/[id]/retry`, etc.
- **Backups**: snapshot `focusflow-data` volume periodically (jobs/transcripts/summaries).

---

## 9. Common Failure Modes

| Symptom | Likely Cause | Fix |
|---------|--------------|-----|
| Traefik 404 | Service domain not registered or container unhealthy | Redeploy, ensure domain host matches, check health check |
| Container `unhealthy` | `/api/health` failing (e.g. wrong hostname binding, missing env vars) | Confirm Next.js listens on `0.0.0.0`, verify secrets |
| Port bind conflict | Multiple services mapping host `3000` | Set `HOST_PORT=0` or another value |
| Missing logs in terminal | Compose detached (`-d`) | `docker compose logs -f focusflow` |

---

## 10. Final Notes

- The job queue is single-process/in-memory; scale vertically only.
- For production TLS, let Traefik/Dokploy manage certificates.
- Keep `.env` and Dokploy environment in sync; the compose file loads `.env`, and the Dokploy UI should mirror it to avoid drift.
- Always rebuild after changing Dockerfile/Compose before redeploying (`docker compose build --no-cache focusflow`).

