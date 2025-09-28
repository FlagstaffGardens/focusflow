# FocusFlow (Minimal Reflex)

A clean slate: a simple Reflex app with hot reload and no Docker. Edit the UI in `main/main.py` and run locally.

## Quick Start

- Install Python 3.11+.
- Create and activate a virtualenv (recommended).

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
reflex run --env dev
```

Open http://localhost:3000 for the frontend. The backend runs automatically.

## Where to Edit

- UI entry: `main/main.py`
- App config: `rxconfig.py`
- Prompt template: `prompts/meeting_summary.md` (single source of truth). Set `PROMPT_PATH` to override if needed. The app reads this file on each summarize call; no restart required.

That’s it. No containers. No extra services. Just Reflex.
