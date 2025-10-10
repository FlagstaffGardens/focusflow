# FocusFlow V2 - Complete Specification

## Overview
Automated call recording processing system. Cube ACR records calls → Google Drive → FocusFlow processes → PostgreSQL stores → Notion organizes. Fully automated, no manual intervention.

## Current State (V1)
- Manual Plaud.ai share link submission
- Pipeline: URL → Download → Transcribe (AssemblyAI) → Summarize (OpenAI)
- File-based persistence (`jobs.json`)
- No database, no automation

## Target State (V2)
- **Automatic processing** of Cube ACR recordings from Google Drive
- **PostgreSQL database** (replaces file-based storage)
- **Stream processing** (no local audio storage)
- **Notion sync** (organized presentation layer)
- **Background polling** (checks Drive every 5 minutes)
- **Metadata extraction** (contact, direction, duration from filename)

---

## Architecture

### Tech Stack
- **Frontend/API**: Next.js 15 (App Router) - existing, keep as-is
- **Database**: PostgreSQL (via Dokploy)
- **Audio Storage**: Google Drive only (stream & discard, never save locally)
- **Transcription**: AssemblyAI
- **Summarization**: OpenAI
- **Organization**: Notion (one-way sync after processing)
- **Deployment**: Dokploy (Postgres + Next.js + cron)

### Complete Data Flow
```
Cube ACR (Android) records call
    ↓ (auto-upload)
Google Drive Folder (permanent audio storage)
    ↓ (cron polls every 5min)
FocusFlow Discovery Service
    ↓ (parse filename → extract metadata)
    ↓ (check allowlist + dedup)
Create Job in PostgreSQL (status: pending)
    ↓ (stream audio from Drive API)
AssemblyAI Transcription (stream, no disk write)
    ↓ (store transcript in Postgres)
OpenAI Summarization
    ↓ (store summary in Postgres)
Mark Job Complete in PostgreSQL
    ↓ (trigger sync)
Create/Update Notion Database Entry
    ↓
User views in Next.js UI or Notion
```

### What Gets Stored Where

| Data Type | Storage Location | Why |
|-----------|------------------|-----|
| Audio files | **Google Drive ONLY** | Source of truth, never duplicate |
| Job metadata | **PostgreSQL** | Fast queries, relations, persistence |
| Transcripts | **PostgreSQL** | Full-text search capability |
| Summaries | **PostgreSQL** | Source of truth for processed content |
| Organized view | **Notion** | Rich UI for browsing/tagging/search |
| ~~Audio downloads~~ | ~~None~~ | Stream & discard, zero local storage |

### Integration Points

1. **Google Drive Watcher**
   - Poll shared folder for new audio files (.mp3, .m4a, .wav)
   - Track processed files to avoid reprocessing
   - Filter by file owner email (allowlist)

2. **Metadata Parser**
   - Extract contact name, timestamp, direction from Cube ACR filename format
   - Example: `JohnDoe_20231015_143022_Incoming.m4a`
   - Parse into structured metadata

### Timezone handling

- Cube ACR filenames encode the call start in **Australia/Melbourne** local time. The arrow suffix (↗ / ↙) and phone/WhatsApp tag follow the timestamp string.
- During discovery we parse that wall-clock time and convert it into an absolute `Date` using `localTimeInZoneToDate(..., 'Australia/Melbourne')`. The resulting `Date` represents the same instant in **UTC** and is what gets persisted in Postgres (`jobs.call_timestamp`).
- Because the database column is `timestamp without time zone`, every downstream consumer (UI, Notion sync, CSV exports) must explicitly treat the stored value as UTC when rendering dates.
- Daylight saving is handled automatically: `localTimeInZoneToDate` uses the IANA timezone database via `Intl.DateTimeFormat` so the correct offset is applied for the call date.
- When you need to match the exact wall-clock string from Drive (e.g. to locate the source file), reformat the stored UTC instant in the `Australia/Melbourne` zone.

3. **Job Queue Enhancement**
   - Add `source: 'cube-acr' | 'plaud'` field
   - Add call-specific fields: `contact_name`, `call_direction`, `call_duration_seconds`
   - Store `gdrive_file_id` for deduplication

4. **Background Poller**
   - API endpoint: `POST /api/gdrive/poll` (triggered by cron)
   - Check for new files → Create jobs automatically
   - Respect rate limits and processing capacity

---

## Implementation Plan

### Phase 0: User Setup (Prerequisites)

#### Step 1: Google Cloud Service Account Setup

**Complete these steps to create your private Google Drive connection:**

1. **Create Google Cloud Project**
   - Go to https://console.cloud.google.com
   - Click "New Project"
   - Name: `focusflow` (or your choice)
   - Click "Create"

2. **Enable Google Drive API**
   - In your project, go to "APIs & Services" → "Library"
   - Search for "Google Drive API"
   - Click "Enable"

3. **Create Service Account**
   - Go to "APIs & Services" → "Credentials"
   - Click "+ CREATE CREDENTIALS" → "Service Account"
   - Name: `focusflow-drive-access`
   - Description: "FocusFlow automated Drive access"
   - Click "Create and Continue"
   - Skip optional steps (no roles needed)
   - Click "Done"

4. **Generate Service Account Key**
   - Click on your new service account email (looks like `focusflow-drive-access@yourproject.iam.gserviceaccount.com`)
   - Go to "Keys" tab
   - Click "Add Key" → "Create new key"
   - Choose "JSON"
   - Click "Create" - this downloads a JSON file
   - **IMPORTANT**: Keep this file secure, never commit to git

5. **Share Google Drive Folder**
   - Open Google Drive
   - Create or navigate to your Cube ACR recordings folder
   - Right-click → "Share"
   - Paste the service account email (from step 3)
   - Set permission: "Viewer" (read-only)
   - Uncheck "Notify people"
   - Click "Share"

6. **Get Folder ID**
   - Open the shared folder in Google Drive
   - Copy the ID from URL: `https://drive.google.com/drive/folders/FOLDER_ID_HERE`
   - Save this ID for environment variables

**Your Google Drive is now securely connected!** Only you and the service account have access.

---

#### Step 2: Dokploy PostgreSQL Setup

1. **Create Postgres Service in Dokploy**
   - In Dokploy dashboard, go to your project
   - Click "Add Service" → "Database" → "PostgreSQL"
   - Name: `focusflow-db`
   - Set password (save it!)
   - Click "Create"

2. **Get Connection String**
   - Dokploy will provide: `postgresql://postgres:PASSWORD@HOST:5432/focusflow`
   - Save this for `DATABASE_URL` environment variable

---

#### Step 3: Notion Integration Setup

1. **Create Notion Integration**
   - Go to https://www.notion.so/my-integrations
   - Click "+ New integration"
   - Name: `FocusFlow`
   - Associated workspace: (select yours)
   - Click "Submit"
   - Copy the "Internal Integration Token" (starts with `secret_`)

2. **Create Notion Database**
   - In Notion, create a new page: "Call Recordings"
   - Add a database (table view)
   - Add these properties:
     - **Title** (title) - will be contact name
     - **Date** (date) - call timestamp
     - **Direction** (select: Incoming, Outgoing)
     - **Duration** (number) - seconds
     - **Transcript** (text) - toggle block
     - **Summary** (text) - rich text
     - **Drive Link** (url) - link to audio file
     - **Status** (select: Processing, Complete)

3. **Share Database with Integration**
   - Click "..." on database → "Connections"
   - Click "+ Add connections"
   - Select "FocusFlow" integration
   - Click "Confirm"

4. **Get Database ID**
   - Open database as full page
   - Copy ID from URL: `https://notion.so/DATABASE_ID_HERE?v=...`
   - Save this for `NOTION_DATABASE_ID`

---

### Phase 1: Database Migration (PostgreSQL)

**Files to create/modify:**
- `lib/db/schema.ts` - PostgreSQL schema (Drizzle ORM)
- `lib/db/client.ts` - Database connection
- `lib/db/migrate.ts` - Migration from jobs.json
- `lib/pipeline/storage/job-store.ts` - Replace with Postgres implementation

**Tasks:**
1. Install Drizzle ORM + postgres driver
2. Define schema with all job fields
3. Create migration script for existing jobs.json
4. Replace file-based storage with Postgres queries
5. Update all job CRUD operations

**PostgreSQL Schema:**
```typescript
// lib/db/schema.ts
export const jobs = pgTable('jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  status: varchar('status', { enum: ['pending', 'processing', 'completed', 'failed'] }),
  source: varchar('source', { enum: ['plaud', 'cube-acr'] }),

  // Google Drive
  gdrive_file_id: varchar('gdrive_file_id').unique(),

  // Call metadata
  contact_name: varchar('contact_name'),
  contact_number: varchar('contact_number'),
  call_direction: varchar('call_direction', { enum: ['incoming', 'outgoing'] }),
  call_timestamp: timestamp('call_timestamp'),
  duration_seconds: integer('duration_seconds'),

  // Processing results
  transcript: text('transcript'),
  summary: text('summary'),

  // Notion sync
  notion_page_id: varchar('notion_page_id').unique(),

  // Timestamps
  created_at: timestamp('created_at').defaultNow(),
  updated_at: timestamp('updated_at').defaultNow()
})
```

**Environment Variables:**
```env
DATABASE_URL=postgresql://postgres:password@localhost:5432/focusflow
```

---

### Phase 2: Google Drive Integration

**Files to create:**
- `lib/pipeline/gdrive/client.ts` - Google Drive API wrapper
- `lib/pipeline/gdrive/watcher.ts` - File discovery and filtering
- `lib/pipeline/gdrive/resolver.ts` - Get stream download URL
- `lib/pipeline/gdrive/allowlist.ts` - User filtering logic

**Tasks:**
1. Install Google APIs client library
2. Implement Drive API client with service account auth
3. Build file listing with folder filtering
4. Implement streaming download URL generation (no disk write)
5. Create allowlist checker (email-based)

**Environment Variables:**
```env
GOOGLE_SERVICE_ACCOUNT_KEY={"type":"service_account","project_id":"focusflow",...}
GOOGLE_DRIVE_FOLDER_ID=1aBcDeFgHiJkLmNoPqRsTuVwXyZ
ALLOWED_USERS=user1@gmail.com,user2@gmail.com
```

---

### Phase 3: Metadata Extraction

**Files to create:**
- `lib/pipeline/cube-acr/parser.ts` - Parse Cube ACR filenames
- `lib/pipeline/cube-acr/types.ts` - TypeScript types for call metadata

**Tasks:**
1. Parse filename patterns (various Cube ACR formats)
2. Extract contact name/number
3. Parse timestamp into ISO date
4. Detect call direction (incoming/outgoing)
5. Extract duration from file metadata if available

**Expected filename formats:**
- `ContactName_YYYYMMDD_HHMMSS_Direction.ext`
- `+1234567890_YYYYMMDD_HHMMSS.ext`
- `Unknown_YYYYMMDD_HHMMSS.ext`

---

### Phase 4: Streaming Pipeline Update

**Files to modify:**
- `lib/pipeline/index.ts` - Update to stream instead of download
- `lib/pipeline/utils/downloader.ts` - Replace with streaming logic
- `lib/pipeline/assemblyai/client.ts` - Accept stream input

**Tasks:**
1. Replace file download with streaming from Drive API
2. Stream audio directly to AssemblyAI (no disk write)
3. Remove all `DATA_DIR` file writes for audio
4. Update job processing to work with streams
5. Keep transcript/summary storage in Postgres

**Key Change:**
```typescript
// OLD: Download → Save → Transcribe
const audioPath = await downloadAudio(url)
const transcript = await transcribe(audioPath)

// NEW: Stream → Transcribe (no save)
const audioStream = await getGDriveStream(fileId)
const transcript = await transcribe(audioStream)
```

---

### Phase 5: Background Polling Service

**Files to create:**
- `app/api/gdrive/poll/route.ts` - Cron-triggered polling endpoint
- `lib/pipeline/gdrive/watcher.ts` - File discovery logic

**Tasks:**
1. Create polling endpoint that lists new Drive files
2. Check each file against existing jobs (by `gdrive_file_id`)
3. Verify file owner against allowlist
4. Parse filename → extract metadata
5. Create job in Postgres for each new file
6. Add error handling and logging

**Deduplication strategy:**
- Query Postgres: `SELECT * FROM jobs WHERE gdrive_file_id = ?`
- Skip if already exists
- No separate tracking needed (Postgres is source of truth)

**Environment Variables:**
```env
CRON_SECRET=your-secret-key-here  # Protect polling endpoint
```

---

### Phase 6: Notion Sync

**Files to create:**
- `lib/notion/client.ts` - Notion API wrapper
- `lib/notion/sync.ts` - Sync job to Notion database

**Tasks:**
1. Install Notion SDK
2. Implement client with authentication
3. Create sync function (called after job completion)
4. Map Postgres job fields → Notion properties
5. Store `notion_page_id` in Postgres for updates
6. Handle errors gracefully (don't block job completion)

**Sync Logic:**
```typescript
async function syncToNotion(jobId: string) {
  const job = await getJob(jobId)

  if (job.notion_page_id) {
    // Update existing page
    await notion.pages.update({
      page_id: job.notion_page_id,
      properties: mapJobToNotionProps(job)
    })
  } else {
    // Create new page
    const page = await notion.pages.create({
      parent: { database_id: NOTION_DATABASE_ID },
      properties: mapJobToNotionProps(job)
    })
    await updateJob(jobId, { notion_page_id: page.id })
  }
}
```

**Environment Variables:**
```env
NOTION_API_KEY=secret_xxxxxxxxxxxxx
NOTION_DATABASE_ID=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

---

### Phase 7: UI Enhancements

**Files to modify:**
- `app/page.tsx` - Update UI to show call-specific metadata
- `app/api/jobs/route.ts` - Update API to return new fields

**Tasks:**
1. Replace "Untitled Meeting" with contact name
2. Show call direction icon (incoming ↓ / outgoing ↑)
3. Display call duration badge
4. Update date formatting to use `call_timestamp`
5. Add "Notion" sync status indicator
6. Show "Auto-synced" badge for cube-acr jobs

**UI Changes:**
```
Before: "Untitled Meeting • Oct 15, 2:30 PM"
After:  "📞 John Doe (↓ Incoming) • Oct 15, 2:30 PM • 5m 23s • Notion ✓"
```

---

### Phase 8: Dokploy Deployment

**Tasks:**
1. **Create Dokploy App**
   - Go to Dokploy dashboard
   - Create new app from GitHub repo
   - Connect to `focusflow` repository

2. **Configure Environment Variables**
   - Add all required env vars in Dokploy:
     ```env
     # Database (from Phase 0 Step 2)
     DATABASE_URL=postgresql://postgres:PASSWORD@HOST:5432/focusflow

     # Google Drive (from Phase 0 Step 1)
     GOOGLE_SERVICE_ACCOUNT_KEY={"type":"service_account",...}
     GOOGLE_DRIVE_FOLDER_ID=1aBcDeFgHiJkLmNoPqRsTuVwXyZ
     ALLOWED_USERS=your-email@gmail.com

     # Notion (from Phase 0 Step 3)
     NOTION_API_KEY=secret_xxxxxxxxxxxxx
     NOTION_DATABASE_ID=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

     # Processing
     ASSEMBLYAI_API_KEY=xxxxxxxxxxxxx
     OPENAI_API_KEY=sk-xxxxxxxxxxxxx
     OPENAI_BASE_URL=https://api.openai.com
     OPENAI_MODEL=gpt-4o-mini

     # Security
     BASIC_AUTH_USER=admin
     BASIC_AUTH_PASSWORD=your-secure-password
     CRON_SECRET=your-cron-secret

     # App
     PORT=3000
     ```

3. **Set Up Cron Job in Dokploy**
   - Go to app settings → "Cron Jobs"
   - Add new cron:
     - **Schedule**: `*/5 * * * *` (every 5 minutes)
     - **Command**: `curl -X POST https://your-app.com/api/gdrive/poll -H "Authorization: Bearer $CRON_SECRET"`
   - Save

4. **Deploy**
   - Push to main branch
   - Dokploy auto-deploys
   - Monitor logs for any errors

**Dokploy Architecture:**
```
[Dokploy]
  ├── PostgreSQL Service (focusflow-db)
  ├── Next.js App (focusflow)
  └── Cron Job (polling every 5min)
```

---

## Security Considerations

1. **Service Account Key**
   - Store in environment variable (never commit to git)
   - Keep JSON key file secure (treat like a password)
   - Service account only has "Viewer" permission on Drive folder
   - Rotate key periodically (regenerate in Google Cloud Console)

2. **Allowlist Validation**
   - Verify file owner email before processing
   - Support wildcard domains: `*@company.com` for team access
   - Log unauthorized access attempts to monitor abuse
   - Reject files from non-allowlisted users silently

3. **API Endpoint Protection**
   - Polling endpoint (`/api/gdrive/poll`) requires `CRON_SECRET` header
   - Existing `BASIC_AUTH` still protects UI and other API routes
   - Rate limiting on all endpoints (default: 60 req/min)
   - Notion sync failures don't block job processing

4. **Data Privacy**
   - Audio never stored locally (stream & discard)
   - Google Drive is source of truth for audio (your private folder)
   - Transcripts/summaries stored in Postgres (hosted on Dokploy)
   - Notion only receives processed text (no audio)
   - All connections use HTTPS/TLS
   - Service account has minimal permissions (Drive viewer only)

---

## Testing Strategy

1. **Unit Tests**
   - Metadata parser with various filename formats
   - Allowlist matching logic
   - Deduplication logic

2. **Integration Tests**
   - Google Drive file listing
   - Job creation from Drive files
   - End-to-end: file → job → processed

3. **Manual Testing**
   - Upload test file to Drive folder
   - Verify polling detects it
   - Check metadata extraction accuracy
   - Confirm allowlist filtering works

---

## Rollout Plan

1. **Development**
   - Create test Google Drive folder
   - Implement core components
   - Test with sample Cube ACR recordings

2. **Staging**
   - Deploy with polling disabled (manual trigger)
   - Test with real user recordings
   - Verify allowlist works correctly

3. **Production**
   - Enable background polling
   - Monitor for errors
   - Gradually add more users to allowlist

---

## Decision Log

### Finalized Decisions ✓

1. **Tech Stack**
   - ✅ Keep Next.js 15 full-stack (no separate backend)
   - ✅ PostgreSQL via Dokploy (replace `jobs.json`)
   - ✅ Drizzle ORM (lightweight, type-safe)
   - ✅ Stream processing (no local audio storage)
   - ✅ One-way Notion sync (Postgres → Notion)
   - ✅ Dokploy deployment (with cron)

2. **Storage Architecture**
   - ✅ Google Drive: Audio files only (permanent)
   - ✅ PostgreSQL: All metadata, transcripts, summaries
   - ✅ Notion: Synced copy for organization/browsing
   - ✅ No `DATA_DIR` audio storage (stream & discard)

3. **Security Model**
   - ✅ Service account for Drive access (private, no OAuth)
   - ✅ Allowlist validation before processing
   - ✅ `CRON_SECRET` protects polling endpoint
   - ✅ `BASIC_AUTH` protects UI

### Open Questions

- [ ] What is the exact Cube ACR filename format? (Need sample files for parser)
- [ ] Keep Plaud.ai support or deprecate? (Can keep both sources)
- [ ] Retention policy: Delete from Drive after processing? (Probably keep permanently)
- [ ] Multi-folder support: Different folders for different users? (Not needed for V2)
- [ ] Notification system: Email/Slack when call processed? (Future enhancement)
- [ ] Real-time UI updates: WebSocket/SSE vs polling? (Polling is fine for V2)

---

## Success Metrics

**Core Requirements:**
- ✅ **Automation**: 0 manual URL submissions needed
- ✅ **Latency**: Calls processed within 10 minutes of upload
- ✅ **Privacy**: Audio never leaves Google Drive permanently
- ✅ **Reliability**: 0 missed recordings, 0 duplicate processing

**Quality Metrics:**
- 🎯 **Accuracy**: >95% correct metadata extraction from filenames
- 🎯 **Uptime**: 99% availability (Dokploy monitoring)
- 🎯 **Sync**: 100% Notion sync success rate (or graceful failure)

---

## Next Steps

1. **Phase 0**: Complete user setup (Google Cloud, Dokploy, Notion)
2. **Phase 1**: Migrate to PostgreSQL + Drizzle ORM
3. **Phase 2-8**: Implement features sequentially
4. **Testing**: Unit tests + integration tests + manual verification
5. **Deploy**: Dokploy with cron enabled

**Ready to start? Begin with Phase 0 user setup, then move to Phase 1 (database migration).**
