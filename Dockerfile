# syntax=docker/dockerfile:1.6

# ---------- Base image with pnpm ----------
FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat \
  && corepack enable \
  && corepack prepare pnpm@10.17.1 --activate
WORKDIR /app

# ---------- Install dependencies ----------
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY packages/pipeline/package.json packages/pipeline/
RUN pnpm install --frozen-lockfile

# ---------- Build workspace ----------
FROM deps AS build
COPY . .
RUN pnpm -r build

# ---------- Production runtime ----------
FROM node:20-alpine AS runner
RUN apk add --no-cache libc6-compat curl
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080
ENV DATA_DIR=/data

COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public
COPY --from=build /app/prompts ./prompts

RUN mkdir -p /data && chown -R node:node /data && chown -R node:node /app

USER node
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS http://127.0.0.1:${PORT:-8080}/api/health || exit 1

CMD ["node", "server.js"]
