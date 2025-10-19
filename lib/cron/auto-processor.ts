import cron from 'node-cron'
import type { ScheduledTask } from 'node-cron'
import { getDb } from '@/lib/db/client'
import { jobs } from '@/lib/db/schema'
import { and, desc, eq, inArray, gte, sql, or } from 'drizzle-orm'
import { processJob } from '@/lib/jobs/processor'

let autoCron: ScheduledTask | null = null
const serviceStart = new Date()

function getEnvBool(name: string, def = false): boolean {
  const v = process.env[name]
  if (v == null) return def
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase())
}

function parseIntEnv(name: string, def: number): number {
  const v = Number.parseInt(process.env[name] || '')
  return Number.isFinite(v) ? v : def
}

function parseDirections(): Array<'incoming' | 'outgoing'> {
  const raw = (process.env.AUTO_PROCESS_DIRECTIONS || 'incoming').toLowerCase()
  const parts = raw.split(',').map(s => s.trim()).filter(Boolean)
  const result = parts.filter((p): p is 'incoming' | 'outgoing' => p === 'incoming' || p === 'outgoing')
  const dropped = parts.filter(p => p !== 'incoming' && p !== 'outgoing')
  if (dropped.length > 0) {
    console.warn(`[AUTO] Ignoring invalid AUTO_PROCESS_DIRECTIONS tokens: ${dropped.join(', ')}`)
  }
  return result.length > 0 ? result : ['incoming']
}

async function claimEligibleJobs(limit: number, minDuration: number, directions: Array<'incoming' | 'outgoing'>, cutoff?: Date, maxRetries?: number) {
  const db = getDb()

  // 1) Select eligible candidates by status + direction (+ duration if present)
  const candidates = await db
    .select({ id: jobs.id, duration: jobs.duration_seconds })
    .from(jobs)
    .where(
      and(
        eq(jobs.status, 'discovered'),
        // Process phone/whatsapp by direction; allow mic regardless of direction
        or(eq(jobs.call_type, 'mic'), inArray(jobs.call_direction, directions)),
        // allow missing duration; if present, require >= minDuration
        sql`(${jobs.duration_seconds} IS NULL OR ${jobs.duration_seconds} >= ${minDuration})`,
        cutoff ? gte(jobs.discovered_at, cutoff) : sql`TRUE`,
        maxRetries != null ? sql`COALESCE(${jobs.retry_count}, 0) < ${maxRetries}` : sql`TRUE`,
      ),
    )
    .orderBy(desc(jobs.discovered_at))
    .limit(limit)

  const claimed: string[] = []

  // 2) Atomically claim each job to avoid races
  for (const c of candidates) {
    const res = await db
      .update(jobs)
      .set({ status: 'transcribing', transcription_started_at: new Date(), updated_at: new Date() })
      .where(and(eq(jobs.id, c.id), eq(jobs.status, 'discovered')))
      .returning({ id: jobs.id })

    if (res.length > 0) claimed.push(res[0].id)
  }

  return claimed
}

async function runOnce(): Promise<void> {
  if (!getEnvBool('AUTO_PROCESS_ENABLED', true)) {
    return
  }

  const directions = parseDirections()
  const minDuration = parseIntEnv('AUTO_MIN_DURATION', 20)
  const maxBatch = parseIntEnv('AUTO_MAX_BATCH', 3)
  const concurrency = parseIntEnv('AUTO_CONCURRENCY', 1)
  const maxRetries = parseIntEnv('AUTO_MAX_RETRIES', 3)

  // Only process future jobs if requested (default true).
  // If AUTO_PROCESS_SINCE is provided (ISO string), use that cutoff; otherwise use service start.
  const onlyFuture = getEnvBool('AUTO_PROCESS_ONLY_FUTURE', true)
  let cutoff: Date | undefined
  if (onlyFuture) {
    const since = process.env.AUTO_PROCESS_SINCE
    const parsed = since ? new Date(since) : serviceStart
    cutoff = isNaN(parsed.getTime()) ? serviceStart : parsed
  }

  try {
    const ids = await claimEligibleJobs(maxBatch, minDuration, directions, cutoff, maxRetries)
    if (ids.length === 0) return

    console.log(`[AUTO] Claimed ${ids.length} job(s): ${ids.join(', ')}`)

    // Simple concurrency pool
    let idx = 0

    const next = (): Promise<void> => {
      if (idx >= ids.length) return Promise.resolve()
      const id = ids[idx++]
      return processJob(id)
        .catch(err => {
          console.error(`[${id}] Auto-processing failed:`, err)
          const db = getDb()
          return db
            .update(jobs)
            .set({ status: 'failed', error_message: err instanceof Error ? err.message : String(err), updated_at: new Date(), retry_count: sql`${jobs.retry_count} + 1` })
            .where(eq(jobs.id, id))
        })
        .then(() => next())
    }

    const starters = Array.from({ length: Math.min(concurrency, ids.length) }, () => next())
    await Promise.all(starters)
  } catch (error) {
    console.error('[AUTO] Processor tick failed:', error)
  }
}

export function startAutoProcessorCron() {
  const schedule = process.env.AUTO_PROCESS_CRON || '*/1 * * * *' // default: every minute

  if (autoCron) {
    console.log('Auto-processor cron already running; skipping re-init')
    return
  }

  autoCron = cron.schedule(schedule, () => {
    void runOnce()
  })

  console.log(`✓ Cron scheduled: Auto-processing at '${schedule}'`)

  // Kick once on startup to reduce latency
  void runOnce()
}

export function stopAutoProcessorCron() {
  if (autoCron) {
    autoCron.stop()
    autoCron = null
    console.log('Auto-processor cron stopped')
  }
}
