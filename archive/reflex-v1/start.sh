#!/bin/bash

set -e

echo "Starting FocusFlow application..."

# Start Caddy in the background
echo "Starting Caddy reverse proxy..."
caddy start --config /etc/caddy/Caddyfile

# Wait a moment for Caddy to start
sleep 2

# Start Reflex backend (without --backend-only since we need the full app)
echo "Starting Reflex backend on port 8000..."
echo "Environment check:"
echo "ASSEMBLYAI_API_KEY: ${ASSEMBLYAI_API_KEY:0:10}..."
echo "OPENAI_API_KEY: ${OPENAI_API_KEY:0:10}..."

# Run Reflex in production mode with both frontend and backend
# The frontend is already built and served by Caddy, but Reflex needs to know about it
exec reflex run --env prod --backend-host 0.0.0.0 --backend-port 8000 --frontend-port 3001