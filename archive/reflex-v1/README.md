# FocusFlow Reflex v1 (Archived)

This directory contains the original Reflex implementation of FocusFlow, archived during the migration to Next.js.

## Why Archived?

After extensive deployment attempts, we encountered several critical issues with Reflex:
- Complex deployment requirements (Caddy reverse proxy needed)
- Environment variables evaluated at build time, not runtime
- Incompatible CLI flags between versions
- WebSocket routing complexity
- State management limitations (`.get()` method not supported)

## What's Preserved

- **main/**: Complete Python application code
- **scripts/**: Pipeline automation and smoke tests
- **prompts/**: Prompt templates (still used by Next.js version)
- **Docker setup**: Multi-stage build with Caddy
- **Configuration**: rxconfig.py, requirements.txt

## Running the Archived Version

If you need to run the Reflex version:

```bash
cd archive/reflex-v1

# Local development
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
reflex run

# Docker
docker build -t focusflow-reflex .
docker run -p 8080:8080 \
  -e ASSEMBLYAI_API_KEY=xxx \
  -e OPENAI_API_KEY=xxx \
  focusflow-reflex
```

## Lessons Learned

Key takeaways documented in `/doc/lessons-learned/reflex-deployment.md`:
1. Always test deployment configs locally before pushing
2. Runtime vs build-time env vars are critical
3. Framework version compatibility matters
4. Simple deployment > complex architecture

## Data Migration

To migrate data to Next.js version:
```bash
# Data format is already compatible
cp -r data/ ../../data/
```

## Status
- **Archived**: November 2024
- **Replaced by**: Next.js 15 implementation
- **Reason**: Deployment complexity and maintenance burden