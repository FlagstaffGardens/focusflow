import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { jobs } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { syncJobToNotion } from '@/lib/notion/sync';

export const runtime = 'nodejs';

/**
 * POST /api/jobs/[id]/sync-notion
 * Manually sync a completed job to Notion
 * Checks for duplicates first
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: jobId } = await params;

  try {
    // Get job from database
    const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId));

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    if (job.status !== 'completed') {
      return NextResponse.json(
        { error: 'Job must be completed before syncing to Notion' },
        { status: 400 }
      );
    }

    if (!process.env.NOTION_API_KEY || !process.env.NOTION_DATABASE_ID) {
      return NextResponse.json(
        { error: 'Notion not configured' },
        { status: 400 }
      );
    }

    // Sync to Notion (will update if page exists, create if not)
    const notionResult = await syncJobToNotion(job);

    // Update database with Notion info
    await db
      .update(jobs)
      .set({
        notion_page_id: notionResult.pageId,
        notion_url: notionResult.url,
        updated_at: new Date(),
      })
      .where(eq(jobs.id, jobId));

    console.log(`[${jobId}] Synced to Notion: ${notionResult.url}`);

    return NextResponse.json({
      success: true,
      notion_url: notionResult.url,
    });
  } catch (error) {
    console.error(`[${jobId}] Notion sync failed:`, error);
    return NextResponse.json(
      {
        error: 'Notion sync failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
