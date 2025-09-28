"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.JobStore = exports.JobSchema = void 0;
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const zod_1 = require("zod");
// Job schema matching the existing Reflex format for compatibility
exports.JobSchema = zod_1.z.object({
    id: zod_1.z.string(),
    url: zod_1.z.string(),
    resolved_url: zod_1.z.string().optional(),
    meeting_date: zod_1.z.string().optional(),
    status: zod_1.z.enum(['queued', 'resolving', 'downloading', 'transcribing', 'summarizing', 'completed', 'error']),
    title: zod_1.z.string().optional(),
    summary: zod_1.z.string().optional(),
    summary_path: zod_1.z.string().optional(),
    transcript_path: zod_1.z.string().optional(),
    file_path: zod_1.z.string().optional(),
    created_at: zod_1.z.number(),
    updated_at: zod_1.z.number(),
    error: zod_1.z.string().optional(),
    logs: zod_1.z.array(zod_1.z.string()).default([]),
    // Checkpoint data for recovery
    checkpoint: zod_1.z.object({
        step: zod_1.z.enum(['resolve', 'download', 'transcribe', 'summarize']).optional(),
        data: zod_1.z.any().optional(),
    }).optional(),
});
class JobStore {
    dataDir;
    jobsPath;
    queuePath;
    deadLetterPath;
    constructor(dataRoot = 'data') {
        this.dataDir = path_1.default.resolve(dataRoot);
        this.jobsPath = path_1.default.join(this.dataDir, 'jobs.json');
        this.queuePath = path_1.default.join(this.dataDir, 'queue.json');
        this.deadLetterPath = path_1.default.join(this.dataDir, 'dead_letter.json');
        // Ensure directories exist
        (0, fs_1.mkdirSync)(this.dataDir, { recursive: true });
        (0, fs_1.mkdirSync)(path_1.default.join(this.dataDir, 'files'), { recursive: true });
        (0, fs_1.mkdirSync)(path_1.default.join(this.dataDir, 'logs'), { recursive: true });
        (0, fs_1.mkdirSync)(path_1.default.join(this.dataDir, 'transcripts'), { recursive: true });
        (0, fs_1.mkdirSync)(path_1.default.join(this.dataDir, 'summaries'), { recursive: true });
    }
    /**
     * Load all jobs (atomic read with recovery)
     */
    getJobs() {
        try {
            if (!(0, fs_1.existsSync)(this.jobsPath)) {
                return [];
            }
            const data = (0, fs_1.readFileSync)(this.jobsPath, 'utf-8');
            const jobs = JSON.parse(data);
            return zod_1.z.array(exports.JobSchema).parse(jobs);
        }
        catch (error) {
            console.error('Failed to load jobs, backing up and recreating:', error);
            // Backup corrupt file
            if ((0, fs_1.existsSync)(this.jobsPath)) {
                const backupPath = `${this.jobsPath}.backup.${Date.now()}`;
                (0, fs_1.renameSync)(this.jobsPath, backupPath);
            }
            return [];
        }
    }
    /**
     * Save all jobs (atomic write with temp file)
     */
    saveJobs(jobs) {
        const tempPath = `${this.jobsPath}.tmp.${Date.now()}`;
        (0, fs_1.writeFileSync)(tempPath, JSON.stringify(jobs, null, 2));
        (0, fs_1.renameSync)(tempPath, this.jobsPath); // Atomic on most filesystems
    }
    /**
     * Get a specific job by ID
     */
    getJob(id) {
        const jobs = this.getJobs();
        return jobs.find(j => j.id === id);
    }
    /**
     * Create a new job
     */
    createJob(url, meetingDate) {
        const jobs = this.getJobs();
        const job = {
            id: `job_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
            url,
            meeting_date: meetingDate || new Date().toISOString().split('T')[0],
            status: 'queued',
            created_at: Date.now(),
            updated_at: Date.now(),
            logs: [`Job created at ${new Date().toISOString()}`],
        };
        jobs.push(job);
        this.saveJobs(jobs);
        this.enqueue(job.id);
        return job;
    }
    /**
     * Update an existing job
     */
    updateJob(id, updates) {
        const jobs = this.getJobs();
        const index = jobs.findIndex(j => j.id === id);
        if (index === -1)
            return undefined;
        jobs[index] = {
            ...jobs[index],
            ...updates,
            updated_at: Date.now(),
        };
        this.saveJobs(jobs);
        return jobs[index];
    }
    /**
     * Add log entry to a job
     */
    addLog(id, message) {
        const jobs = this.getJobs();
        const job = jobs.find(j => j.id === id);
        if (!job)
            return;
        job.logs.push(`[${new Date().toISOString()}] ${message}`);
        job.updated_at = Date.now();
        this.saveJobs(jobs);
        // Also save to log file
        const logPath = path_1.default.join(this.dataDir, 'logs', `${id}.log`);
        const logEntry = `[${new Date().toISOString()}] ${message}\n`;
        (0, fs_1.writeFileSync)(logPath, logEntry, { flag: 'a' });
    }
    /**
     * Delete a job and its artifacts
     */
    deleteJob(id) {
        const jobs = this.getJobs();
        const index = jobs.findIndex(j => j.id === id);
        if (index === -1)
            return false;
        const job = jobs[index];
        // Delete associated files
        const filesToDelete = [
            job.file_path,
            job.transcript_path,
            job.summary_path,
            path_1.default.join(this.dataDir, 'logs', `${id}.log`),
        ].filter(Boolean);
        for (const file of filesToDelete) {
            try {
                if ((0, fs_1.existsSync)(file)) {
                    (0, fs_1.unlinkSync)(file);
                }
            }
            catch (error) {
                console.error(`Failed to delete ${file}:`, error);
            }
        }
        // Remove from jobs array
        jobs.splice(index, 1);
        this.saveJobs(jobs);
        // Remove from queue if present
        this.dequeue(id);
        return true;
    }
    // Queue management
    /**
     * Get queued job IDs
     */
    getQueue() {
        try {
            if (!(0, fs_1.existsSync)(this.queuePath)) {
                return [];
            }
            const data = (0, fs_1.readFileSync)(this.queuePath, 'utf-8');
            return JSON.parse(data);
        }
        catch {
            return [];
        }
    }
    /**
     * Save queue state
     */
    saveQueue(queue) {
        const tempPath = `${this.queuePath}.tmp.${Date.now()}`;
        (0, fs_1.writeFileSync)(tempPath, JSON.stringify(queue, null, 2));
        (0, fs_1.renameSync)(tempPath, this.queuePath);
    }
    /**
     * Add job to queue
     */
    enqueue(jobId) {
        const queue = this.getQueue();
        if (!queue.includes(jobId)) {
            queue.push(jobId);
            this.saveQueue(queue);
        }
    }
    /**
     * Remove job from queue
     */
    dequeue(jobId) {
        const queue = this.getQueue();
        const filtered = queue.filter(id => id !== jobId);
        if (filtered.length !== queue.length) {
            this.saveQueue(filtered);
        }
    }
    /**
     * Get next job to process
     */
    getNextJob() {
        const queue = this.getQueue();
        if (queue.length === 0)
            return undefined;
        const jobId = queue[0];
        const job = this.getJob(jobId);
        if (!job) {
            // Job doesn't exist, remove from queue
            this.dequeue(jobId);
            return this.getNextJob();
        }
        // Check if job is stale or in error state
        if (job.status === 'error' || job.status === 'completed') {
            this.dequeue(jobId);
            return this.getNextJob();
        }
        return job;
    }
    /**
     * Move job to dead letter queue
     */
    moveToDeadLetter(jobId, reason) {
        const deadLetter = this.getDeadLetter();
        const job = this.getJob(jobId);
        if (!job)
            return;
        deadLetter.push({
            job,
            failedAt: Date.now(),
            reason,
            retryCount: deadLetter.filter(d => d.job.id === jobId).length + 1,
        });
        this.saveDeadLetter(deadLetter);
        this.dequeue(jobId);
        this.updateJob(jobId, { status: 'error', error: reason });
    }
    getDeadLetter() {
        try {
            if (!(0, fs_1.existsSync)(this.deadLetterPath)) {
                return [];
            }
            const data = (0, fs_1.readFileSync)(this.deadLetterPath, 'utf-8');
            return JSON.parse(data);
        }
        catch {
            return [];
        }
    }
    saveDeadLetter(deadLetter) {
        const tempPath = `${this.deadLetterPath}.tmp.${Date.now()}`;
        (0, fs_1.writeFileSync)(tempPath, JSON.stringify(deadLetter, null, 2));
        (0, fs_1.renameSync)(tempPath, this.deadLetterPath);
    }
}
exports.JobStore = JobStore;
