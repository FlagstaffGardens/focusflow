Scripts Overview

This folder contains standalone maintenance and verification scripts. All scripts are Node.js programs that read configuration from .env and print concise results to stdout. None of them are imported by application code; you can run them with node path/to/script.js.

Prerequisites
- Node.js 18+ (undici fetch used by some tests)
- .env configured with the relevant keys below

Common environment variables
- Google Drive discovery
  - GOOGLE_SERVICE_ACCOUNT_KEY: JSON string or path to service account JSON
  - GOOGLE_DRIVE_FOLDER_ID: Drive folder ID containing recordings
  - ALLOWED_USERS (optional): comma-separated owner emails
- Database
  - DATABASE_URL: Postgres connection string
- AI (ModelScope preferred; OpenAI-compatible)
  - MODELSCOPE_API_KEY (preferred) or OPENAI_API_KEY
  - MODELSCOPE_BASE_URL or OPENAI_BASE_URL
  - MODELSCOPE_MODEL_ID or OPENAI_MODEL

Scripts
1) list_drive_files.js
   - Summarizes the configured Drive folder: counts by MIME/extension/owner, flags non-Cube/ACR audio.
   - Usage: node scripts/list_drive_files.js

2) test_openai_chat_completion.js
   - Simple non-stream Chat Completions smoke test; prints content.
   - Usage: node scripts/test_openai_chat_completion.js

3) test_openai_stream.js
   - Streaming Chat Completions test (SSE); verifies concatenated output.
   - Usage: node scripts/test_openai_stream.js

4) export_db.js
   - Exports all jobs and artifacts to exports/ (jobs.json/jsonl/csv, transcripts/, summaries/, stats.json).
   - Usage: node scripts/export_db.js
   - Note: exports/ is .gitignored by default.

5) report_transcript_duplicates.js
   - Analyzes transcripts in DB by content hash; writes exports/transcript_duplicates.json.
   - Usage: node scripts/report_transcript_duplicates.js

6) export_calls_md.js
   - Writes one Markdown per job to exports/calls using Drive filename as base.
   - Usage: node scripts/export_calls_md.js

7) clean_export_transcripts_md.js
   - Destructive: clears exports/ then writes one .md per transcript directly under exports/ with the Drive filename.
   - Usage: node scripts/clean_export_transcripts_md.js

Notes
- exports/ is intentionally ignored by Git (see .gitignore). If you need to commit exports for a one-off snapshot, remove or edit the exports/ entry in .gitignore, but be mindful of size and sensitive data.
- The clean_export_transcripts_md.js script removes EVERYTHING inside exports/ before writing new files.

Troubleshooting
- Database SSL: If your Postgres requires SSL, add node-postgres options via environment or use a connection string that enables SSL (e.g., ?sslmode=require).
- Drive auth: Ensure the service account is shared on the Drive folder and GOOGLE_SERVICE_ACCOUNT_KEY is valid.
- AI endpoint: Use MODELSCOPE_* for SiliconFlow or OPENAI_* for the default OpenAI-compatible service.

