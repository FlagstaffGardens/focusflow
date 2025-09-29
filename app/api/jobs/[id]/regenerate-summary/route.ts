import { NextRequest, NextResponse } from 'next/server'
import { getJobQueue } from '@/lib/queue'
import { enforceRateLimit } from '@/lib/server/security'

export const runtime = 'nodejs'

// POST /api/jobs/[id]/regenerate-summary - Regenerate summary only
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
      return NextResponse.json(
        { error: 'Job not found' },
        { status: 404 }
      )
    }

    if (!job.transcript_path) {
      return NextResponse.json(
        { error: 'No transcript available for this job' },
        { status: 400 }
      )
    }

    await queue.regenerateSummary(id)

    return NextResponse.json({
      success: true,
      message: 'Summary regeneration initiated'
    })
  } catch (error) {
    console.error('Error regenerating summary:', error)
    return NextResponse.json(
      { error: 'Failed to regenerate summary' },
      { status: 500 }
    )
  }
}
