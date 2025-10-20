// Analyze transcripts in DB and report duplicates by content hash
require('dotenv').config()
const { Client } = require('pg')
const crypto = require('crypto')
const fs = require('fs/promises')
const path = require('path')

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is required')
  const client = new Client({ connectionString: url })
  await client.connect()
  try {
    const { rows } = await client.query("SELECT id, gdrive_file_name, source, call_type, status, transcript FROM jobs WHERE transcript IS NOT NULL")
    const map = new Map()
    for (const r of rows) {
      const text = String(r.transcript || '')
      const hash = crypto.createHash('sha256').update(text).digest('hex')
      if (!map.has(hash)) map.set(hash, { count: 0, sampleText: text.slice(0, 200), jobs: [] })
      const entry = map.get(hash)
      entry.count++
      entry.jobs.push({ id: r.id, name: r.gdrive_file_name, status: r.status, call_type: r.call_type })
    }
    const groups = Array.from(map.entries())
      .map(([hash, v]) => ({ hash, count: v.count, sampleText: v.sampleText, jobs: v.jobs }))
      .sort((a, b) => b.count - a.count)

    const duplicates = groups.filter(g => g.count > 1)
    const stats = {
      total_with_transcript: rows.length,
      unique_by_hash: groups.length,
      duplicate_groups: duplicates.length,
      duplicate_instances: duplicates.reduce((acc, g) => acc + g.count, 0),
    }

    const outDir = path.resolve(process.cwd(), 'exports')
    await fs.mkdir(outDir, { recursive: true })
    await fs.writeFile(path.join(outDir, 'transcript_duplicates.json'), JSON.stringify({ stats, groups: duplicates }, null, 2), 'utf8')

    console.log('Transcript duplicate analysis:')
    console.log(stats)
    if (duplicates[0]) {
      console.log('Top duplicate group sample:', {
        count: duplicates[0].count,
        sampleText: duplicates[0].sampleText,
        sampleJobs: duplicates[0].jobs.slice(0, 5),
      })
    }
  } finally {
    await client.end()
  }
}

main().catch(err => { console.error('Duplicate report failed:', err); process.exit(1) })

