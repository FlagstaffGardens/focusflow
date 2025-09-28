import { z } from 'zod';
export declare const JobSchema: z.ZodObject<{
    id: z.ZodString;
    url: z.ZodString;
    resolved_url: z.ZodOptional<z.ZodString>;
    meeting_date: z.ZodOptional<z.ZodString>;
    status: z.ZodEnum<["queued", "resolving", "downloading", "transcribing", "summarizing", "completed", "error"]>;
    title: z.ZodOptional<z.ZodString>;
    summary: z.ZodOptional<z.ZodString>;
    summary_path: z.ZodOptional<z.ZodString>;
    transcript_path: z.ZodOptional<z.ZodString>;
    file_path: z.ZodOptional<z.ZodString>;
    created_at: z.ZodNumber;
    updated_at: z.ZodNumber;
    error: z.ZodOptional<z.ZodString>;
    logs: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    checkpoint: z.ZodOptional<z.ZodObject<{
        step: z.ZodOptional<z.ZodEnum<["resolve", "download", "transcribe", "summarize"]>>;
        data: z.ZodOptional<z.ZodAny>;
    }, "strip", z.ZodTypeAny, {
        step?: "resolve" | "download" | "transcribe" | "summarize" | undefined;
        data?: any;
    }, {
        step?: "resolve" | "download" | "transcribe" | "summarize" | undefined;
        data?: any;
    }>>;
}, "strip", z.ZodTypeAny, {
    id: string;
    url: string;
    status: "queued" | "resolving" | "downloading" | "transcribing" | "summarizing" | "completed" | "error";
    created_at: number;
    updated_at: number;
    logs: string[];
    resolved_url?: string | undefined;
    meeting_date?: string | undefined;
    error?: string | undefined;
    title?: string | undefined;
    summary?: string | undefined;
    summary_path?: string | undefined;
    transcript_path?: string | undefined;
    file_path?: string | undefined;
    checkpoint?: {
        step?: "resolve" | "download" | "transcribe" | "summarize" | undefined;
        data?: any;
    } | undefined;
}, {
    id: string;
    url: string;
    status: "queued" | "resolving" | "downloading" | "transcribing" | "summarizing" | "completed" | "error";
    created_at: number;
    updated_at: number;
    resolved_url?: string | undefined;
    meeting_date?: string | undefined;
    error?: string | undefined;
    title?: string | undefined;
    summary?: string | undefined;
    summary_path?: string | undefined;
    transcript_path?: string | undefined;
    file_path?: string | undefined;
    logs?: string[] | undefined;
    checkpoint?: {
        step?: "resolve" | "download" | "transcribe" | "summarize" | undefined;
        data?: any;
    } | undefined;
}>;
export type Job = z.infer<typeof JobSchema>;
export declare class JobStore {
    private dataDir;
    private jobsPath;
    private queuePath;
    private deadLetterPath;
    constructor(dataRoot?: string);
    /**
     * Load all jobs (atomic read with recovery)
     */
    getJobs(): Job[];
    /**
     * Save all jobs (atomic write with temp file)
     */
    private saveJobs;
    /**
     * Get a specific job by ID
     */
    getJob(id: string): Job | undefined;
    /**
     * Create a new job
     */
    createJob(url: string, meetingDate?: string): Job;
    /**
     * Update an existing job
     */
    updateJob(id: string, updates: Partial<Job>): Job | undefined;
    /**
     * Add log entry to a job
     */
    addLog(id: string, message: string): void;
    /**
     * Delete a job and its artifacts
     */
    deleteJob(id: string): boolean;
    /**
     * Get queued job IDs
     */
    private getQueue;
    /**
     * Save queue state
     */
    private saveQueue;
    /**
     * Add job to queue
     */
    enqueue(jobId: string): void;
    /**
     * Remove job from queue
     */
    dequeue(jobId: string): void;
    /**
     * Get next job to process
     */
    getNextJob(): Job | undefined;
    /**
     * Move job to dead letter queue
     */
    moveToDeadLetter(jobId: string, reason: string): void;
    private getDeadLetter;
    private saveDeadLetter;
}
