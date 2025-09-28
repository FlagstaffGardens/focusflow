"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolvePlaudAudioUrl = resolvePlaudAudioUrl;
const undici_1 = require("undici");
/**
 * Resolve a Plaud share URL to a direct audio URL
 * Tries multiple strategies in order:
 * 1. temp_url API
 * 2. share-content API
 * 3. HTML page parsing
 * 4. Returns original URL as fallback
 */
async function resolvePlaudAudioUrl(url, log) {
    if (!url.includes('plaud.ai')) {
        return url;
    }
    log('Resolving Plaud link...');
    // Extract token from URL
    const tokenMatch = url.match(/\/share\/([0-9a-zA-Z]+)/);
    const token = tokenMatch?.[1];
    if (token) {
        // Try temp API first
        try {
            const tempUrl = `https://api.plaud.ai/file/share-file-temp/${token}`;
            const response = await (0, undici_1.fetch)(tempUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0' },
            });
            if (response.ok) {
                const text = await response.text();
                // Try to parse as JSON
                try {
                    const data = JSON.parse(text);
                    const keys = ['temp_url', 'url', 'fileUrl', 'audioUrl', 'downloadUrl'];
                    for (const key of keys) {
                        const val = data[key];
                        if (typeof val === 'string' && val.startsWith('http')) {
                            log(`Plaud API resolved (temp) → ${val}`);
                            return val;
                        }
                    }
                }
                catch {
                    // Not JSON, try regex
                    const match = text.match(/https?:\/\/[^"'\s]+\.(?:mp3|m4a|wav)(?:\?[^"'\s]*)?/);
                    if (match) {
                        log(`Plaud API resolved (regex) → ${match[0]}`);
                        return match[0];
                    }
                }
            }
        }
        catch (error) {
            log(`Plaud temp API failed: ${error}`);
        }
        // Try content API
        try {
            const contentUrl = `https://api.plaud.ai/file/share-content/${token}`;
            const response = await (0, undici_1.fetch)(contentUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0' },
            });
            if (response.ok) {
                const data = await response.json();
                const content = data.data || data;
                const keys = ['fileUrl', 'audioUrl', 'url'];
                for (const key of keys) {
                    if (content[key] && typeof content[key] === 'string') {
                        log(`Plaud content API resolved → ${content[key]}`);
                        return content[key];
                    }
                }
            }
        }
        catch (error) {
            log(`Plaud content API failed: ${error}`);
        }
    }
    // Fallback: parse HTML page
    try {
        const response = await (0, undici_1.fetch)(url, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
        });
        if (response.ok) {
            const html = await response.text();
            // Look for direct audio links
            const audioLinks = html.matchAll(/https?:\/\/[^'"\s]+\.(?:mp3|m4a|wav)\b/gi);
            for (const match of audioLinks) {
                log(`Plaud resolved (html) → ${match[0]}`);
                return match[0];
            }
            // Look for __NEXT_DATA__ JSON
            const nextDataMatch = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/si);
            if (nextDataMatch) {
                try {
                    const data = JSON.parse(nextDataMatch[1]);
                    const audioUrl = findAudioUrlInObject(data);
                    if (audioUrl) {
                        log(`Plaud resolved (next) → ${audioUrl}`);
                        return audioUrl;
                    }
                }
                catch {
                    // Ignore JSON parse errors
                }
            }
            // Look for JSON audio URLs in HTML
            const jsonUrls = html.matchAll(/"(audioUrl|audio_url|url|source|src)"\s*:\s*"(https?:\/\/[^"]+)"/gi);
            for (const [, , candidate] of jsonUrls) {
                const url = candidate.replace(/\\u002F/g, '/');
                if (/\.(mp3|m4a|wav)$/i.test(url)) {
                    log(`Plaud resolved (json) → ${url}`);
                    return url;
                }
            }
        }
    }
    catch (error) {
        log(`Plaud resolution error: ${error}; using original URL`);
        return url;
    }
    log('Plaud resolution failed; using original URL');
    return url;
}
function findAudioUrlInObject(obj) {
    if (typeof obj === 'string') {
        const decoded = obj.replace(/\\u002F/g, '/');
        if (/^https?:\/\/.*\.(mp3|m4a|wav)(\?.*)?$/i.test(decoded)) {
            return decoded;
        }
    }
    else if (Array.isArray(obj)) {
        for (const item of obj) {
            const result = findAudioUrlInObject(item);
            if (result)
                return result;
        }
    }
    else if (obj && typeof obj === 'object') {
        for (const value of Object.values(obj)) {
            const result = findAudioUrlInObject(value);
            if (result)
                return result;
        }
    }
    return null;
}
