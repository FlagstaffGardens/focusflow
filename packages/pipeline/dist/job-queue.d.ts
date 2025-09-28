import { JobStore, Job } from './storage/job-store';
import { OpenAIConfig } from './openai/client';
export interface JobQueueConfig {
    dataDir?: string;
    assemblyAiApiKey?: string;
    openAiConfig?: OpenAIConfig;
    jobTimeout?: number;
}
/**
 * Simple in-process job queue
 * Following Option B from the spec for MVP simplicity
 */
export declare class SimpleJobQueue {
    private processing;
    private store;
    private config;
    private currentJob;
    private jobStartTime;
    constructor(config?: JobQueueConfig);
    /**
     * Create and enqueue a new job
     */
    enqueue(url: string, meetingDate?: string): Promise<Job>;
    /**
     * Process jobs from the queue
     */
    private process;
    /**
     * Run a single job through the pipeline
     */
    private runJob;
    /**
     * Check if current job has timed out
     */
    private checkTimeout;
    private isTimedOut;
    private getRetryCount;
    /**
     * Retry a failed job
     */
    retryJob(jobId: string, fullRerun?: boolean): Promise<void>;
    /**
     * Regenerate summary only
     */
    regenerateSummary(jobId: string): Promise<void>;
    /**
     * Get job store for direct access
     */
    getStore(): JobStore;
}
