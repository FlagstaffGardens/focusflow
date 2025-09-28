import { LogFunction } from '../plaud/resolver';
export interface TranscriptResult {
    text: string;
    utterances?: Array<{
        speaker: string;
        text: string;
        start: number;
        end: number;
    }>;
}
export declare function transcribeWithAssemblyAI(filePath: string, apiKey: string, log: LogFunction): Promise<TranscriptResult | null>;
