import { promises as fs } from 'fs'
import { constants as fsConstants } from 'fs'
import path from 'path'
import { z } from 'zod'

// Job schema matching the legacy Reflex format for compatibility
export const JobSchema = z.object({
  id: z.string(),
  url: z.string(),
  resolved_url: z.string().optional(),
  meeting_date: z.string().optional(),
  status: z.enum([
    'queued',
    'resolving',
    'downloading',
    'transcribing',
    'summarizing',
    'completed',
    'error',
  ]),
  title: z.string().optional(),
  summary: z.string().optional(),
  summary_path: z.string().optional(),
  transcript_path: z.string().optional(),
  file_path: z.string().optional(),
  created_at: z.number(),
  updated_at: z.number(),
  error: z.string().optional(),
  logs: z.array(z.string()).default([]),
  checkpoint: z
    .object({
      step: z.enum(['resolve', 'download', 'transcribe', 'summarize']).optional(),
      data: z.any().optional(),
    })
    .optional(),
})

export type Job = z.infer<typeof JobSchema>

interface DeadLetterEntry {
  job: Job
  failedAt: number
  reason: string
  retryCount: number
}

class Mutex {
  private queue: Array<() => void> = []
  private locked = false

  async runExclusive<T>(fn: () => Promise<T> | T): Promise<T> {
    await this.acquire()
    try {
      return await fn()
    } finally {
      this.release()
    }
  }

  private acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true
      return Promise.resolve()
    }

    return new Promise(resolve => {
      this.queue.push(resolve)
    })
  }

  private release(): void {
    const resolve = this.queue.shift()
    if (resolve) {
      resolve()
    } else {
      this.locked = false
    }
  }
}

export class JobStore {
  private readonly dataDir: string
  private readonly jobsPath: string
  private readonly queuePath: string
  private readonly deadLetterPath: string
  private readonly mutex = new Mutex()
  private readonly ready: Promise<void>

  private jobs = new Map<string, Job>()
  private queue: string[] = []
  private deadLetter: DeadLetterEntry[] = []

  constructor(dataRoot: string = 'data') {
    this.dataDir = path.resolve(dataRoot)
    this.jobsPath = path.join(this.dataDir, 'jobs.json')
    this.queuePath = path.join(this.dataDir, 'queue.json')
    this.deadLetterPath = path.join(this.dataDir, 'dead_letter.json')

    this.ready = this.initialize()
  }

  private async initialize(): Promise<void> {
    await fs.mkdir(this.dataDir, { recursive: true })
    await Promise.all([
      fs.mkdir(path.join(this.dataDir, 'files'), { recursive: true }),
      fs.mkdir(path.join(this.dataDir, 'logs'), { recursive: true }),
      fs.mkdir(path.join(this.dataDir, 'transcripts'), { recursive: true }),
      fs.mkdir(path.join(this.dataDir, 'summaries'), { recursive: true }),
    ])

    await this.loadState()
  }

  private async loadState(): Promise<void> {
    await this.mutex.runExclusive(async () => {
      this.jobs = new Map(await this.loadJobsFromDisk())
      this.queue = await this.loadQueueFromDisk()
      this.deadLetter = await this.loadDeadLetterFromDisk()
    })
  }

  private async loadJobsFromDisk(): Promise<Array<[string, Job]>> {
    try {
      const raw = await fs.readFile(this.jobsPath, 'utf-8')
      const parsed = z.array(JobSchema).parse(JSON.parse(raw))
      return parsed.map(job => [job.id, job] as [string, Job])
    } catch (error) {
      await this.backupCorruptFile(this.jobsPath, error)
      return []
    }
  }

  private async loadQueueFromDisk(): Promise<string[]> {
    try {
      const raw = await fs.readFile(this.queuePath, 'utf-8')
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed.filter(id => typeof id === 'string') : []
    } catch (error) {
      await this.backupCorruptFile(this.queuePath, error)
      return []
    }
  }

  private async loadDeadLetterFromDisk(): Promise<DeadLetterEntry[]> {
    try {
      const raw = await fs.readFile(this.deadLetterPath, 'utf-8')
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) return []
      return parsed.filter(this.isDeadLetterEntry)
    } catch (error) {
      await this.backupCorruptFile(this.deadLetterPath, error)
      return []
    }
  }

  private async backupCorruptFile(filePath: string, error: unknown): Promise<void> {
    try {
      await fs.access(filePath, fsConstants.F_OK)
    } catch {
      return
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = `${filePath}.backup.${timestamp}`
    try {
      await fs.rename(filePath, backupPath)
      // eslint-disable-next-line no-console
      console.warn(`Backed up corrupt store file ${filePath} → ${backupPath}`, error)
    } catch (renameError) {
      // eslint-disable-next-line no-console
      console.error(`Failed to backup corrupt store file ${filePath}:`, renameError)
    }
  }

  private async writeJsonAtomic(filePath: string, data: unknown): Promise<void> {
    const tmpPath = `${filePath}.tmp-${Date.now()}`
    await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf-8')
    await fs.rename(tmpPath, filePath)
  }

  private cloneJob(job: Job): Job {
    if (typeof structuredClone === 'function') {
      return structuredClone(job)
    }
    return JSON.parse(JSON.stringify(job)) as Job
  }

  async getJobs(): Promise<Job[]> {
    await this.ready
    return this.mutex.runExclusive(async () => Array.from(this.jobs.values()).map(job => this.cloneJob(job)))
  }

  async getJob(id: string): Promise<Job | undefined> {
    await this.ready
    return this.mutex.runExclusive(async () => {
      const job = this.jobs.get(id)
      return job ? this.cloneJob(job) : undefined
    })
  }

  async createJob(url: string, meetingDate?: string): Promise<Job> {
    await this.ready
    return this.mutex.runExclusive(async () => {
      const job: Job = {
        id: `job_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
        url,
        meeting_date: meetingDate || new Date().toISOString().split('T')[0],
        status: 'queued',
        created_at: Date.now(),
        updated_at: Date.now(),
        logs: [`Job created at ${new Date().toISOString()}`],
      }

      this.jobs.set(job.id, job)
      this.enqueueUnsafe(job.id)
      await this.persistJobsAndQueue()
      return this.cloneJob(job)
    })
  }

  async updateJob(id: string, updates: Partial<Job>): Promise<Job | undefined> {
    await this.ready
    return this.mutex.runExclusive(async () => {
      const existing = this.jobs.get(id)
      if (!existing) return undefined

      const updated: Job = {
        ...existing,
        ...updates,
        updated_at: Date.now(),
      }

      this.jobs.set(id, updated)
      await this.persistJobs()
      return this.cloneJob(updated)
    })
  }

  async addLog(id: string, message: string): Promise<void> {
    await this.ready
    await this.mutex.runExclusive(async () => {
      const job = this.jobs.get(id)
      if (!job) return

      const entry = `[${new Date().toISOString()}] ${message}`
      job.logs.push(entry)
      job.updated_at = Date.now()
      await Promise.all([
        this.persistJobs(),
        fs.appendFile(path.join(this.dataDir, 'logs', `${id}.log`), `${entry}\n`, 'utf-8'),
      ])
    })
  }

  async deleteJob(id: string): Promise<boolean> {
    await this.ready
    return this.mutex.runExclusive(async () => {
      const job = this.jobs.get(id)
      if (!job) return false

      this.jobs.delete(id)
      this.queue = this.queue.filter(jobId => jobId !== id)
      await Promise.all([
        this.persistJobsAndQueue(),
        this.removeArtifacts(job),
      ])
      return true
    })
  }

  private async removeArtifacts(job: Job): Promise<void> {
    const targets = [
      job.file_path,
      job.transcript_path,
      job.summary_path,
      path.join(this.dataDir, 'logs', `${job.id}.log`),
    ]

    await Promise.all(
      targets
        .filter((item): item is string => Boolean(item))
        .map(async file => {
          try {
            await fs.rm(file, { force: true })
          } catch (error) {
            // eslint-disable-next-line no-console
            console.warn(`Failed to remove artifact ${file}:`, error)
          }
        }),
    )
  }

  async getNextJob(): Promise<Job | undefined> {
    await this.ready
    return this.mutex.runExclusive(async () => {
      while (this.queue.length > 0) {
        const id = this.queue[0]
        const job = this.jobs.get(id)

        if (!job) {
          this.queue.shift()
          continue
        }

        if (job.status === 'error' || job.status === 'completed') {
          this.queue.shift()
          continue
        }

        return this.cloneJob(job)
      }
      return undefined
    })
  }

  async dequeue(id: string): Promise<void> {
    await this.ready
    await this.mutex.runExclusive(async () => {
      this.queue = this.queue.filter(jobId => jobId !== id)
      await this.persistQueue()
    })
  }

  async enqueue(id: string): Promise<void> {
    await this.ready
    await this.mutex.runExclusive(async () => {
      this.enqueueUnsafe(id)
      await this.persistQueue()
    })
  }

  private enqueueUnsafe(id: string): void {
    if (!this.queue.includes(id)) {
      this.queue.push(id)
    }
  }

  async moveToDeadLetter(jobId: string, reason: string): Promise<void> {
    await this.ready
    await this.mutex.runExclusive(async () => {
      const job = this.jobs.get(jobId)
      if (!job) return

      const entry: DeadLetterEntry = {
        job: this.cloneJob(job),
        failedAt: Date.now(),
        reason,
        retryCount: this.deadLetter.filter(d => d.job.id === jobId).length + 1,
      }

      this.deadLetter.push(entry)
      const updatedJob: Job = {
        ...job,
        status: 'error',
        error: reason,
        updated_at: Date.now(),
      }
      this.jobs.set(jobId, updatedJob)
      this.queue = this.queue.filter(id => id !== jobId)
      await Promise.all([
        this.persistDeadLetter(),
        this.persistJobs(),
        this.persistQueue(),
      ])
    })
  }

  async getDeadLetter(): Promise<DeadLetterEntry[]> {
    await this.ready
    return this.mutex.runExclusive(async () => this.deadLetter.map(entry => ({
      ...entry,
      job: this.cloneJob(entry.job),
    })))
  }

  private async persistJobs(): Promise<void> {
    await this.writeJsonAtomic(this.jobsPath, Array.from(this.jobs.values()))
  }

  private async persistQueue(): Promise<void> {
    await this.writeJsonAtomic(this.queuePath, this.queue)
  }

  private async persistDeadLetter(): Promise<void> {
    await this.writeJsonAtomic(this.deadLetterPath, this.deadLetter)
  }

  private async persistJobsAndQueue(): Promise<void> {
    await Promise.all([this.persistJobs(), this.persistQueue()])
  }

  private isDeadLetterEntry(entry: unknown): entry is DeadLetterEntry {
    if (typeof entry !== 'object' || entry === null) return false
    const candidate = entry as Record<string, unknown>
    return (
      typeof candidate.failedAt === 'number' &&
      typeof candidate.reason === 'string' &&
      typeof candidate.retryCount === 'number' &&
      candidate.job !== undefined
    )
  }
}
