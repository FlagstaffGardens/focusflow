import { google } from 'googleapis';
import { JWT } from 'google-auth-library';
import { Readable } from 'stream';
import fs from 'fs';
import path from 'path';

if (!process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
  throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY environment variable is required');
}

if (!process.env.GOOGLE_DRIVE_FOLDER_ID) {
  throw new Error('GOOGLE_DRIVE_FOLDER_ID environment variable is required');
}

// Parse service account key (supports JSON string or path to JSON file)
type ServiceAccountKey = { client_email: string; private_key: string };

function loadServiceAccountKey(): ServiceAccountKey {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY as string;
  const trimmed = raw.trim();

  // If it looks like inline JSON, parse directly
  if (trimmed.startsWith('{')) {
    return JSON.parse(trimmed) as ServiceAccountKey;
  }

  // Otherwise treat as file path (absolute or relative)
  const candidatePaths = [trimmed, path.resolve(process.cwd(), trimmed)];
  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      const content = fs.readFileSync(p, 'utf-8');
      return JSON.parse(content) as ServiceAccountKey;
    }
  }

  throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY must be JSON or a path to a JSON file');
}

const serviceAccountKey = loadServiceAccountKey();

// Create JWT auth client (new recommended way, no deprecation warnings)
const auth = new JWT({
  email: serviceAccountKey.client_email,
  key: serviceAccountKey.private_key,
  scopes: ['https://www.googleapis.com/auth/drive.readonly'],
});

// Create Drive client
export const drive = google.drive({ version: 'v3', auth });

// Export constants
export const FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;

/**
 * List all audio files in the configured Google Drive folder
 */
export async function listAudioFiles() {
  const response = await drive.files.list({
    q: `'${FOLDER_ID}' in parents and trashed=false and (mimeType='audio/mpeg' or mimeType='audio/mp4' or mimeType='audio/x-m4a' or mimeType='audio/amr')`,
    fields: 'files(id, name, mimeType, size, createdTime, owners)',
    orderBy: 'createdTime desc',
    pageSize: 1000,
  });

  return response.data.files || [];
}

/**
 * List JSON metadata files in the configured Google Drive folder
 */
export async function listJsonFiles() {
  const response = await drive.files.list({
    q: `'${FOLDER_ID}' in parents and trashed=false and mimeType='application/json'`,
    fields: 'files(id, name)',
    orderBy: 'createdTime desc',
    pageSize: 1000,
  });

  return response.data.files || [];
}

/**
 * Get file by ID
 */
export async function getFile(fileId: string) {
  const response = await drive.files.get({
    fileId,
    fields: 'id, name, mimeType, size, createdTime, owners, webContentLink',
  });

  return response.data;
}

/**
 * Get audio stream from Google Drive
 * Returns a readable stream that can be piped to transcription services
 */
export async function getAudioStream(fileId: string): Promise<Readable> {
  const response = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'stream' }
  );

  return response.data as Readable;
}

/**
 * Get JSON metadata content
 */
export async function getJsonContent<T = unknown>(fileId: string): Promise<T> {
  const response = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'stream' }
  );

  return new Promise((resolve, reject) => {
    let jsonData = '';
    response.data
      .on('data', (chunk: Buffer) => {
        jsonData += chunk.toString();
      })
      .on('end', () => {
        try {
          resolve(JSON.parse(jsonData) as T);
        } catch (error) {
          reject(new Error('Failed to parse JSON: ' + error));
        }
      })
      .on('error', reject);
  });
}

/**
 * Get Drive file URL for Notion
 */
export function getDriveFileUrl(fileId: string): string {
  return `https://drive.google.com/file/d/${fileId}/view`;
}

/**
 * Check if file owner is in allowlist
 */
export function isAllowedUser(ownerEmail: string): boolean {
  const allowedUsers = (process.env.ALLOWED_USERS || '').split(',').map(email => email.trim());
  return allowedUsers.includes(ownerEmail);
}
