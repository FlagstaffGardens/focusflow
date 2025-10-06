import { NextRequest, NextResponse } from 'next/server'
import { getJobQueue } from '@/lib/queue'
import { enforceRateLimit } from '@/lib/server/security'
import { z } from 'zod'
import { db } from '@/lib/db/client'
import { jobs } from '@/lib/db/schema'
import { desc } from 'drizzle-orm'

export const runtime = 'nodejs'

const CreateJobSchema = z.object({
  url: z.string().url(),
  meetingDate: z.string().optional(),
})

// GET /api/jobs - List all jobs from database
export async function GET(request: NextRequest) {
  const limited = enforceRateLimit(request)
  if (limited) return limited

  try {
    // Fetch all jobs from database, ordered by call timestamp (for Cube ACR) or created_at (for Plaud)
    // This ensures calls are sorted by actual call time, not discovery time
    const allJobs = await db
      .select()
      .from(jobs)
      .orderBy(desc(jobs.call_timestamp), desc(jobs.created_at))

    return NextResponse.json({ jobs: allJobs })
  } catch (error) {
    console.error('Error fetching jobs:', error)
    return NextResponse.json(
      { error: 'Failed to fetch jobs' },
      { status: 500 }
    )
  }
}

// POST /api/jobs - Create new job
export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request)
  if (limited) return limited

  try {
    const body = await request.json()
    const validated = CreateJobSchema.parse(body)

    const queue = getJobQueue()
    const job = await queue.enqueue(validated.url, validated.meetingDate)

    return NextResponse.json(job, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request', details: error.errors },
        { status: 400 }
      )
    }

    console.error('Error creating job:', error)
    return NextResponse.json(
      { error: 'Failed to create job' },
      { status: 500 }
    )
  }
}
