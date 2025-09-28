# FocusFlow Agent Guidelines

This repo already integrates with hosted speech + summarization services. Before touching
transcription or summarization logic, read and honour the contract documented below so we
do not regress the pipeline.

## GPT Responses API

- Use the `/openai/v1/responses` endpoint with `stream=true`.
- Always send two messages:
  1. `{"role": "system", "content": [{"type": "input_text", "text": "…instructions…"}]}`
  2. `{"role": "user", "content": [{"type": "input_text", "text": rendered_prompt}]}`
- Only the `input_text` type is accepted in our deployment. Other types (e.g. `text`) will
  400 with `Invalid value`.
- Keep `temperature` low (0.2) for determinism.
- When streaming, accumulate deltas and collapse the final message once a terminal
  `output_text` event arrives. Do not blindly append; otherwise you will render duplicates.
- If an HTTP error surfaces, log the status and response body. Never retry with a
  different endpoint unless product explicitly asks for it.

### Local Testing

Before shipping changes around the prompt or summarizer:

```bash
OPENAI_API_KEY=… \
OPENAI_BASE_URL=https://20250731.xyz/openai \
OPENAI_MODEL=gpt-5 \
python - <<'PY'
from main.main import summarize_with_gpt
def log(msg):
    print("LOG:", msg)
sample = "[Speaker A]: Hello team, we decided to ship v1 next Friday."
gen = summarize_with_gpt("smoke", sample, log, meeting_date="2025-09-28")
try:
    while True:
        next(gen)
except StopIteration as stop:
    assert stop.value and stop.value.startswith("# Meeting Summary")
PY
```

## AssemblyAI Transcription

- Request body: enable `speaker_labels` and `format_text`. All other paid add-ons are
  disabled to keep costs down.
- We still format the diarized transcript ourselves; do not re-enable auto highlights or
  sentiment without approval.

## Prompts

- `prompts/meeting_summary.md` must describe a **single** report output. Removing or adding
  sections changes downstream rendering – double-check before editing.
- Any prompt variables are substituted by `_render_summary_prompt`; introduce new ones
  there if absolutely required.

## General

- When adding behaviour, grep this doc first to confirm expectations.
- Log enough context (status + truncated JSON) so production runs are debuggable.
- Never ship changes to summarization/transcription without a smoke test similar to the
  snippet above.
