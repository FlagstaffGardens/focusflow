import { getDb } from '@/lib/db/client'
import { sql } from 'drizzle-orm'

export async function ensureDbIndexes(): Promise<void> {
  try {
    const db = getDb()
    // Eligibility query index: status + direction + discovered_at
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_jobs_eligibility ON jobs (status, call_direction, discovered_at DESC)`)
  } catch (err) {
    console.warn('[DB] ensureDbIndexes warning:', err)
  }
}

