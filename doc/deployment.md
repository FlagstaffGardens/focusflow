# FocusFlow Deployment Guide

## Deployment Status: ✅ READY

### Pre-Deployment Checklist
- [x] Code audited and cleaned
- [x] API keys removed from code (use environment variables)
- [x] Dockerfile optimized for production
- [x] .dockerignore configured
- [x] Unnecessary files removed

## Environment Variables Required

Set these in your deployment platform (Dokploy, Railway, etc.):

```env
# Required for transcription
ASSEMBLYAI_API_KEY=your-assemblyai-api-key

# Required for summarization
OPENAI_API_KEY=your-openai-api-key
OPENAI_BASE_URL=https://api.openai.com  # Or your proxy URL
OPENAI_MODEL=gpt-4  # Or your preferred model

# Database and storage
DATABASE_URL=sqlite:////data/app.db
FILES_DIR=/data/files

# Optional
SECRET_KEY=your-secret-key
MAX_AUDIO_MINUTES=180
```

## Deployment Steps

### For Dokploy:
1. Create a new application
2. Connect your GitHub repository
3. Set the environment variables above
4. Use the provided Dockerfile
5. Set port to 8080
6. Deploy!

### Docker Command (Local Testing):
```bash
docker build -t focusflow .
docker run -p 8080:8080 --env-file .env focusflow
```

## Features
- ✅ Plaud.ai link resolution
- ✅ Direct audio URL support (.mp3, .m4a, .wav)
- ✅ AssemblyAI transcription with speaker labels
- ✅ OpenAI-compatible summarization
- ✅ Meeting date extraction
- ✅ Real-time progress updates
- ✅ Job persistence

## Security Notes
- API keys are properly handled via environment variables
- No keys are hardcoded in the source
- .env file is gitignored
- .dockerignore prevents sensitive files from entering the image

## Data Persistence
The app stores:
- SQLite database at `/data/app.db`
- Downloaded audio files at `/data/files/`

Make sure to configure persistent volumes in your deployment platform.

## Support
The application is production-ready and fully functional with the current configuration.