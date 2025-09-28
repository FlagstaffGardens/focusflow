import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, renameSync } from 'fs'
import path from 'path'
import { z } from 'zod'

// Job schema matching the existing Reflex format for compatibility
export const JobSchema = z.object({
  id: z.string(),
  url: z.string(),
  resolved_url: z.string().optional(),
  meeting_date: z.string().optional(),
  status: z.enum(['queued', 'resolving', 'downloading', 'transcribing', 'summarizing', 'completed', 'error']),
  title: z.string().optional(),
  summary: z.string().optional(),
  summary_path: z.string().optional(),
  transcript_path: z.string().optional(),
  file_path: z.string().optional(),
  created_at: z.number(),
  updated_at: z.number(),
  error: z.string().optional(),
  logs: z.array(z.string()).default([]),
  // Checkpoint data for recovery
  checkpoint: z.object({
    step: z.enum(['resolve', 'download', 'transcribe', 'summarize']).optional(),
    data: z.any().optional(),
  }).optional(),
})

export type Job = z.infer<typeof JobSchema>

export class JobStore {
  private dataDir: string
  private jobsPath: string
  private queuePath: string
  private deadLetterPath: string

  constructor(dataRoot: string = 'data') {
    this.dataDir = path.resolve(dataRoot)
    this.jobsPath = path.join(this.dataDir, 'jobs.json')
    this.queuePath = path.join(this.dataDir, 'queue.json')
    this.deadLetterPath = path.join(this.dataDir, 'dead_letter.json')

    // Ensure directories exist
    mkdirSync(this.dataDir, { recursive: true })
    mkdirSync(path.join(this.dataDir, 'files'), { recursive: true })
    mkdirSync(path.join(this.dataDir, 'logs'), { recursive: true })
    mkdirSync(path.join(this.dataDir, 'transcripts'), { recursive: true })
    mkdirSync(path.join(this.dataDir, 'summaries'), { recursive: true })
  }

  /**
   * Load all jobs (atomic read with recovery)
   */
  getJobs(): Job[] {
    try {
      if (!existsSync(this.jobsPath)) {
        return []
      }
      const data = readFileSync(this.jobsPath, 'utf-8')
      const jobs = JSON.parse(data)
      return z.array(JobSchema).parse(jobs)
    } catch (error) {
      console.error('Failed to load jobs, backing up and recreating:', error)
      // Backup corrupt file
      if (existsSync(this.jobsPath)) {
        const backupPath = `${this.jobsPath}.backup.${Date.now()}`
        renameSync(this.jobsPath, backupPath)
      }
      return []
    }
  }

  /**
   * Save all jobs (atomic write with temp file)
   */
  private saveJobs(jobs: Job[]): void {
    const tempPath = `${this.jobsPath}.tmp.${Date.now()}`
    writeFileSync(tempPath, JSON.stringify(jobs, null, 2))
    renameSync(tempPath, this.jobsPath) // Atomic on most filesystems
  }

  /**
   * Get a specific job by ID
   */
  getJob(id: string): Job | undefined {
    const jobs = this.getJobs()
    return jobs.find(j => j.id === id)
  }

  /**
   * Create a new job
   */
  createJob(url: string, meetingDate?: string): Job {
    const jobs = this.getJobs()
    const job: Job = {
      id: `job_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      url,
      meeting_date: meetingDate || new Date().toISOString().split('T')[0],
      status: 'queued',
      created_at: Date.now(),
      updated_at: Date.now(),
      logs: [`Job created at ${new Date().toISOString()}`],
    }
    jobs.push(job)
    this.saveJobs(jobs)
    this.enqueue(job.id)
    return job
  }

  /**
   * Update an existing job
   */
  updateJob(id: string, updates: Partial<Job>): Job | undefined {
    const jobs = this.getJobs()
    const index = jobs.findIndex(j => j.id === id)
    if (index === -1) return undefined

    jobs[index] = {
      ...jobs[index],
      ...updates,
      updated_at: Date.now(),
    }
    this.saveJobs(jobs)
    return jobs[index]
  }

  /**
   * Add log entry to a job
   */
  addLog(id: string, message: string): void {
    const jobs = this.getJobs()
    const job = jobs.find(j => j.id === id)
    if (!job) return

    job.logs.push(`[${new Date().toISOString()}] ${message}`)
    job.updated_at = Date.now()
    this.saveJobs(jobs)

    // Also save to log file
    const logPath = path.join(this.dataDir, 'logs', `${id}.log`)
    const logEntry = `[${new Date().toISOString()}] ${message}\n`
    writeFileSync(logPath, logEntry, { flag: 'a' })
  }

  /**
   * Delete a job and its artifacts
   */
  deleteJob(id: string): boolean {
    const jobs = this.getJobs()
    const index = jobs.findIndex(j => j.id === id)
    if (index === -1) return false

    const job = jobs[index]

    // Delete associated files
    const filesToDelete = [
      job.file_path,
      job.transcript_path,
      job.summary_path,
      path.join(this.dataDir, 'logs', `${id}.log`),
    ].filter(Boolean) as string[]

    for (const file of filesToDelete) {
      try {
        if (existsSync(file)) {
          unlinkSync(file)
        }
      } catch (error) {
        console.error(`Failed to delete ${file}:`, error)
      }
    }

    // Remove from jobs array
    jobs.splice(index, 1)
    this.saveJobs(jobs)

    // Remove from queue if present
    this.dequeue(id)

    return true
  }

  // Queue management

  /**
   * Get queued job IDs
   */
  private getQueue(): string[] {
    try {
      if (!existsSync(this.queuePath)) {
        return []
      }
      const data = readFileSync(this.queuePath, 'utf-8')
      return JSON.parse(data)
    } catch {
      return []
    }
  }

  /**
   * Save queue state
   */
  private saveQueue(queue: string[]): void {
    const tempPath = `${this.queuePath}.tmp.${Date.now()}`
    writeFileSync(tempPath, JSON.stringify(queue, null, 2))
    renameSync(tempPath, this.queuePath)
  }

  /**
   * Add job to queue
   */
  enqueue(jobId: string): void {
    const queue = this.getQueue()
    if (!queue.includes(jobId)) {
      queue.push(jobId)
      this.saveQueue(queue)
    }
  }

  /**
   * Remove job from queue
   */
  dequeue(jobId: string): void {
    const queue = this.getQueue()
    const filtered = queue.filter(id => id !== jobId)
    if (filtered.length !== queue.length) {
      this.saveQueue(filtered)
    }
  }

  /**
   * Get next job to process
   */
  getNextJob(): Job | undefined {
    const queue = this.getQueue()
    if (queue.length === 0) return undefined

    const jobId = queue[0]
    const job = this.getJob(jobId)

    if (!job) {
      // Job doesn't exist, remove from queue
      this.dequeue(jobId)
      return this.getNextJob()
    }

    // Check if job is stale or in error state
    if (job.status === 'error' || job.status === 'completed') {
      this.dequeue(jobId)
      return this.getNextJob()
    }

    return job
  }

  /**
   * Move job to dead letter queue
   */
  moveToDeadLetter(jobId: string, reason: string): void {
    const deadLetter = this.getDeadLetter()
    const job = this.getJob(jobId)
    if (!job) return

    deadLetter.push({
      job,
      failedAt: Date.now(),
      reason,
      retryCount: deadLetter.filter(d => d.job.id === jobId).length + 1,
    })

    this.saveDeadLetter(deadLetter)
    this.dequeue(jobId)
    this.updateJob(jobId, { status: 'error', error: reason })
  }

  private getDeadLetter(): Array<{ job: Job; failedAt: number; reason: string; retryCount: number }> {
    try {
      if (!existsSync(this.deadLetterPath)) {
        return []
      }
      const data = readFileSync(this.deadLetterPath, 'utf-8')
      return JSON.parse(data)
    } catch {
      return []
    }
  }

  private saveDeadLetter(deadLetter: any[]): void {
    const tempPath = `${this.deadLetterPath}.tmp.${Date.now()}`
    writeFileSync(tempPath, JSON.stringify(deadLetter, null, 2))
    renameSync(tempPath, this.deadLetterPath)
  }
}