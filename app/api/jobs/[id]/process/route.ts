import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { jobs } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { getAudioStream } from '@/lib/gdrive/client';
import { transcribeWithAssemblyAI } from '@/lib/pipeline/assemblyai/client';
import { summarizeWithGPT } from '@/lib/pipeline/openai/client';
import { syncJobToNotion } from '@/lib/notion/sync';
import { writeFile, unlink } from 'fs/promises';
import path from 'path';
import os from 'os';

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
    // Get job from database
    const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId));

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    if (job.status !== 'discovered') {
      return NextResponse.json(
        { error: `Job is already ${job.status}` },
        { status: 400 }
      );
    }

    if (!job.gdrive_file_id) {
      return NextResponse.json(
        { error: 'No Google Drive file ID' },
        { status: 400 }
      );
    }

    // Step 1: Update status to transcribing
    await db
      .update(jobs)
      .set({
        status: 'transcribing',
        transcription_started_at: new Date(),
        updated_at: new Date(),
      })
      .where(eq(jobs.id, jobId));

    console.log(`[${jobId}] Starting transcription...`);

    // Step 2: Stream audio from Google Drive and save to temp file
    // (AssemblyAI needs a file path in current implementation)
    const audioStream = await getAudioStream(job.gdrive_file_id);
    const tempFilePath = path.join(os.tmpdir(), `${jobId}.m4a`);

    // Convert stream to buffer and write to temp file
    const chunks: Buffer[] = [];
    for await (const chunk of audioStream) {
      chunks.push(Buffer.from(chunk));
    }
    await writeFile(tempFilePath, Buffer.concat(chunks));

    console.log(`[${jobId}] Audio downloaded to temp file`);

    // Step 3: Transcribe with AssemblyAI
    const transcriptResult = await transcribeWithAssemblyAI(
      tempFilePath,
      process.env.ASSEMBLYAI_API_KEY || '',
      (msg) => console.log(`[${jobId}] ${msg}`)
    );

    if (!transcriptResult) {
      throw new Error('Transcription failed');
    }

    const transcript = transcriptResult.text;

    // Clean up temp file
    await unlink(tempFilePath).catch(() => {});

    // Update database with transcript
    await db
      .update(jobs)
      .set({
        status: 'transcribed',
        transcript,
        transcription_completed_at: new Date(),
        updated_at: new Date(),
      })
      .where(eq(jobs.id, jobId));

    console.log(`[${jobId}] Transcription complete`);

    // Step 4: Summarize with OpenAI
    await db
      .update(jobs)
      .set({
        status: 'summarizing',
        summarization_started_at: new Date(),
        updated_at: new Date(),
      })
      .where(eq(jobs.id, jobId));

    console.log(`[${jobId}] Starting summarization...`);

    const summaryGenerator = summarizeWithGPT(
      transcript,
      job.call_timestamp
        ? new Date(job.call_timestamp).toLocaleDateString()
        : new Date().toLocaleDateString(),
      {
        apiKey: process.env.OPENAI_API_KEY || '',
        baseUrl: process.env.OPENAI_BASE_URL,
        model: process.env.OPENAI_MODEL,
      },
      (msg) => console.log(`[${jobId}] ${msg}`)
    );

    let summary = '';
    for await (const chunk of summaryGenerator) {
      summary += chunk;
    }

    // Update database with summary
    await db
      .update(jobs)
      .set({
        summary,
        summarization_completed_at: new Date(),
        updated_at: new Date(),
      })
      .where(eq(jobs.id, jobId));

    console.log(`[${jobId}] Summarization complete`);

    // Step 5: Sync to Notion (if configured)
    if (process.env.NOTION_API_KEY && process.env.NOTION_DATABASE_ID) {
      await db
        .update(jobs)
        .set({
          status: 'syncing',
          updated_at: new Date(),
        })
        .where(eq(jobs.id, jobId));

      console.log(`[${jobId}] Syncing to Notion...`);

      try {
        const [updatedJob] = await db.select().from(jobs).where(eq(jobs.id, jobId));
        const notionResult = await syncJobToNotion(updatedJob);

        await db
          .update(jobs)
          .set({
            notion_page_id: notionResult.pageId,
            notion_url: notionResult.url,
            updated_at: new Date(),
          })
          .where(eq(jobs.id, jobId));

        console.log(`[${jobId}] Notion sync complete: ${notionResult.url}`);
      } catch (notionError) {
        console.error(`[${jobId}] Notion sync failed:`, notionError);
        // Don't fail the whole job if Notion sync fails
      }
    }

    // Step 6: Mark as completed
    await db
      .update(jobs)
      .set({
        status: 'completed',
        completed_at: new Date(),
        updated_at: new Date(),
      })
      .where(eq(jobs.id, jobId));

    console.log(`[${jobId}] Processing complete!`);

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
