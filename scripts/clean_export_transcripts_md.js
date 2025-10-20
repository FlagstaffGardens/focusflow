// Clean exports/ and export one transcript per job as a simple .md file
// - Removes ALL files/directories inside exports/
// - Writes {sanitized_gdrive_filename}.md with transcript content only
// - Falls back to {jobId}.md when no filename is available

require('dotenv').config()
const fs = require('fs')
const fsp = require('fs/promises')
const path = require('path')
const { Client } = require('pg')

function sanitizeBase(name) {
  const base = name.replace(/\.[^.]+$/, '')
  return base.replace(/[\0-\x1F<>:"/\\|?*]+/g, ' ').replace(/\s+/g, ' ').trim()
}

async function rimrafDirContents(dir) {
  try {
    const entries = await fsp.readdir(dir, { withFileTypes: true })
    await Promise.all(entries.map(async (e) => {
      const p = path.join(dir, e.name)
      await fsp.rm(p, { recursive: true, force: true })
    }))
  } catch (e) {
    if (e && e.code === 'ENOENT') return
    throw e
  }
}

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is required')
  const outDir = path.resolve(process.cwd(), 'exports')
  await fsp.mkdir(outDir, { recursive: true })

  // Clean existing contents
  await rimrafDirContents(outDir)

  const client = new Client({ connectionString: url })
  await client.connect()
  try {
    const { rows } = await client.query('SELECT id, gdrive_file_name, transcript FROM jobs WHERE transcript IS NOT NULL ORDER BY discovered_at DESC NULLS LAST, created_at DESC NULLS LAST')

    let written = 0
    const used = new Set()
    for (const r of rows) {
      const base = r.gdrive_file_name ? sanitizeBase(String(r.gdrive_file_name)) : String(r.id)
      let file = path.join(outDir, base + '.md')
      // Ensure uniqueness
      let idx = 1
      while (used.has(file) || fs.existsSync(file)) {
        file = path.join(outDir, `${base}-${idx}.md`)
        idx++
      }
      used.add(file)

      await fsp.writeFile(file, String(r.transcript), 'utf8')
      written++
    }

    console.log(`Exported ${written} transcript .md files to ${outDir}`)
  } finally {
    await client.end()
  }
}

main().catch(err => { console.error('Simple transcript export failed:', err); process.exit(1) })

