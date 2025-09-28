"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.summarizeWithGPT = summarizeWithGPT;
exports.generateTitle = generateTitle;
const undici_1 = require("undici");
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
/**
 * Summarize transcript using OpenAI-compatible API
 * Uses /openai/v1/responses endpoint with streaming
 * Following the contract in doc/ai_endpoints.md
 */
async function* summarizeWithGPT(transcript, meetingDate, config, log) {
    const { apiKey, baseUrl = 'https://api.openai.com', model = 'gpt-4' } = config;
    if (!apiKey) {
        log('OPENAI_API_KEY not set → skipping summarization');
        return '';
    }
    // Load and render prompt template
    const promptTemplate = loadPromptTemplate();
    const renderedPrompt = promptTemplate
        .replace('{{transcript}}', transcript)
        .replace('{{meeting_date}}', meetingDate);
    log('Calling GPT for summary...');
    const response = await (0, undici_1.fetch)(`${baseUrl}/v1/responses`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model,
            input: [
                {
                    type: 'message',
                    role: 'user',
                    content: `You are an expert meeting analyst and technical program manager. Produce clear, executive-ready meeting summaries.\n\n${renderedPrompt}`,
                },
            ],
            temperature: 0.2,
            stream: true,
        }),
    });
    if (!response.ok) {
        const error = await response.text();
        log(`GPT API error: ${response.status} - ${error.slice(0, 200)}`);
        throw new Error(`GPT API failed: ${response.status}`);
    }
    // Process streaming response (Codex-style format)
    let fullText = '';
    const decoder = new TextDecoder();
    const reader = response.body?.getReader();
    if (!reader) {
        throw new Error('No response body');
    }
    let buffer = '';
    while (true) {
        const { done, value } = await reader.read();
        if (done)
            break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
            if (line.startsWith('data: ')) {
                const data = line.slice(6).trim();
                if (!data || data === '[DONE]') {
                    continue;
                }
                try {
                    const event = JSON.parse(data);
                    // Look for Codex-style output text events
                    if (event.type === 'response.output_text.delta') {
                        const text = event.text;
                        if (text) {
                            fullText += text;
                            yield text;
                        }
                    }
                    else if (event.type === 'response.output_text.done') {
                        // Final text output
                        const text = event.text;
                        if (text && !fullText.includes(text)) {
                            fullText = text;
                            yield text;
                        }
                    }
                    else if (event.type === 'response.content_part.delta') {
                        // Alternative delta format
                        const text = event.part?.text;
                        if (text) {
                            fullText += text;
                            yield text;
                        }
                    }
                }
                catch (e) {
                    // Skip invalid JSON chunks
                }
            }
        }
    }
    log('Summary generation complete');
    return fullText;
}
function loadPromptTemplate() {
    try {
        const promptPath = process.env.PROMPT_PATH || 'prompts/meeting_summary.md';
        const absolutePath = path_1.default.resolve(process.cwd(), promptPath);
        return (0, fs_1.readFileSync)(absolutePath, 'utf-8');
    }
    catch (error) {
        console.error('Failed to load prompt template:', error);
        return `# Meeting Summary Request

## Transcript
{{transcript}}

## Meeting Date
{{meeting_date}}

Please provide a comprehensive summary of this meeting including:
- Executive summary
- Key discussion points
- Decisions made
- Action items with owners and due dates
- Open questions
- Next steps`;
    }
}
/**
 * Generate a title for the meeting based on the summary
 */
async function generateTitle(summary, config, log) {
    const { apiKey, baseUrl = 'https://api.openai.com', model = 'gpt-4' } = config;
    if (!apiKey) {
        return extractTitleFromSummary(summary);
    }
    try {
        const response = await (0, undici_1.fetch)(`${baseUrl}/v1/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model,
                messages: [
                    {
                        role: 'user',
                        content: `Generate a concise meeting title (max 60 chars) based on the summary:\n\n${summary.slice(0, 1000)}`,
                    },
                ],
                temperature: 0.2,
                max_tokens: 20,
            }),
        });
        if (response.ok) {
            const data = await response.json();
            const title = data.choices?.[0]?.message?.content?.trim();
            if (title) {
                log(`Generated title: ${title}`);
                return title;
            }
        }
    }
    catch (error) {
        log(`Title generation failed: ${error}`);
    }
    return extractTitleFromSummary(summary);
}
function extractTitleFromSummary(summary) {
    // Extract first heading or first line as fallback
    const headingMatch = summary.match(/^#+\s+(.+)$/m);
    if (headingMatch) {
        return headingMatch[1].slice(0, 60);
    }
    const firstLine = summary.split('\n')[0];
    return firstLine.slice(0, 60) || 'Untitled Meeting';
}
