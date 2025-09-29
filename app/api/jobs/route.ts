import { NextRequest, NextResponse } from 'next/server'
import { getJobQueue } from '@/lib/queue'
import { enforceRateLimit } from '@/lib/server/security'
import { z } from 'zod'

const CreateJobSchema = z.object({
  url: z.string().url(),
  meetingDate: z.string().optional(),
})

// GET /api/jobs - List all jobs
export async function GET(request: NextRequest) {
  const limited = enforceRateLimit(request)
  if (limited) return limited

  try {
    const queue = getJobQueue()
    const jobs = await queue.getStore().getJobs()

    return NextResponse.json({ jobs })
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
