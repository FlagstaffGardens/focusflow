# FocusFlow

A streamlined web app for transcribing and summarizing meeting recordings from Plaud.ai or any audio URL.

## Features

- 🎙️ **Audio Transcription** - Upload Plaud.ai links or direct audio URLs
- 🤖 **AI Summarization** - Structured summaries with action items and decisions
- 🏷️ **Smart Titles** - AI-generated concise titles for each meeting
- 📅 **Date Extraction** - Automatically pulls meeting dates from Plaud URLs
- 👥 **Speaker Diarization** - Identifies different speakers in transcripts
- 📱 **Mobile Responsive** - Works on all devices
- ⚡ **Real-time Updates** - Live progress tracking

## Quick Start

```bash
# Clone and setup
git clone <repo-url>
cd focusflow
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# Configure API keys
cp .env.example .env
# Edit .env with your keys:
# - ASSEMBLYAI_API_KEY (required for transcription)
# - OPENAI_API_KEY & OPENAI_BASE_URL (required for summarization)

# Run
reflex run --env dev
```

Open http://localhost:3000

### Docker / Compose

```bash
docker compose build
docker compose up
# App exposed on http://localhost:8080
```

See `doc/deploy.md` for production deployment and Dokploy notes.

## Usage

1. **Paste URL** - Plaud share link or direct audio URL
2. **Add Job** - Click to start processing
3. **View Results** - Click job card to see transcript & summary
4. **Re-summarize** - Generate new summary with updated prompt

## Project Structure

```
main/main.py          # Entire app (UI + backend)
prompts/
  meeting_summary.md  # Summary prompt template
  title_generator.md  # Title extraction prompt
data/
  jobs.json          # Persisted jobs
  files/             # Cached audio files
```

## Customization

- **Summary Format**: Edit `prompts/meeting_summary.md`
- **Title Style**: Edit `prompts/title_generator.md`
- **UI/Logic**: Edit `main/main.py`

Changes to prompts take effect immediately without restart.

## Tech Stack

- **Framework**: Reflex 0.8.12+ (Python)
- **Transcription**: AssemblyAI (speaker labels, sentiment)
- **Summarization**: OpenAI GPT-4
- **Audio**: Plaud.ai resolver + direct URL support
