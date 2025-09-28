# Prompts Directory

This directory contains all AI prompts used by FocusFlow.

## Files and Their Usage

### 1. `meeting_summary.md`
**Used for:** Main meeting summarization
**When:** When processing transcripts to create comprehensive meeting summaries
**Called by:** `summarize_with_gpt()` function
**Features:**
- Creates structured summary with sections (Overview, Discussion Points, Decisions, Action Items, etc.)
- Includes speaker attribution when available
- Focuses on actionable outcomes

### 2. `title_generator.md`
**Used for:** Generating concise titles from summaries
**When:** After summary is generated, to create a short title for the job card
**Called by:** `generate_title_from_summary()` function
**Features:**
- Creates titles max 50 characters
- Captures main meeting topic/purpose
- Used for display in job cards on home screen

## When Regenerate Summary is Clicked

When user clicks "Re-summarize", the app:
1. Calls `summarize_with_gpt()` → uses `meeting_summary.md`
2. After summary is generated, calls `generate_title_from_summary()` → uses `title_generator.md`
3. Both summary and title are saved to the job

## Environment Variables

- `PROMPT_PATH`: Override default summary prompt (defaults to `prompts/meeting_summary.md`)

## Customization

Edit these files to change how summaries and titles are generated. Changes take effect immediately without restarting the app.