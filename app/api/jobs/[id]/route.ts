import { NextRequest, NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import path from 'path'

import { getJobQueue } from '@/lib/queue'
import { enforceRateLimit } from '@/lib/server/security'
import type { Job } from '@/lib/pipeline'

type RouteParams = { id: string }

// GET /api/jobs/[id] - Get job details
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<RouteParams> }
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
          const transcriptPath = path.resolve(job.transcript_path)
          result.transcript = await fs.readFile(transcriptPath, 'utf-8')
        } catch {
          // Ignore if file doesn't exist
        }
      }

      if (job.summary_path) {
        try {
          const summaryPath = path.resolve(job.summary_path)
          result.summary = await fs.readFile(summaryPath, 'utf-8')
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
  const limited = enforceRateLimit(request)
  if (limited) return limited

  try {
    const { id } = await params
    const queue = getJobQueue()
    const deleted = await queue.getStore().deleteJob(id)

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
