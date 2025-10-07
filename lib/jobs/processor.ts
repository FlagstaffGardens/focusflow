import { getDb } from '@/lib/db/client'
import { jobs } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { getAudioStream } from '@/lib/gdrive/client'
import { transcribeWithAssemblyAI } from '@/lib/pipeline/assemblyai/client'
import { summarizeWithGPT } from '@/lib/pipeline/openai/client'
import { syncJobToNotion } from '@/lib/notion/sync'
import { writeFile, unlink } from 'fs/promises'
import { localTimeInZoneToDate } from '@/lib/utils/timezone'
import path from 'path'
import os from 'os'

/**
 * Core processing pipeline used by both the manual API and the auto-processor.
 *
 * Steps: Drive stream → temp file → AssemblyAI → OpenAI → Notion → DB updates.
 */
export async function processJob(jobId: string): Promise<void> {
  const db = getDb()

  // Load job
  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId))
  if (!job) throw new Error('Job not found')
  if (!job.gdrive_file_id) throw new Error('No Google Drive file ID')

  // Validate status: the caller must have set 'transcribing'
  if (job.status !== 'transcribing') {
    throw new Error(`Cannot process job in status: ${job.status}`)
  }

  // Step 1: Download audio to a temp path
  const audioStream = await getAudioStream(job.gdrive_file_id)
  const tempFilePath = path.join(os.tmpdir(), `${jobId}.m4a`)

  const chunks: Buffer[] = []
  for await (const chunk of audioStream) {
    chunks.push(Buffer.from(chunk))
  }
  await writeFile(tempFilePath, Buffer.concat(chunks))

  // Step 2: Transcribe with AssemblyAI
  const transcriptResult = await transcribeWithAssemblyAI(
    tempFilePath,
    process.env.ASSEMBLYAI_API_KEY || '',
    (msg) => console.log(`[${jobId}] ${msg}`),
  )

  if (!transcriptResult) {
    await unlink(tempFilePath).catch(() => {})
    throw new Error('Transcription failed')
  }

  const transcript = transcriptResult.text
  await unlink(tempFilePath).catch(() => {})

  await db
    .update(jobs)
    .set({
      status: 'transcribed',
      transcript,
      transcription_completed_at: new Date(),
      updated_at: new Date(),
    })
    .where(eq(jobs.id, jobId))

  // Step 3: Summarize with OpenAI
  await db
    .update(jobs)
    .set({ status: 'summarizing', summarization_started_at: new Date(), updated_at: new Date() })
    .where(eq(jobs.id, jobId))

  const ts = job.call_timestamp ? String(job.call_timestamp) : null
  const m = ts?.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:?\d{2})?$/)
  const callDate = m
    ? localTimeInZoneToDate(
        parseInt(m[1], 10),
        parseInt(m[2], 10),
        parseInt(m[3], 10),
        parseInt(m[4], 10),
        parseInt(m[5], 10),
        m[6] ? parseInt(m[6], 10) : 0,
        'Australia/Melbourne',
      )
    : (job.call_timestamp ? new Date(job.call_timestamp) : new Date())

  const melbourneDate = new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Melbourne',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(callDate)

  const summaryGenerator = summarizeWithGPT(
    transcript,
    melbourneDate,
    {
      apiKey: process.env.OPENAI_API_KEY || '',
      baseUrl: process.env.OPENAI_BASE_URL,
      model: process.env.OPENAI_MODEL,
    },
    (msg) => console.log(`[${jobId}] ${msg}`),
  )

  let summary = ''
  for await (const chunk of summaryGenerator) {
    summary += chunk
  }

  await db
    .update(jobs)
    .set({ summary, summarization_completed_at: new Date(), updated_at: new Date() })
    .where(eq(jobs.id, jobId))

  // Step 4: Sync to Notion (optional)
  if (process.env.NOTION_API_KEY && process.env.NOTION_DATABASE_ID) {
    await db
      .update(jobs)
      .set({ status: 'syncing', updated_at: new Date() })
      .where(eq(jobs.id, jobId))

    try {
      const [fresh] = await db.select().from(jobs).where(eq(jobs.id, jobId))
      const notionResult = await syncJobToNotion(fresh)
      await db
        .update(jobs)
        .set({ notion_page_id: notionResult.pageId, notion_url: notionResult.url, updated_at: new Date() })
        .where(eq(jobs.id, jobId))
    } catch (e) {
      console.error(`[${jobId}] Notion sync failed:`, e)
      // Continue; do not fail the whole job on Notion errors
    }
  }

  // Step 5: Completed
  await db
    .update(jobs)
    .set({ status: 'completed', completed_at: new Date(), updated_at: new Date() })
    .where(eq(jobs.id, jobId))
}
