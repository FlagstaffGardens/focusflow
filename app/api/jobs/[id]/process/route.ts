import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { jobs } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { processJob } from '@/lib/jobs/processor'

export const runtime = 'nodejs';
export const maxDuration = 300; // 5 minutes

/**
 * POST /api/jobs/[id]/process
 * Process a discovered job: transcribe → summarize → sync to Notion
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: jobId } = await params;

  const db = getDb();
  try {
    // Ensure job exists
    const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId));
    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    // Allow manual re-run from discovered or failed states
    if (!['discovered', 'failed'].includes(job.status)) {
      return NextResponse.json(
        { error: `Job is ${job.status}` },
        { status: 400 },
      );
    }

    // Move to transcribing before invoking the processor
    await db
      .update(jobs)
      .set({ status: 'transcribing', transcription_started_at: new Date(), updated_at: new Date() })
      .where(eq(jobs.id, jobId))

    await processJob(jobId)

    // Return final job state
    const [finalJob] = await db.select().from(jobs).where(eq(jobs.id, jobId));

    return NextResponse.json({
      success: true,
      job: finalJob,
    });
  } catch (error) {
    console.error(`[${jobId}] Processing failed:`, error);

    // Update job with error
    await db
      .update(jobs)
      .set({
        status: 'failed',
        error_message: error instanceof Error ? error.message : 'Unknown error',
        updated_at: new Date(),
      })
      .where(eq(jobs.id, jobId));

    return NextResponse.json(
      {
        error: 'Processing failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
