import { JobStore, Job } from './storage/job-store'
import { resolvePlaudAudioUrl } from './plaud/resolver'
import { downloadAudioFile } from './utils/downloader'
import { transcribeWithAssemblyAI } from './assemblyai/client'
import { summarizeWithGPT, generateTitle, OpenAIConfig } from './openai/client'
import { writeFileSync } from 'fs'
import path from 'path'

export interface JobQueueConfig {
  dataDir?: string
  assemblyAiApiKey?: string
  openAiConfig?: OpenAIConfig
  jobTimeout?: number // milliseconds, default 10 minutes
}

/**
 * Simple in-process job queue
 * Following Option B from the spec for MVP simplicity
 */
export class SimpleJobQueue {
  private processing = false
  private store: JobStore
  private config: JobQueueConfig
  private currentJob: Job | null = null
  private jobStartTime: number = 0

  constructor(config: JobQueueConfig = {}) {
    this.config = {
      jobTimeout: 10 * 60 * 1000, // 10 minutes default
      ...config,
    }
    this.store = new JobStore(config.dataDir)
  }

  /**
   * Create and enqueue a new job
   */
  async enqueue(url: string, meetingDate?: string): Promise<Job> {
    const job = this.store.createJob(url, meetingDate)

    // Start processing if not already running
    if (!this.processing) {
      this.processing = true
      // Run in background
      void this.process()
    }

    return job
  }

  /**
   * Process jobs from the queue
   */
  private async process(): Promise<void> {
    while (true) {
      try {
        const job = this.store.getNextJob()
        if (!job) break

        this.currentJob = job
        this.jobStartTime = Date.now()

        // Check for timeout
        if (this.isTimedOut()) {
          this.store.moveToDeadLetter(job.id, 'Job timeout exceeded')
          continue
        }

        // Process the job
        await this.runJob(job)

        // Remove from queue after successful completion
        this.store.dequeue(job.id)
      } catch (error) {
        console.error('Queue processing error:', error)
        // Continue processing other jobs
      }
    }

    this.processing = false
    this.currentJob = null
  }

  /**
   * Run a single job through the pipeline
   */
  private async runJob(job: Job): Promise<void> {
    const log = (msg: string) => this.store.addLog(job.id, msg)

    try {
      // Update status
      this.store.updateJob(job.id, { status: 'resolving' })

      // Step 1: Resolve Plaud URL
      if (!job.resolved_url || job.checkpoint?.step === 'resolve') {
        const resolvedUrl = await resolvePlaudAudioUrl(job.url, log)
        this.store.updateJob(job.id, {
          resolved_url: resolvedUrl,
          checkpoint: { step: 'download' }
        })
        job.resolved_url = resolvedUrl
      }

      this.checkTimeout(job)

      // Step 2: Download audio
      this.store.updateJob(job.id, { status: 'downloading' })
      if (!job.file_path || job.checkpoint?.step === 'download') {
        const outputPath = path.join(
          this.config.dataDir || 'data',
          'files',
          `${job.id}.mp3`
        )
        const filePath = await downloadAudioFile(
          job.resolved_url || job.url,
          outputPath,
          log
        )
        this.store.updateJob(job.id, {
          file_path: filePath,
          checkpoint: { step: 'transcribe' }
        })
        job.file_path = filePath
      }

      this.checkTimeout(job)

      // Step 3: Transcribe
      this.store.updateJob(job.id, { status: 'transcribing' })
      if (!job.transcript_path || job.checkpoint?.step === 'transcribe') {
        if (this.config.assemblyAiApiKey && job.file_path) {
          const result = await transcribeWithAssemblyAI(
            job.file_path,
            this.config.assemblyAiApiKey,
            log
          )

          if (result) {
            const transcriptPath = path.join(
              this.config.dataDir || 'data',
              'transcripts',
              `${job.id}.txt`
            )
            writeFileSync(transcriptPath, result.text)
            this.store.updateJob(job.id, {
              transcript_path: transcriptPath,
              checkpoint: { step: 'summarize' }
            })
            job.transcript_path = transcriptPath
          }
        } else {
          log('Transcription skipped (no API key)')
        }
      }

      this.checkTimeout(job)

      // Step 4: Summarize
      this.store.updateJob(job.id, { status: 'summarizing' })
      if (this.config.openAiConfig && job.transcript_path) {
        const transcript = require('fs').readFileSync(job.transcript_path, 'utf-8')

        let summary = ''
        const generator = summarizeWithGPT(
          transcript,
          job.meeting_date || new Date().toISOString().split('T')[0],
          this.config.openAiConfig,
          log
        )

        for await (const chunk of generator) {
          summary += chunk
        }

        if (summary) {
          const summaryPath = path.join(
            this.config.dataDir || 'data',
            'summaries',
            `${job.id}.md`
          )
          writeFileSync(summaryPath, summary)

          // Generate title
          const title = await generateTitle(summary, this.config.openAiConfig, log)

          this.store.updateJob(job.id, {
            summary_path: summaryPath,
            summary,
            title,
            status: 'completed',
            checkpoint: undefined,
          })
        }
      } else {
        log('Summarization skipped (no API key or transcript)')
        this.store.updateJob(job.id, {
          status: 'completed',
          checkpoint: undefined,
        })
      }

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      log(`Error: ${errorMsg}`)

      // Check if we should move to dead letter
      const retryCount = this.getRetryCount(job.id)
      if (retryCount >= 3) {
        this.store.moveToDeadLetter(job.id, errorMsg)
      } else {
        this.store.updateJob(job.id, {
          status: 'error',
          error: errorMsg
        })
      }
    }
  }

  /**
   * Check if current job has timed out
   */
  private checkTimeout(job: Job): void {
    if (this.isTimedOut()) {
      throw new Error('Job timeout exceeded')
    }
  }

  private isTimedOut(): boolean {
    if (!this.currentJob || !this.jobStartTime) return false
    return Date.now() - this.jobStartTime > (this.config.jobTimeout || 600000)
  }

  private getRetryCount(jobId: string): number {
    // Simple retry count based on error logs
    const job = this.store.getJob(jobId)
    if (!job) return 0
    return job.logs.filter(log => log.includes('Error:')).length
  }

  /**
   * Retry a failed job
   */
  async retryJob(jobId: string, fullRerun: boolean = false): Promise<void> {
    const job = this.store.getJob(jobId)
    if (!job) throw new Error('Job not found')

    // Reset status and error
    this.store.updateJob(jobId, {
      status: 'queued',
      error: undefined,
      checkpoint: fullRerun ? undefined : job.checkpoint,
    })

    // Clear artifacts if full rerun
    if (fullRerun) {
      this.store.updateJob(jobId, {
        resolved_url: undefined,
        file_path: undefined,
        transcript_path: undefined,
        summary_path: undefined,
        title: undefined,
      })
    }

    // Re-enqueue
    this.store.enqueue(jobId)

    if (!this.processing) {
      this.processing = true
      void this.process()
    }
  }

  /**
   * Regenerate summary only
   */
  async regenerateSummary(jobId: string): Promise<void> {
    const job = this.store.getJob(jobId)
    if (!job || !job.transcript_path) {
      throw new Error('Job not found or no transcript available')
    }

    // Update checkpoint to skip earlier steps
    this.store.updateJob(jobId, {
      status: 'queued',
      error: undefined,
      checkpoint: { step: 'summarize' },
      summary_path: undefined,
      title: undefined,
    })

    this.store.enqueue(jobId)

    if (!this.processing) {
      this.processing = true
      void this.process()
    }
  }

  /**
   * Get job store for direct access
   */
  getStore(): JobStore {
    return this.store
  }
}