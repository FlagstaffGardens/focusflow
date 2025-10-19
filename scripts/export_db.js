// Export all jobs and artifacts from Postgres to ./exports
// - Uses DATABASE_URL from .env
// - Writes:
//   exports/jobs.json
//   exports/jobs.jsonl
//   exports/jobs.csv
//   exports/transcripts/{id}.txt
//   exports/summaries/{id}.md
//   exports/stats.json (with counts incl. distinct transcripts)

require('dotenv').config()
const fs = require('fs')
const fsp = require('fs/promises')
const path = require('path')
const crypto = require('crypto')
const { Client } = require('pg')

function ensureDirSync(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function toCsvRow(values) {
  return values
    .map((v) => {
      if (v == null) return ''
      const s = String(v)
      if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"'
      return s
    })
    .join(',')
}

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is required')

  const outDir = path.resolve(process.cwd(), 'exports')
  ensureDirSync(outDir)
  const transcriptsDir = path.join(outDir, 'transcripts')
  const summariesDir = path.join(outDir, 'summaries')
  ensureDirSync(transcriptsDir)
  ensureDirSync(summariesDir)

  const client = new Client({ connectionString: url })
  await client.connect()
  try {
    const { rows } = await client.query('SELECT * FROM jobs ORDER BY discovered_at DESC NULLS LAST, created_at DESC NULLS LAST')

    // Write JSON and JSONL
    await fsp.writeFile(path.join(outDir, 'jobs.json'), JSON.stringify(rows, null, 2), 'utf8')
    const jsonl = rows.map((r) => JSON.stringify(r)).join('\n')
    await fsp.writeFile(path.join(outDir, 'jobs.jsonl'), jsonl + (jsonl ? '\n' : ''), 'utf8')

    // Write CSV (selected columns to stay readable)
    const headers = [
      'id','status','source','call_type','call_direction','call_timestamp','contact_name','contact_number','duration_seconds','gdrive_file_id','gdrive_file_name','gdrive_file_size','gdrive_json_id','notion_page_id','notion_url','discovered_at','created_at','updated_at','completed_at'
    ]
    const csvLines = [headers.join(',')]
    for (const r of rows) {
      csvLines.push(
        toCsvRow(headers.map((h) => r[h]))
      )
    }
    await fsp.writeFile(path.join(outDir, 'jobs.csv'), csvLines.join('\n') + '\n', 'utf8')

    // Export transcripts and summaries; compute stats
    let withTranscript = 0
    let withSummary = 0
    let completed = 0
    const hashes = new Set()
    for (const r of rows) {
      if (r.transcript) {
        withTranscript++
        const file = path.join(transcriptsDir, `${r.id}.txt`)
        await fsp.writeFile(file, r.transcript, 'utf8')
        const hash = crypto.createHash('sha256').update(r.transcript).digest('hex')
        hashes.add(hash)
      }
      if (r.summary) {
        withSummary++
        const file = path.join(summariesDir, `${r.id}.md`)
        await fsp.writeFile(file, r.summary, 'utf8')
      }
      if (r.status === 'completed') completed++
    }

    const stats = {
      total_jobs: rows.length,
      with_transcript: withTranscript,
      with_summary: withSummary,
      completed,
      distinct_transcripts: hashes.size,
      exported_at: new Date().toISOString(),
    }
    await fsp.writeFile(path.join(outDir, 'stats.json'), JSON.stringify(stats, null, 2), 'utf8')

    console.log('Export complete:')
    console.log(`- total_jobs: ${stats.total_jobs}`)
    console.log(`- with_transcript: ${stats.with_transcript}`)
    console.log(`- distinct_transcripts: ${stats.distinct_transcripts}`)
    console.log(`- with_summary: ${stats.with_summary}`)
    console.log(`- completed: ${stats.completed}`)
    console.log(`Files written to ${outDir}`)
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  console.error('Export failed:', err)
  process.exit(1)
})
