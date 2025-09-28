"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.transcribeWithAssemblyAI = transcribeWithAssemblyAI;
const undici_1 = require("undici");
const fs_1 = require("fs");
const BASE_URL = 'https://api.assemblyai.com/v2';
async function transcribeWithAssemblyAI(filePath, apiKey, log) {
    if (!apiKey) {
        log('ASSEMBLYAI_API_KEY not set → skipping transcription');
        return null;
    }
    const headers = {
        authorization: apiKey,
    };
    // Upload file
    log('Uploading to AssemblyAI...');
    const fileStream = (0, fs_1.createReadStream)(filePath);
    const uploadResponse = await (0, undici_1.fetch)(`${BASE_URL}/upload`, {
        method: 'POST',
        headers,
        body: fileStream,
        duplex: 'half',
    });
    if (!uploadResponse.ok) {
        throw new Error(`Upload failed: ${uploadResponse.status}`);
    }
    const { upload_url } = await uploadResponse.json();
    // Create transcription job with speaker diarization
    log('Creating transcript job with speaker diarization...');
    const transcriptResponse = await (0, undici_1.fetch)(`${BASE_URL}/transcript`, {
        method: 'POST',
        headers: {
            ...headers,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            audio_url: upload_url,
            speaker_labels: true,
            format_text: true,
        }),
    });
    if (!transcriptResponse.ok) {
        throw new Error(`Transcript creation failed: ${transcriptResponse.status}`);
    }
    const { id } = await transcriptResponse.json();
    // Poll for completion
    log(`Transcript ID: ${id} - processing...`);
    let status = 'processing';
    let result;
    while (status === 'processing' || status === 'queued') {
        await new Promise(resolve => setTimeout(resolve, 2000));
        const pollResponse = await (0, undici_1.fetch)(`${BASE_URL}/transcript/${id}`, {
            headers,
        });
        if (!pollResponse.ok) {
            throw new Error(`Poll failed: ${pollResponse.status}`);
        }
        result = await pollResponse.json();
        status = result.status;
        if (status === 'processing' || status === 'queued') {
            log(`Transcript status: ${status}...`);
        }
    }
    if (status === 'error') {
        throw new Error(`Transcription failed: ${result.error}`);
    }
    log('Transcription complete');
    // Format transcript with speaker labels
    if (result.utterances && result.utterances.length > 0) {
        const formatted = formatTranscriptWithSpeakers(result.utterances);
        return {
            text: formatted,
            utterances: result.utterances,
        };
    }
    return {
        text: result.text || '',
        utterances: [],
    };
}
function formatTranscriptWithSpeakers(utterances) {
    let formatted = '';
    let lastSpeaker = '';
    for (const utterance of utterances) {
        if (utterance.speaker !== lastSpeaker) {
            if (formatted)
                formatted += '\n\n';
            formatted += `[Speaker ${utterance.speaker}]:\n`;
            lastSpeaker = utterance.speaker;
        }
        formatted += `${utterance.text}\n`;
    }
    return formatted;
}
