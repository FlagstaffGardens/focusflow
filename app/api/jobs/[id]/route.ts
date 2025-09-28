import { NextRequest, NextResponse } from 'next/server'
import { getJobQueue } from '@/lib/queue'
import type { Job } from '@/lib/pipeline'

type RouteParams = { id: string }
import { readFileSync } from 'fs'

// GET /api/jobs/[id] - Get job details
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<RouteParams> }
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

    // Optionally hydrate transcript/summary content
    const { searchParams } = new URL(request.url)
    const includeContent = searchParams.get('content') === 'true'

    if (includeContent) {
      const result: Job & {
        transcript?: string
        summary?: string
      } = { ...job }

      if (job.transcript_path) {
        try {
          result.transcript = readFileSync(job.transcript_path, 'utf-8')
        } catch {
          // Ignore if file doesn't exist
        }
      }

      if (job.summary_path) {
        try {
          result.summary = readFileSync(job.summary_path, 'utf-8')
        } catch {
          // Ignore if file doesn't exist
        }
      }

      return NextResponse.json(result)
    }

    return NextResponse.json(job)
  } catch (error) {
    console.error('Error fetching job:', error)
    return NextResponse.json(
      { error: 'Failed to fetch job' },
      { status: 500 }
    )
  }
}

// DELETE /api/jobs/[id] - Delete job
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<RouteParams> }
) {
  try {
    const { id } = await params
    const queue = getJobQueue()
    const deleted = queue.getStore().deleteJob(id)

    if (!deleted) {
      return NextResponse.json(
        { error: 'Job not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting job:', error)
    return NextResponse.json(
      { error: 'Failed to delete job' },
      { status: 500 }
    )
  }
}
