# FocusFlow Agent Handbook

Always skim this file **before** touching the pipeline. It lists the docs and smoke tests
that keep the speech → summary workflow stable.

## Quick Checklist

1. Read `doc/ai_endpoints.md` for the exact request shapes we send to AssemblyAI and our
   OpenAI-compatible `/openai/v1/responses` endpoint.
2. After any change to prompts, transcription, or summarization, run the smoke script in
   that doc using the staging credentials.
3. Log meaningful error details (status + truncated payload) when calling external
   services so production issues can be diagnosed quickly.

If you need to extend the pipeline, update the relevant section under `doc/` and add new
smoke tests here.
