import { Client } from '@notionhq/client';
import type { Job } from '../db/schema';
import { getDriveFileUrl } from '../gdrive/client';
import { markdownToNotionBlocks } from './markdown-parser';

if (!process.env.NOTION_API_KEY) {
  throw new Error('NOTION_API_KEY environment variable is required');
}

if (!process.env.NOTION_DATABASE_ID) {
  throw new Error('NOTION_DATABASE_ID environment variable is required');
}

const notion = new Client({ auth: process.env.NOTION_API_KEY });
const DATABASE_ID = process.env.NOTION_DATABASE_ID;

/**
 * Helper function to split long text into 2000-char chunks for Notion
 */
function splitTextIntoChunks(text: string, maxLength: number = 2000): string[] {
  const chunks: string[] = [];
  let currentChunk = '';

  // Split by paragraphs first to avoid breaking mid-sentence
  const paragraphs = text.split('\n');

  for (const paragraph of paragraphs) {
    if ((currentChunk + paragraph + '\n').length <= maxLength) {
      currentChunk += paragraph + '\n';
    } else {
      if (currentChunk) chunks.push(currentChunk.trim());

      // If single paragraph is too long, split it
      if (paragraph.length > maxLength) {
        const words = paragraph.split(' ');
        currentChunk = '';
        for (const word of words) {
          if ((currentChunk + word + ' ').length <= maxLength) {
            currentChunk += word + ' ';
          } else {
            if (currentChunk) chunks.push(currentChunk.trim());
            currentChunk = word + ' ';
          }
        }
      } else {
        currentChunk = paragraph + '\n';
      }
    }
  }

  if (currentChunk) chunks.push(currentChunk.trim());
  return chunks;
}

/**
 * Sync a completed job to Notion
 * Creates a new page with metadata and content (summary + collapsible transcript)
 */
export async function syncJobToNotion(job: Job): Promise<{ pageId: string; url: string }> {
  try {
    // Prepare title
    const title = job.contact_name
      ? `${job.call_type === 'whatsapp' ? '💬' : '📞'} ${job.contact_name} ${job.call_direction === 'incoming' ? '↙' : '↗'}`
      : 'Call Recording';

    // Prepare properties
    const properties: any = {
      Title: {
        title: [{ text: { content: title } }],
      },
    };

    // Add date
    if (job.call_timestamp) {
      properties.Date = {
        date: { start: new Date(job.call_timestamp).toISOString() },
      };
    }

    // Add direction
    if (job.call_direction) {
      properties.Direction = {
        select: { name: job.call_direction === 'incoming' ? 'Incoming' : 'Outgoing' },
      };
    }

    // Add duration
    if (job.duration_seconds) {
      properties.Duration = {
        number: job.duration_seconds,
      };
    }

    // Add Drive link
    if (job.gdrive_file_id) {
      properties['Drive Link'] = {
        url: getDriveFileUrl(job.gdrive_file_id),
      };
    }

    // Add status
    properties.Status = {
      select: { name: 'Complete' },
    };

    // Prepare page content (children blocks)
    const children: any[] = [];

    // Add summary section with proper markdown formatting
    if (job.summary) {
      // Convert markdown summary to Notion blocks
      const summaryBlocks = markdownToNotionBlocks(job.summary);
      children.push(...summaryBlocks);
    }

    // Add divider
    if (job.summary && job.transcript) {
      children.push({
        object: 'block',
        type: 'divider',
        divider: {},
      });
    }

    // Add transcript in collapsible toggle
    if (job.transcript) {
      // Split transcript into chunks
      const transcriptChunks = splitTextIntoChunks(job.transcript);
      const transcriptBlocks = transcriptChunks.map(chunk => ({
        object: 'block' as const,
        type: 'paragraph' as const,
        paragraph: {
          rich_text: [
            {
              type: 'text' as const,
              text: { content: chunk },
            },
          ],
        },
      }));

      children.push({
        object: 'block',
        type: 'toggle',
        toggle: {
          rich_text: [{ type: 'text', text: { content: '📝 Transcript' } }],
          children: transcriptBlocks,
        },
      });
    }

    // Create or update Notion page
    if (job.notion_page_id) {
      try {
        // Try to update existing page
        const page = await notion.pages.update({
          page_id: job.notion_page_id,
          properties,
        });

        return {
          pageId: page.id,
          url: (page as any).url,
        };
      } catch (error: any) {
        // If page doesn't exist or is archived, create a new one
        if (
          error.code === 'object_not_found' ||
          error.code === 'validation_error' && error.message?.includes('archived')
        ) {
          console.log(`Notion page ${job.notion_page_id} not found or archived, creating new one...`);
        } else {
          throw error;
        }
      }
    }

    // Create new page with first 100 blocks (Notion limit)
    const firstBatch = children.slice(0, 100);
    const remainingBlocks = children.slice(100);

    const page = await notion.pages.create({
      parent: { database_id: DATABASE_ID },
      properties,
      children: firstBatch.length > 0 ? firstBatch : undefined,
    });

    // Append remaining blocks in batches of 100
    if (remainingBlocks.length > 0) {
      console.log(`Appending ${remainingBlocks.length} additional blocks...`);
      for (let i = 0; i < remainingBlocks.length; i += 100) {
        const batch = remainingBlocks.slice(i, i + 100);
        await notion.blocks.children.append({
          block_id: page.id,
          children: batch,
        });
      }
    }

    return {
      pageId: page.id,
      url: (page as any).url,
    };
  } catch (error) {
    console.error('Failed to sync to Notion:', error);
    throw error;
  }
}

/**
 * Update Notion page status
 */
export async function updateNotionStatus(pageId: string, status: string): Promise<void> {
  try {
    await notion.pages.update({
      page_id: pageId,
      properties: {
        Status: {
          select: { name: status },
        },
      },
    });
  } catch (error) {
    console.error('Failed to update Notion status:', error);
    throw error;
  }
}

/**
 * Check if a job already exists in Notion by matching the title
 * Returns the Notion page if found, null otherwise
 */
export async function checkDuplicateInNotion(job: Job): Promise<{ pageId: string; url: string } | null> {
  // If job already has a notion_page_id, return it
  if (job.notion_page_id && job.notion_url) {
    return {
      pageId: job.notion_page_id,
      url: job.notion_url,
    };
  }

  // For now, skip duplicate checking via API (can be enhanced later)
  // Just return null to proceed with sync
  return null;
}
