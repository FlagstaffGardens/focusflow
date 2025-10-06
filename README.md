# FocusFlow V2

**Automated Call Recording Processing System**

FocusFlow automatically discovers, transcribes, and summarizes call recordings from Cube ACR, storing them in PostgreSQL and syncing to Notion for organization.

---

## 🎯 Overview

**Flow:**
```
Cube ACR (Android) → Google Drive → FocusFlow Discovery → PostgreSQL Database
                                           ↓
                         User clicks "Transcribe" (on-demand)
                                           ↓
                    AssemblyAI → OpenAI → Notion → Complete
```

**Key Features:**
- ✅ **Auto-discovery** of Cube ACR recordings from Google Drive
- ✅ **Manual on-demand transcription** (no wasted API costs)
- ✅ **PostgreSQL storage** with full metadata
- ✅ **Real-time UI updates** with animated progress indicators
- ✅ **Automatic Notion sync** with beautiful formatting
- ✅ **Zero local audio storage** (stream & discard)

---

## 📊 Architecture

### Tech Stack
- **Frontend/API**: Next.js 15 (App Router)
- **Database**: PostgreSQL (via Dokploy)
- **Audio Storage**: Google Drive (source of truth)
- **Transcription**: AssemblyAI
- **Summarization**: OpenAI
- **Organization**: Notion
- **Deployment**: Dokploy

### Data Flow

1. **Discovery (Every 5 minutes - automatic)**
   - Built-in cron job polls Google Drive for new `.m4a`/`.amr` files
   - Parse Cube ACR filenames for metadata
   - Fetch duration from companion `.json` files
   - Create database records (status: `discovered`)

2. **Manual Processing (On-demand)**
   - User clicks "Transcribe" button
   - Stream audio from Google Drive
   - Transcribe with AssemblyAI
   - Summarize with OpenAI
   - Sync to Notion
   - Status: `discovered → transcribing → summarizing → syncing → completed`

### Database Schema

```typescript
jobs {
  id: uuid
  status: 'discovered' | 'transcribing' | 'summarizing' | 'syncing' | 'completed' | 'failed'
  source: 'cube-acr' | 'plaud'

  // Google Drive
  gdrive_file_id: string (unique)
  gdrive_file_name: string
  gdrive_json_id: string

  // Call Metadata (from filename)
  contact_name: string
  contact_number: string
  call_direction: 'incoming' | 'outgoing'
  call_timestamp: timestamp
  call_type: 'phone' | 'whatsapp'
  duration_seconds: integer  // from JSON file

  // Processing Results
  transcript: text
  summary: text

  // Notion Sync
  notion_page_id: string (unique)
  notion_url: text

  // Timestamps
  created_at, updated_at, discovered_at, completed_at
}
```

---

## 🚀 Setup

### Prerequisites

1. **Google Cloud Service Account**
   - Enable Google Drive API
   - Create service account
   - Download JSON key
   - Share Drive folder with service account email

2. **PostgreSQL Database** (via Dokploy)
   - Create database instance
   - Get connection string

3. **Notion Integration**
   - Create integration at notion.so/my-integrations
   - Create database with properties: Title, Date, Direction, Duration, Drive Link, Status
   - Share database with integration
   - Get database ID from URL

4. **API Keys**
   - AssemblyAI API key
   - OpenAI API key

### Environment Variables

```env
# App
PORT=3000

# Database
DATABASE_URL=postgresql://postgres:password@host:5432/focusflow

# Google Drive
# GOOGLE_SERVICE_ACCOUNT_KEY accepts either inline JSON or a path to a JSON file
GOOGLE_SERVICE_ACCOUNT_KEY={"type":"service_account",...}
GOOGLE_DRIVE_FOLDER_ID=your-folder-id
ALLOWED_USERS=your-email@gmail.com

# Processing
ASSEMBLYAI_API_KEY=your-key
OPENAI_API_KEY=your-key
OPENAI_BASE_URL=https://api.openai.com
OPENAI_MODEL=gpt-4o-mini

# Notion (optional)
NOTION_API_KEY=secret_xxx
NOTION_DATABASE_ID=xxx

# Security
CRON_SECRET=your-secret
BASIC_AUTH_USER=admin
BASIC_AUTH_PASSWORD=password
```

### Installation

```bash
# Install dependencies
npm install

# Push database schema
npm run db:push

# Run discovery to populate database
curl -X POST http://localhost:3000/api/gdrive/poll \
  -H "Authorization: Bearer YOUR_CRON_SECRET"

# Start development server
npm run dev
```

---

## 📡 API Endpoints

### Discovery
- `POST /api/gdrive/poll` - Manually trigger discovery (protected by CRON_SECRET)
- `GET /api/gdrive/poll` - Get discovery statistics
- **Note**: Discovery runs automatically every 5 minutes via built-in cron

### Jobs
- `GET /api/jobs` - List all jobs (sorted by call timestamp)
- `POST /api/jobs/[id]/process` - Transcribe & process a specific job
- `GET /api/jobs/[id]/transcript` - Get transcript for a job

### Health
- `GET /api/health` - API status and environment checks

---

## 🎨 UI Features

### Job List
- 📞 Contact names with call type icons (phone/WhatsApp)
- ↗/↙ Direction indicators
- ⏱️ Duration display (e.g., "5m 23s")
- 🎨 Color-coded status badges
- 🔵 **"Transcribe" button** for discovered calls

### Processing Indicators
- ⏳ Animated spinner during processing
- 📊 Real-time status updates:
  - "Transcribing audio..."
  - "Generating summary..."
  - "Syncing to Notion..."
- Auto-refresh every 5 seconds

### Completed Jobs
- 📝 Full transcript (collapsible)
- 📋 AI-generated summary
- 🔗 Link to Notion page

---

## 🔧 Cube ACR Filename Parsing

**Phone Calls:**
```
2025-10-03 16-54-44 (phone) Contact Name (0486300265) ↙.m4a
```
- ↗ = Outgoing
- ↙ = Incoming

**WhatsApp:**
```
2025-10-03 17-09-31 (whatsapp) Contact Name.m4a
```

**JSON Metadata:**
```json
{
  "duration": "141877",  // milliseconds
  "callee": "0486300265",
  "direction": "Incoming"
}
```

---

## 🚢 Deployment (Dokploy)

1. **Create PostgreSQL Service**
   - Name: `focusflow-db`
   - Get connection string

2. **Create Next.js App**
   - Connect to GitHub repo
   - Add all environment variables
   - Deploy
   - **Note**: Auto-discovery runs automatically every 5 minutes (built-in cron)

---

## 📝 Development

### Database Commands
```bash
npm run db:push       # Push schema to database
npm run db:studio     # Open Drizzle Studio
```

### File Structure
```
lib/
├── db/              # PostgreSQL schema & client
├── gdrive/          # Google Drive integration
├── cube-acr/        # Filename parser
├── notion/          # Notion sync service
└── pipeline/        # AssemblyAI & OpenAI

app/
└── api/
    ├── gdrive/      # Discovery endpoints
    └── jobs/        # Job management & processing
```

---

## 🔐 Security

- **Service Account**: Minimal permissions (Drive viewer only)
- **Allowlist**: Only process files from allowed users
- **CRON_SECRET**: Protects polling endpoint
- **BASIC_AUTH**: Protects UI and API routes
- **No Audio Storage**: Stream & discard (zero local storage)
- **HTTPS**: All external connections use TLS

---

## 📊 Monitoring

- Check `/api/gdrive/poll` (GET) for statistics
- Monitor database for job statuses
- Review server logs for processing errors
- Notion database shows all completed calls

---

## 🐛 Troubleshooting

**No files discovered?**
- Check service account has access to Drive folder
- Verify ALLOWED_USERS includes file owner email
- Check GOOGLE_DRIVE_FOLDER_ID is correct

**Transcription fails?**
- Verify ASSEMBLYAI_API_KEY is valid
- Check audio file format (.m4a, .amr supported)
- Review server logs for errors

**Notion sync fails?**
- Verify NOTION_API_KEY is valid
- Check database is shared with integration
- Ensure database has correct properties

---

## 📄 License

MIT

---

## 🙏 Credits

Built with:
- [Next.js 15](https://nextjs.org)
- [Drizzle ORM](https://orm.drizzle.team)
- [AssemblyAI](https://www.assemblyai.com)
- [OpenAI](https://openai.com)
- [Notion API](https://developers.notion.com)
- [Google Drive API](https://developers.google.com/drive)
