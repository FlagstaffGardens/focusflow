#!/bin/bash

set -e

echo "Starting FocusFlow application..."

# Start Caddy in the background
echo "Starting Caddy reverse proxy..."
caddy start --config /etc/caddy/Caddyfile

# Start Reflex backend
echo "Starting Reflex backend on port 8000..."
exec reflex run --env prod --backend-only --backend-host 0.0.0.0 --backend-port 8000