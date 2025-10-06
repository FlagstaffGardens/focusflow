import { google } from 'googleapis';
import { JWT } from 'google-auth-library';
import { Readable } from 'stream';

if (!process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
  throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY environment variable is required');
}

if (!process.env.GOOGLE_DRIVE_FOLDER_ID) {
  throw new Error('GOOGLE_DRIVE_FOLDER_ID environment variable is required');
}

// Parse service account key
const serviceAccountKey = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);

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
export async function getJsonContent(fileId: string): Promise<any> {
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
          resolve(JSON.parse(jsonData));
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
