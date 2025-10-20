// Export one Markdown file per job under exports/calls with readable names
// Filename base: prefer original Google Drive filename (without extension)
// Falls back to a sane default if missing.
// Content: title, metadata, summary (if any), transcript (if any)

require('dotenv').config()
const fs = require('fs')
const fsp = require('fs/promises')
const path = require('path')
const { Client } = require('pg')

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function sanitizeBase(name) {
  // Remove extension and sanitize for filesystem
  const base = name.replace(/\.[^.]+$/,'')
  return base.replace(/[\0-\x1F<>:"/\\|?*]+/g, ' ').replace(/\s+/g, ' ').trim()
}

function fmtMelbourne(isoOrDate) {
  const d = isoOrDate instanceof Date ? isoOrDate : new Date(String(isoOrDate))
  if (isNaN(d.getTime())) return 'Unknown'
  return new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Melbourne',
    year: 'numeric', month: 'short', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).format(d)
}

function secondsToHms(total) {
  if (!Number.isFinite(total) || total <= 0) return null
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const parts = []
  if (h) parts.push(`${h}h`)
  if (m || h) parts.push(`${m}m`)
  parts.push(`${s}s`)
  return parts.join(' ')
}

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is required')
  const outDir = path.resolve(process.cwd(), 'exports', 'calls')
  ensureDir(outDir)

  const client = new Client({ connectionString: url })
  await client.connect()
  try {
    const { rows } = await client.query('SELECT * FROM jobs ORDER BY call_timestamp NULLS LAST, discovered_at DESC NULLS LAST, created_at DESC NULLS LAST')
    let written = 0
    for (const r of rows) {
      const baseName = r.gdrive_file_name ? sanitizeBase(String(r.gdrive_file_name))
                        : (r.contact_name ? `${r.call_timestamp ? String(r.call_timestamp).slice(0,19).replace('T',' ') : 'unknown'} (${r.call_type || 'call'}) ${r.contact_name}`
                           : (r.id || 'call'))
      let file = path.join(outDir, baseName + '.md')
      if (fs.existsSync(file)) {
        const suffix = '-' + String(r.id).slice(0,8)
        file = path.join(outDir, baseName + suffix + '.md')
      }

      const titleIcon = r.call_type === 'whatsapp' ? '💬' : (r.call_type === 'mic' ? '🎙️' : '📞')
      const arrow = r.call_type === 'mic' ? '' : (r.call_direction === 'incoming' ? ' ↙' : (r.call_direction ? ' ↗' : ''))
      const title = r.contact_name ? `${titleIcon} ${r.contact_name}${arrow}`.trim() : baseName

      const melDate = r.call_timestamp ? fmtMelbourne(r.call_timestamp) : (r.discovered_at ? fmtMelbourne(r.discovered_at) : 'Unknown')
      const iso = r.call_timestamp ? new Date(String(r.call_timestamp)).toISOString() : ''
      const dur = secondsToHms(r.duration_seconds)
      const driveUrl = r.gdrive_file_id ? `https://drive.google.com/file/d/${r.gdrive_file_id}/view` : ''

      const metaLines = [
        `- Source: ${r.source || ''}`,
        `- Type: ${r.call_type || ''}`,
        r.call_direction ? `- Direction: ${r.call_direction}` : null,
        `- Date (Melbourne): ${melDate}`,
        iso ? `- Date (UTC ISO): ${iso}` : null,
        dur ? `- Duration: ${dur}` : null,
        r.contact_number ? `- Number: ${r.contact_number}` : null,
        driveUrl ? `- Drive: ${driveUrl}` : null,
        `- Job ID: ${r.id}`,
        `- Status: ${r.status}`,
      ].filter(Boolean).join('\n')

      const summary = r.summary ? String(r.summary) : '*No summary available yet.*'
      const transcript = r.transcript ? String(r.transcript) : ''

      const md = `# ${title}\n\n${metaLines}\n\n---\n\n## Summary\n\n${summary}\n\n${transcript ? '---\n\n## Transcript\n\n' + transcript : ''}\n`
      await fsp.writeFile(file, md, 'utf8')
      written++
    }
    console.log(`Wrote ${written} Markdown files to ${outDir}`)
  } finally {
    await client.end()
  }
}

main().catch(err => { console.error('Export calls MD failed:', err); process.exit(1) })

