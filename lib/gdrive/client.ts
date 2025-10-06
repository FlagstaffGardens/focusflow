import { google } from 'googleapis';
import { JWT } from 'google-auth-library';
import { Readable } from 'stream';
import fs from 'fs';
import path from 'path';

// Lazily create Drive client to avoid build-time env dependency
type ServiceAccountKey = { client_email: string; private_key: string };
let cachedAuth: JWT | null = null;
let cachedDrive: ReturnType<typeof google.drive> | null = null;

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val || !val.trim()) {
    throw new Error(`${name} environment variable is required`);
  }
  return val;
}

function loadServiceAccountKey(): ServiceAccountKey {
  const raw = requireEnv('GOOGLE_SERVICE_ACCOUNT_KEY');
  const trimmed = raw.trim();

  if (trimmed.startsWith('{')) {
    return JSON.parse(trimmed) as ServiceAccountKey;
  }

  const candidatePaths = [trimmed, path.resolve(process.cwd(), trimmed)];
  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      const content = fs.readFileSync(p, 'utf-8');
      return JSON.parse(content) as ServiceAccountKey;
    }
  }

  throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY must be JSON or a path to a JSON file');
}

function getDriveInternal() {
  if (cachedDrive) return cachedDrive;

  const serviceAccountKey = loadServiceAccountKey();
  cachedAuth = new JWT({
    email: serviceAccountKey.client_email,
    key: serviceAccountKey.private_key,
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });
  cachedDrive = google.drive({ version: 'v3', auth: cachedAuth });
  return cachedDrive;
}

function getFolderId(): string {
  return requireEnv('GOOGLE_DRIVE_FOLDER_ID');
}

// Lightweight Drive file shape used internally
export type DriveFile = {
  id: string;
  name: string;
  size?: string;
  owners?: Array<{ emailAddress?: string }>;
};

/**
 * List all audio files in the configured Google Drive folder
 */
export async function listAudioFiles(): Promise<DriveFile[]> {
  const drive = getDriveInternal();
  const folderId = getFolderId();
  const response = await drive.files.list({
    q: `'${folderId}' in parents and trashed=false and (mimeType='audio/mpeg' or mimeType='audio/mp4' or mimeType='audio/x-m4a' or mimeType='audio/amr')`,
    fields: 'files(id, name, mimeType, size, createdTime, owners)',
    orderBy: 'createdTime desc',
    pageSize: 1000,
  });

  const files = (response.data.files || [])
    .map((f) => ({
      id: (f.id || '').toString(),
      name: (f.name || '').toString(),
      size: f.size as string | undefined,
      owners: (f.owners as Array<{ emailAddress?: string }> | undefined),
    }))
    .filter((f) => f.id && f.name);

  return files;
}

/**
 * List JSON metadata files in the configured Google Drive folder
 */
export async function listJsonFiles(): Promise<DriveFile[]> {
  const drive = getDriveInternal();
  const folderId = getFolderId();
  const response = await drive.files.list({
    q: `'${folderId}' in parents and trashed=false and mimeType='application/json'`,
    fields: 'files(id, name)',
    orderBy: 'createdTime desc',
    pageSize: 1000,
  });

  const files = (response.data.files || [])
    .map((f) => ({
      id: (f.id || '').toString(),
      name: (f.name || '').toString(),
    }))
    .filter((f) => f.id && f.name);

  return files;
}

/**
 * Get file by ID
 */
export async function getFile(fileId: string) {
  const drive = getDriveInternal();
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
  const drive = getDriveInternal();
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
  const drive = getDriveInternal();
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
