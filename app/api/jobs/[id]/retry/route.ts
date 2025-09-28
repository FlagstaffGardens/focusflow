import { NextRequest, NextResponse } from 'next/server'
import { getJobQueue } from '@/lib/queue'

// POST /api/jobs/[id]/retry - Retry failed job
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const queue = getJobQueue()
    const job = queue.getStore().getJob(id)

    if (!job) {
      return NextResponse.json(
        { error: 'Job not found' },
        { status: 404 }
      )
    }

    // Check if full rerun requested
    const { searchParams } = new URL(request.url)
    const fullRerun = searchParams.get('full') === 'true'

    await queue.retryJob(id, fullRerun)

    return NextResponse.json({
      success: true,
      message: fullRerun ? 'Full rerun initiated' : 'Retry initiated from checkpoint'
    })
  } catch (error) {
    console.error('Error retrying job:', error)
    return NextResponse.json(
      { error: 'Failed to retry job' },
      { status: 500 }
    )
  }
}