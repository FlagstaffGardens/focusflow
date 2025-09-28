#!/bin/bash

echo "Starting FocusFlow application..."

# Just run Reflex directly without Caddy
# Let Reflex handle everything on port 8080
echo "Environment check:"
echo "ASSEMBLYAI_API_KEY: ${ASSEMBLYAI_API_KEY:0:10}..."
echo "OPENAI_API_KEY: ${OPENAI_API_KEY:0:10}..."

# Run Reflex with both frontend and backend on different ports
# Frontend on 3000, backend on 8080
exec reflex run --env prod --backend-host 0.0.0.0 --backend-port 8080 --frontend-port 3000