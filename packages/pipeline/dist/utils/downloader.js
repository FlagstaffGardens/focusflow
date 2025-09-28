"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.downloadAudioFile = downloadAudioFile;
const undici_1 = require("undici");
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
async function downloadAudioFile(url, outputPath, log) {
    log('Downloading audio...');
    const response = await (0, undici_1.fetch)(url, {
        headers: { 'User-Agent': 'FocusFlow/2.0 (Next.js)' },
    });
    if (!response.ok) {
        throw new Error(`Download failed: ${response.status} ${response.statusText}`);
    }
    const contentType = response.headers.get('content-type') || '';
    const contentLength = response.headers.get('content-length');
    const total = contentLength ? parseInt(contentLength, 10) : 0;
    // Validate content type
    if (!contentType.includes('audio') &&
        !contentType.includes('octet-stream') &&
        !url.match(/\.(mp3|m4a|wav)$/i)) {
        throw new Error(`URL did not resolve to audio content (got '${contentType}')`);
    }
    // Determine file extension
    let ext = path_1.default.extname(new URL(url).pathname) || '.mp3';
    if (!ext.match(/^\.(mp3|m4a|wav)$/i)) {
        if (contentType.includes('mp4') || contentType.includes('m4a')) {
            ext = '.m4a';
        }
        else if (contentType.includes('wav')) {
            ext = '.wav';
        }
        else {
            ext = '.mp3';
        }
    }
    const finalPath = outputPath.replace(/\.[^.]+$/, '') + ext;
    const writeStream = (0, fs_1.createWriteStream)(finalPath);
    let bytesDownloaded = 0;
    let lastEmit = Date.now();
    // Create a transform stream to track progress
    const body = response.body;
    const reader = body.getReader();
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            writeStream.write(value);
            bytesDownloaded += value.length;
            const now = Date.now();
            if (now - lastEmit > 100) { // Emit every 100ms
                lastEmit = now;
                const pct = total ? (bytesDownloaded / total * 100).toFixed(1) : 0;
                log(`Download: ${bytesDownloaded}/${total || '?'} bytes (${pct}%)`);
            }
        }
    }
    finally {
        writeStream.end();
    }
    log(`Download complete: ${finalPath}`);
    return finalPath;
}
