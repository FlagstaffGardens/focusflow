import { NextResponse } from 'next/server'
import { readFileSync, existsSync } from 'fs'
import path from 'path'
import { getJobQueue } from '@/lib/queue'
import type { NextRequest } from 'next/server'

type RouteParams = { id: string }

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<RouteParams> }
) {
  const { id: jobId } = await params

  try {
    const queue = getJobQueue()
    const job = queue.getStore().getJob(jobId)

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
    if (!existsSync(transcriptPath)) {
      return NextResponse.json({ transcript: null })
    }

    const transcript = readFileSync(transcriptPath, 'utf-8')
    return NextResponse.json({ transcript })
  } catch (error) {
    console.error('Failed to load transcript:', error)
    return NextResponse.json(
      { error: 'Failed to load transcript' },
      { status: 500 }
    )
  }
}
