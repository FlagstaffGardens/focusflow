/*
  Lists files in the configured Google Drive folder and prints a concise summary
  Requires env vars:
    - GOOGLE_SERVICE_ACCOUNT_KEY: JSON string or path to JSON
    - GOOGLE_DRIVE_FOLDER_ID: ID of the Drive folder to scan
    - ALLOWED_USERS: comma-separated owner emails allowed (optional)
*/
require('dotenv').config();
const { google } = require('googleapis');
const { JWT } = require('google-auth-library');
const fs = require('fs');
const path = require('path');

function requireEnv(name) {
  const val = process.env[name];
  if (!val || !val.trim()) throw new Error(`${name} is required`);
  return val.trim();
}

function loadServiceAccountKey() {
  const raw = requireEnv('GOOGLE_SERVICE_ACCOUNT_KEY');
  if (raw.startsWith('{')) return JSON.parse(raw);
  const candidatePaths = [raw, path.resolve(process.cwd(), raw)];
  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    }
  }
  throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY must be JSON or a file path');
}

function isCubeACRFile(filename) {
  const audioExtensions = /\.(m4a|amr|mp3|wav)$/i;
  const cubePattern = /^\d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2} \((phone|whatsapp|mic)\)/;
  return audioExtensions.test(filename) && cubePattern.test(filename);
}

async function listAllFiles(drive, folderId) {
  let pageToken = undefined;
  const files = [];
  do {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed=false`,
      fields: 'nextPageToken, files(id, name, mimeType, size, createdTime, owners(emailAddress))',
      orderBy: 'createdTime desc',
      pageSize: 1000,
      pageToken,
    });
    files.push(...(res.data.files || []));
    pageToken = res.data.nextPageToken || undefined;
  } while (pageToken);
  return files;
}

function summarize(files) {
  const byMime = new Map();
  const byExt = new Map();
  const byOwner = new Map();
  let cubePatternCount = 0;
  let notCubePattern = 0;

  for (const f of files) {
    byMime.set(f.mimeType, (byMime.get(f.mimeType) || 0) + 1);
    const ext = (f.name.match(/\.[^.]+$/) || [''])[0].toLowerCase();
    byExt.set(ext, (byExt.get(ext) || 0) + 1);
    const owner = (f.owners && f.owners[0] && f.owners[0].emailAddress) || 'unknown';
    byOwner.set(owner, (byOwner.get(owner) || 0) + 1);
    if (isCubeACRFile(f.name)) cubePatternCount++; else notCubePattern++;
  }

  return { byMime, byExt, byOwner, cubePatternCount, notCubePattern };
}

function formatMap(map) {
  return Array.from(map.entries())
    .sort((a,b) => b[1]-a[1])
    .map(([k,v]) => `  - ${k || '(none)'}: ${v}`)
    .join('\n');
}

async function main() {
  const { client_email, private_key } = loadServiceAccountKey();
  const folderId = requireEnv('GOOGLE_DRIVE_FOLDER_ID');
  const allowed = (process.env.ALLOWED_USERS || '').split(',').map(s => s.trim()).filter(Boolean);
  const auth = new JWT({ email: client_email, key: private_key, scopes: ['https://www.googleapis.com/auth/drive.readonly'] });
  const drive = google.drive({ version: 'v3', auth });

  console.log('Listing files in Drive folder:', folderId);
  const files = await listAllFiles(drive, folderId);
  console.log(`Total files: ${files.length}`);

  const { byMime, byExt, byOwner, cubePatternCount, notCubePattern } = summarize(files);

  console.log('\nBy MIME type:\n' + formatMap(byMime));
  console.log('\nBy extension:\n' + formatMap(byExt));
  console.log('\nBy owner:\n' + formatMap(byOwner));
  console.log(`\nCube ACR filename pattern: ${cubePatternCount} matching, ${notCubePattern} non-matching`);

  // List the most relevant items for review: non-matching audio/video files
  const interesting = files.filter(f => {
    const isAudioVideo = (f.mimeType || '').startsWith('audio/') || (f.mimeType || '').startsWith('video/') || /\.(m4a|amr|mp3|wav|mp4)$/i.test(f.name);
    return isAudioVideo && !isCubeACRFile(f.name);
  }).slice(0, 50);

  if (interesting.length) {
    console.log(`\nSample of audio/video files not matching Cube ACR pattern (${interesting.length} shown):`);
    for (const f of interesting) {
      const owner = (f.owners && f.owners[0] && f.owners[0].emailAddress) || 'unknown';
      console.log(`  - ${f.name} | ${f.mimeType} | owner=${owner} | id=${f.id}`);
    }
  }

  if (allowed.length) {
    const disallowed = files.filter(f => {
      const owner = (f.owners && f.owners[0] && f.owners[0].emailAddress) || '';
      return owner && !allowed.includes(owner);
    });
    console.log(`\nFiles with owners not in ALLOWED_USERS (${disallowed.length}):`);
    for (const f of disallowed.slice(0, 50)) {
      const owner = (f.owners && f.owners[0] && f.owners[0].emailAddress) || 'unknown';
      console.log(`  - ${f.name} | owner=${owner} | id=${f.id}`);
    }
  }
}

main().catch(err => {
  console.error('Error listing Drive files:', err.message || err);
  process.exit(1);
});
