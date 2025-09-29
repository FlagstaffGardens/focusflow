import { NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import path from 'path'
import { getJobQueue } from '@/lib/queue'
import { enforceRateLimit } from '@/lib/server/security'
import type { NextRequest } from 'next/server'

type RouteParams = { id: string }

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<RouteParams> }
) {
  const limited = enforceRateLimit(request)
  if (limited) return limited

  const { id: jobId } = await params

  try {
    const queue = getJobQueue()
    const job = await queue.getStore().getJob(jobId)

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    if (!job.transcript_path) {
      return NextResponse.json({ transcript: null })
    }

    // Load transcript content
    const transcriptPath = path.isAbsolute(job.transcript_path)
      ? job.transcript_path
      : path.join(process.cwd(), job.transcript_path)

    try {
      await fs.access(transcriptPath)
    } catch {
      return NextResponse.json({ transcript: null })
    }

    const transcript = await fs.readFile(transcriptPath, 'utf-8')
    return NextResponse.json({ transcript })
  } catch (error) {
    console.error('Failed to load transcript:', error)
    return NextResponse.json(
      { error: 'Failed to load transcript' },
      { status: 500 }
    )
  }
}
