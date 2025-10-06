import { db } from '../db/client';
import { jobs } from '../db/schema';
import { eq } from 'drizzle-orm';
import { listAudioFiles, listJsonFiles, isAllowedUser } from './client';
import { extractCubeACRMetadata, getFileOwner } from './metadata';

export interface DiscoveryResult {
  discovered: number;
  skipped: number;
  errors: number;
  details: {
    newJobs: string[];
    skippedFiles: string[];
    errors: Array<{ file: string; error: string }>;
  };
}

/**
 * Discover new Cube ACR recordings from Google Drive
 * Creates database records for files that haven't been processed yet
 */
export async function discoverNewRecordings(): Promise<DiscoveryResult> {
  const result: DiscoveryResult = {
    discovered: 0,
    skipped: 0,
    errors: 0,
    details: {
      newJobs: [],
      skippedFiles: [],
      errors: [],
    },
  };

  try {
    console.log('🔍 Starting Google Drive discovery...');

    // Fetch all audio and JSON files
    const [audioFiles, jsonFiles] = await Promise.all([
      listAudioFiles(),
      listJsonFiles(),
    ]);

    console.log(`📁 Found ${audioFiles.length} audio file(s) and ${jsonFiles.length} JSON file(s)`);

    // Process each audio file
    for (const audioFile of audioFiles) {
      try {
        const fileName = audioFile.name || 'Unknown';

        // Check file owner against allowlist
        const ownerEmail = getFileOwner(audioFile);
        if (ownerEmail && !isAllowedUser(ownerEmail)) {
          console.log(`⏭️  Skipping file from non-allowed user: ${fileName} (${ownerEmail})`);
          result.skipped++;
          result.details.skippedFiles.push(`${fileName} (unauthorized user)`);
          continue;
        }

        // Check if already in database (by gdrive_file_id)
        const existing = await db
          .select()
          .from(jobs)
          .where(eq(jobs.gdrive_file_id, audioFile.id || ''))
          .limit(1);

        if (existing.length > 0) {
          console.log(`⏭️  Already discovered: ${fileName}`);
          result.skipped++;
          result.details.skippedFiles.push(`${fileName} (already in database)`);
          continue;
        }

        // Extract metadata from filename and JSON
        const jobData = await extractCubeACRMetadata(audioFile, jsonFiles);

        if (!jobData) {
          console.log(`⚠️  Could not extract metadata: ${fileName}`);
          result.errors++;
          result.details.errors.push({ file: fileName, error: 'Metadata extraction failed' });
          continue;
        }

        // Create database record
        const [newJob] = await db.insert(jobs).values(jobData).returning();

        console.log(`✅ Discovered: ${fileName} → Job ${newJob.id}`);
        result.discovered++;
        result.details.newJobs.push(`${fileName} (${newJob.id})`);

      } catch (error) {
        const fileName = audioFile.name || 'Unknown';
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error(`❌ Error processing ${fileName}:`, error);
        result.errors++;
        result.details.errors.push({ file: fileName, error: errorMessage });
      }
    }

    console.log(`\n📊 Discovery complete:`);
    console.log(`   ✅ Discovered: ${result.discovered}`);
    console.log(`   ⏭️  Skipped: ${result.skipped}`);
    console.log(`   ❌ Errors: ${result.errors}`);

    return result;

  } catch (error) {
    console.error('❌ Discovery service error:', error);
    throw error;
  }
}

/**
 * Get discovery statistics
 */
export async function getDiscoveryStats() {
  const [total, discovered, processing, completed, failed] = await Promise.all([
    db.select().from(jobs),
    db.select().from(jobs).where(eq(jobs.status, 'discovered')),
    db.select().from(jobs).where(eq(jobs.status, 'transcribing')),
    db.select().from(jobs).where(eq(jobs.status, 'completed')),
    db.select().from(jobs).where(eq(jobs.status, 'failed')),
  ]);

  return {
    total: total.length,
    discovered: discovered.length,
    processing: processing.length,
    completed: completed.length,
    failed: failed.length,
  };
}
