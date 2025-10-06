import { parseCubeACRFilename, getJsonFilename, isCubeACRFile } from '../cube-acr/parser';
import { getJsonContent, getDriveFileUrl } from './client';
import type { NewJob } from '../db/schema';

interface DriveFile {
  id: string;
  name: string;
  size?: string;
  owners?: Array<{ emailAddress?: string }>;
}

interface CubeACRJsonMetadata {
  duration?: string; // milliseconds as string
  callee?: string;
  direction?: string;
}

/**
 * Extract complete metadata from a Cube ACR audio file
 * Combines filename parsing with JSON metadata
 */
export async function extractCubeACRMetadata(
  audioFile: DriveFile,
  jsonFiles: DriveFile[]
): Promise<Partial<NewJob> | null> {
  try {
    // Check if it's a Cube ACR file
    if (!isCubeACRFile(audioFile.name || '')) {
      console.log(`Skipping non-Cube ACR file: ${audioFile.name}`);
      return null;
    }

    // Parse filename for basic metadata
    const parseResult = parseCubeACRFilename(audioFile.name || '');
    if (!parseResult.metadata) {
      console.error(`Failed to parse filename: ${audioFile.name}`, parseResult.error);
      return null;
    }

    const { metadata } = parseResult;

    // Try to find matching JSON file for duration
    const jsonFileName = getJsonFilename(audioFile.name || '');
    const jsonFile = jsonFiles.find((f) => f.name === jsonFileName);

    let durationSeconds: number | undefined;
    let jsonFileId: string | undefined;

    if (jsonFile && jsonFile.id) {
      try {
        jsonFileId = jsonFile.id;
        const jsonContent: CubeACRJsonMetadata = await getJsonContent(jsonFile.id);

        // Duration is in milliseconds, convert to seconds
        if (jsonContent.duration) {
          const durationMs = parseInt(jsonContent.duration, 10);
          durationSeconds = Math.round(durationMs / 1000);
        }
      } catch (error) {
        console.error(`Failed to fetch JSON metadata for ${audioFile.name}:`, error);
        // Continue without duration
      }
    }

    // Get file owner email
    const ownerEmail = audioFile.owners?.[0]?.emailAddress;

    // Construct job data
    const jobData: Partial<NewJob> = {
      source: 'cube-acr',
      status: 'discovered',

      // Google Drive
      gdrive_file_id: audioFile.id,
      gdrive_file_name: audioFile.name,
      gdrive_file_size: audioFile.size ? parseInt(audioFile.size, 10) : undefined,
      gdrive_json_id: jsonFileId,

      // Call metadata from filename
      contact_name: metadata.contactName,
      contact_number: metadata.contactNumber,
      call_direction: metadata.callDirection,
      call_timestamp: metadata.callTimestamp,
      call_type: metadata.callType,

      // Duration from JSON
      duration_seconds: durationSeconds,

      // Timestamps
      discovered_at: new Date(),
    };

    return jobData;
  } catch (error) {
    console.error(`Error extracting metadata for ${audioFile.name}:`, error);
    return null;
  }
}

/**
 * Extract owner email from Drive file
 */
export function getFileOwner(file: DriveFile): string | undefined {
  return file.owners?.[0]?.emailAddress;
}

/**
 * Get Drive URL for a file
 */
export function getFileUrl(fileId: string): string {
  return getDriveFileUrl(fileId);
}
