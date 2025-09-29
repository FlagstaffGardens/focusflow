import { NextRequest, NextResponse } from 'next/server'
import { getJobQueue } from '@/lib/queue'
import { enforceRateLimit } from '@/lib/server/security'

// POST /api/jobs/[id]/resummarize - Regenerate summary and title for a job
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const limited = enforceRateLimit(request)
  if (limited) return limited

  try {
    const { id } = await params
    const queue = getJobQueue()
    const job = await queue.getStore().getJob(id)

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    if (!job.transcript_path) {
      return NextResponse.json(
        { error: 'No transcript available to resummarize' },
        { status: 400 }
      )
    }

    // Use the regenerateSummary method from the queue
    await queue.regenerateSummary(job.id)

    const updatedJob = queue.getStore().getJob(id)
    return NextResponse.json(updatedJob)
  } catch (error) {
    console.error('Error resummarizing job:', error)
    return NextResponse.json(
      { error: 'Failed to resummarize job' },
      { status: 500 }
    )
  }
}
