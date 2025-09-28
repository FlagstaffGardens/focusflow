# FocusFlow Repo Reorganization Plan

> **Update**
> The plan below describes the transition from the Reflex monorepo to the Next.js workspace. The live repository has since been flattened: the app is under the root `app/` directory and the shared pipeline code under `lib/pipeline/`.

## Overview
Managing the Next.js migration within the same repository while preserving the Reflex implementation for reference.

## Directory Structure

```
focusflow/
├── archive/                      # Historical Reflex implementation
│   └── reflex-v1/               # Complete snapshot of Reflex app
│       ├── main/                # Python app code
│       ├── scripts/             # Python scripts
│       ├── prompts/             # Prompt templates
│       ├── Dockerfile           # Reflex Docker setup
│       ├── docker-compose.yml   # Reflex compose config
│       ├── Caddyfile           # Reverse proxy config
│       ├── start.sh            # Startup scripts
│       ├── start-simple.sh
│       ├── rxconfig.py         # Reflex config
│       ├── requirements.txt    # Python deps
│       └── README.md           # Reflex-specific docs
│
├── apps/                        # Monorepo apps (pnpm workspace)
│   ├── web/                    # Next.js 15 app
│   │   ├── app/               # App Router pages
│   │   ├── components/        # React components
│   │   ├── lib/              # Utilities
│   │   └── public/           # Static assets
│   │
│   └── worker/                # Background job processor
│       ├── src/              # Worker source
│       └── package.json      # Worker deps
│
├── packages/                   # Shared packages
│   └── pipeline/              # Core pipeline logic
│       ├── src/
│       │   ├── plaud/        # Plaud resolver
│       │   ├── assemblyai/   # Transcription client
│       │   ├── openai/       # GPT client
│       │   ├── storage/      # File system ops
│       │   └── utils/        # Shared utilities
│       └── package.json
│
├── data/                      # Persistent storage (gitignored)
│   ├── files/                # Audio files
│   ├── transcripts/          # Transcript cache
│   ├── summaries/            # Summary cache
│   ├── logs/                 # Job logs
│   └── jobs.json            # Job database
│
├── doc/                       # Documentation
│   ├── nextjs_migration_spec.md
│   ├── migration-reorganization-plan.md (this file)
│   ├── ai_endpoints.md       # API contracts
│   ├── lessons-learned/      # Post-mortems
│   │   ├── reflex-deployment.md
│   │   └── deployment-checklist.md
│   └── archive/              # Old Reflex docs
│       └── reflex-deployment-knowledge/
│
├── prompts/                   # Prompt templates (shared)
│   ├── meeting_summary.md
│   └── title_generator.md
│
├── scripts/                   # Development scripts
│   ├── migrate-data.ts       # Data migration tool
│   ├── smoke-test.ts         # E2E smoke test
│   └── dev.sh               # Dev environment setup
│
├── docker/                    # Docker configs
│   ├── Dockerfile.web        # Next.js container
│   ├── Dockerfile.worker     # Worker container
│   └── docker-compose.yml    # Multi-service setup
│
├── .github/                  # CI/CD
│   └── workflows/
│       ├── test.yml         # Run tests
│       └── deploy.yml       # Deploy pipeline
│
├── pnpm-workspace.yaml       # Monorepo config
├── package.json             # Root package.json
├── .env.example            # Environment template
├── .gitignore             # Git ignore rules
└── README.md              # Project overview
```

## Migration Steps

### Phase 1: Archive Reflex Implementation (Day 0)

```bash
# 1. Create archive structure
mkdir -p archive/reflex-v1
mkdir -p doc/archive
mkdir -p doc/lessons-learned

# 2. Move Reflex files to archive
mv main/ archive/reflex-v1/
mv scripts/ archive/reflex-v1/
mv rxconfig.py archive/reflex-v1/
mv start*.sh archive/reflex-v1/
mv Caddyfile archive/reflex-v1/
mv requirements.txt archive/reflex-v1/

# 3. Copy Docker files for reference
cp Dockerfile archive/reflex-v1/
cp docker-compose.yml archive/reflex-v1/

# 4. Move Reflex docs
mv doc/reflex-deployment-knowledge doc/archive/

# 5. Keep shared resources in place
# - prompts/ (used by both)
# - doc/ai_endpoints.md (API contract)
# - data/ (persistent storage)
```

### Phase 2: Create Next.js Structure (Day 0-1)

```bash
# 1. Initialize pnpm workspace
pnpm init

# 2. Create workspace config
cat > pnpm-workspace.yaml << 'EOF'
packages:
  - "apps/*"
  - "packages/*"
EOF

# 3. Setup Next.js app
pnpm create next-app@latest apps/web \
  --typescript --tailwind --app \
  --src-dir=false --import-alias="@/*"

# 4. Setup worker package
mkdir -p apps/worker/src
cd apps/worker && pnpm init

# 5. Setup shared pipeline package
mkdir -p packages/pipeline/src
cd packages/pipeline && pnpm init
```

### Phase 3: Port Core Logic (Day 1-2)

```typescript
// packages/pipeline/src/index.ts
export * from './plaud/resolver'
export * from './assemblyai/client'
export * from './openai/client'
export * from './storage/filesystem'
export * from './utils/logger'
```

### Phase 4: Build Migration Tools

```typescript
// scripts/migrate-data.ts
// Convert app.db → jobs.json if needed
// Validate existing data structure
// Backup before migration
```

## File Movement Checklist

### Keep in Root
- [ ] README.md (update for Next.js)
- [ ] .gitignore (update patterns)
- [ ] LICENSE (if exists)

### Move to Archive
- [x] main/*.py → archive/reflex-v1/main/
- [x] scripts/*.py → archive/reflex-v1/scripts/
- [x] rxconfig.py → archive/reflex-v1/
- [x] requirements.txt → archive/reflex-v1/
- [x] start*.sh → archive/reflex-v1/
- [x] Caddyfile → archive/reflex-v1/
- [x] AGENTS.md → archive/reflex-v1/ (Reflex-specific)

### Keep and Share
- [ ] prompts/*.md (used by both implementations)
- [ ] doc/ai_endpoints.md (API contract)
- [ ] data/ directory structure

### Create New
- [ ] apps/web/ (Next.js app)
- [ ] apps/worker/ (job processor)
- [ ] packages/pipeline/ (shared logic)
- [ ] docker/ (new Docker configs)
- [ ] scripts/*.ts (TypeScript versions)

## Git Strategy

```bash
# 1. Create migration branch
git checkout -b nextjs-migration

# 2. Commit archive
git add archive/
git commit -m "Archive Reflex v1 implementation"

# 3. Incremental commits for each phase
git commit -m "Initialize pnpm workspace structure"
git commit -m "Setup Next.js 15 application"
git commit -m "Port pipeline logic to TypeScript"
# etc...

# 4. Keep main branch stable
# Only merge when Next.js version is functional
```

## Data Compatibility

### Maintain Backward Compatibility
```jsonc
// jobs.json structure remains same
{
  "id": "job_123",
  "url": "...",
  "status": "...",
  // Same fields as Reflex version
}
```

### Migration Script
```bash
# Optional: Convert SQLite to JSON if needed
python -c "
import json, sqlite3
conn = sqlite3.connect('app.db')
# ... conversion logic
"
```

## Environment Variables

### Shared Variables (both implementations)
```env
ASSEMBLYAI_API_KEY=xxx
OPENAI_API_KEY=xxx
OPENAI_BASE_URL=xxx
OPENAI_MODEL=xxx
```

### Next.js Specific
```env
NEXT_PUBLIC_APP_URL=http://localhost:3000
NODE_ENV=development
```

## Testing During Migration

```bash
# 1. Smoke test old implementation
cd archive/reflex-v1
python scripts/smoke_pipeline.py

# 2. Smoke test new implementation
pnpm test:smoke

# 3. Compare outputs
diff data/old-job.json data/new-job.json
```

## Clean Boundaries

### What NOT to Mix
- Python and TypeScript code in same directories
- Reflex and Next.js configs
- Old and new Docker setups

### What TO Share
- Prompt templates (markdown files)
- API endpoint documentation
- Data directory structure
- Environment variable names

## Deployment Transition

### Stage 1: Archive Deployment
- Current Reflex app continues running
- No changes to production

### Stage 2: Parallel Testing
- Deploy Next.js to staging URL
- Test with same data directory
- Validate feature parity

### Stage 3: Switchover
- Update DNS/proxy to Next.js
- Keep Reflex as fallback
- Monitor for issues

### Stage 4: Cleanup
- Remove Reflex deployment
- Archive can stay in repo for reference

## Timeline

| Day | Task |
|-----|------|
| 0 | Archive Reflex, Setup workspace |
| 1 | Initialize Next.js, Port resolver |
| 2 | Port AssemblyAI/GPT clients |
| 3 | Build UI components |
| 4 | Implement SSE streaming |
| 5 | Worker setup, job queue |
| 6 | Testing, migration tools |
| 7 | Documentation, deployment |

## Success Criteria

- [ ] All Reflex code archived and accessible
- [ ] Clean monorepo structure established
- [ ] No mixed Python/TypeScript in same dirs
- [ ] Data format remains compatible
- [ ] Prompts and docs properly shared
- [ ] Clear deployment path
- [ ] Rollback possible if needed
