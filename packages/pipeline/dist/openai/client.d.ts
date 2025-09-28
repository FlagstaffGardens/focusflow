import { LogFunction } from '../plaud/resolver';
export interface OpenAIConfig {
    apiKey: string;
    baseUrl?: string;
    model?: string;
}
/**
 * Summarize transcript using OpenAI-compatible API
 * Uses /openai/v1/responses endpoint with streaming
 * Following the contract in doc/ai_endpoints.md
 */
export declare function summarizeWithGPT(transcript: string, meetingDate: string, config: OpenAIConfig, log: LogFunction): AsyncGenerator<string, string, unknown>;
/**
 * Generate a title for the meeting based on the summary
 */
export declare function generateTitle(summary: string, config: OpenAIConfig, log: LogFunction): Promise<string>;
