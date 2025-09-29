import path from 'path'
import { promises as fs } from 'fs'

import { JobStore, Job } from './storage/job-store'
import { resolvePlaudAudioUrl } from './plaud/resolver'
import { downloadAudioFile } from './utils/downloader'
import { transcribeWithAssemblyAI } from './assemblyai/client'
import { summarizeWithGPT, generateTitle, OpenAIConfig } from './openai/client'

export interface JobQueueConfig {
  dataDir?: string
  assemblyAiApiKey?: string
  openAiConfig?: OpenAIConfig
  jobTimeout?: number // milliseconds, default 10 minutes
}

/**
 * Simple in-process job queue.
 * Provides async storage operations and background job processing.
 */
export class SimpleJobQueue {
  private processing = false
  private readonly store: JobStore
  private readonly config: JobQueueConfig
  private currentJobId: string | null = null
  private jobStartTime = 0

  constructor(config: JobQueueConfig = {}) {
    this.config = {
      jobTimeout: 10 * 60 * 1000,
      ...config,
    }
    this.store = new JobStore(config.dataDir)
  }

  async enqueue(url: string, meetingDate?: string): Promise<Job> {
    const job = await this.store.createJob(url, meetingDate)

    if (!this.processing) {
      this.processing = true
      void this.process()
    }

    return job
  }

  /**
   * Retry a failed job.
   */
  async retryJob(jobId: string, fullRerun: boolean = false): Promise<void> {
    const job = await this.store.getJob(jobId)
    if (!job) throw new Error('Job not found')

    const reset: Partial<Job> = {
      status: 'queued',
      error: undefined,
      checkpoint: fullRerun ? undefined : job.checkpoint,
      updated_at: Date.now(),
    }

    if (fullRerun) {
      Object.assign(reset, {
        resolved_url: undefined,
        file_path: undefined,
        transcript_path: undefined,
        summary_path: undefined,
        summary: undefined,
        title: undefined,
      })
    }

    await this.store.updateJob(jobId, reset)
    await this.store.enqueue(jobId)

    if (!this.processing) {
      this.processing = true
      void this.process()
    }
  }

  /**
   * Regenerate summary for a job (skips earlier stages).
   */
  async regenerateSummary(jobId: string): Promise<void> {
    const job = await this.store.getJob(jobId)
    if (!job || !job.transcript_path) {
      throw new Error('Job not found or no transcript available')
    }

    await this.store.updateJob(jobId, {
      status: 'queued',
      error: undefined,
      checkpoint: { step: 'summarize' },
      summary_path: undefined,
      summary: undefined,
      title: undefined,
    })

    await this.store.enqueue(jobId)

    if (!this.processing) {
      this.processing = true
      void this.process()
    }
  }

  getStore(): JobStore {
    return this.store
  }

  private async process(): Promise<void> {
    while (true) {
      const job = await this.store.getNextJob()
      if (!job) break

      this.currentJobId = job.id
      this.jobStartTime = Date.now()

      try {
        await this.runJob(job)
        await this.store.dequeue(job.id)
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('Queue processing error:', error)
      }
    }

    this.processing = false
    this.currentJobId = null
  }

  private async runJob(initialJob: Job): Promise<void> {
    let job = initialJob
    const log = async (msg: string) => {
      await this.store.addLog(job.id, msg)
    }

    try {
      await this.store.updateJob(job.id, { status: 'resolving' })

      // Step 1: Resolve Plaud URL
      if (!job.resolved_url || job.checkpoint?.step === 'resolve') {
        const metadata = await resolvePlaudAudioUrl(job.url, msg => void log(msg))
        const updates: Partial<Job> = {
          resolved_url: metadata.audioUrl,
          checkpoint: { step: 'download' },
        }
        if (metadata.meetingDate) {
          updates.meeting_date = metadata.meetingDate
          await log(`Updated meeting date to: ${metadata.meetingDate}`)
        }
        job = (await this.store.updateJob(job.id, updates)) ?? job
      }

      this.checkTimeout()

      // Step 2: Download audio
      await this.store.updateJob(job.id, { status: 'downloading' })
      if (!job.file_path || job.checkpoint?.step === 'download') {
        const outputPath = path.join(
          this.config.dataDir || 'data',
          'files',
          `${job.id}.mp3`,
        )
        const filePath = await downloadAudioFile(
          job.resolved_url || job.url,
          outputPath,
          msg => void log(msg),
        )
        job =
          (await this.store.updateJob(job.id, {
            file_path: filePath,
            checkpoint: { step: 'transcribe' },
          })) ?? job
      }

      this.checkTimeout()

      // Step 3: Transcribe
      await this.store.updateJob(job.id, { status: 'transcribing' })
      if (!job.transcript_path || job.checkpoint?.step === 'transcribe') {
        if (this.config.assemblyAiApiKey && job.file_path) {
          const result = await transcribeWithAssemblyAI(
            job.file_path,
            this.config.assemblyAiApiKey,
            msg => void log(msg),
          )

          if (result) {
            const transcriptPath = path.join(
              this.config.dataDir || 'data',
              'transcripts',
              `${job.id}.txt`,
            )
            await fs.writeFile(transcriptPath, result.text, 'utf-8')
            job =
              (await this.store.updateJob(job.id, {
                transcript_path: transcriptPath,
                checkpoint: { step: 'summarize' },
              })) ?? job
          }
        } else {
          await log('Transcription skipped (no API key)')
        }
      }

      this.checkTimeout()

      // Step 4: Summarize
      await this.store.updateJob(job.id, { status: 'summarizing' })
      if (this.config.openAiConfig && job.transcript_path) {
        const transcript = await fs.readFile(job.transcript_path, 'utf-8')

        let summary = ''
        const generator = summarizeWithGPT(
          transcript,
          job.meeting_date || new Date().toISOString().split('T')[0],
          this.config.openAiConfig,
          msg => void log(msg),
        )

        for await (const chunk of generator) {
          summary += chunk
        }

        if (summary) {
          const summaryPath = path.join(
            this.config.dataDir || 'data',
            'summaries',
            `${job.id}.md`,
          )
          await fs.writeFile(summaryPath, summary, 'utf-8')

          const title = await generateTitle(
            summary,
            this.config.openAiConfig,
            msg => void log(msg),
          )

          job =
            (await this.store.updateJob(job.id, {
              summary_path: summaryPath,
              summary,
              title,
              status: 'completed',
              checkpoint: undefined,
            })) ?? job
        }
      } else {
        await log('Summarization skipped (no API key or transcript)')
        await this.store.updateJob(job.id, {
          status: 'completed',
          checkpoint: undefined,
        })
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      await log(`Error: ${errorMsg}`)

      const retryCount = await this.getRetryCount(job.id)
      if (retryCount >= 3) {
        await this.store.moveToDeadLetter(job.id, errorMsg)
      } else {
        await this.store.updateJob(job.id, {
          status: 'error',
          error: errorMsg,
        })
      }
    }
  }

  private checkTimeout(): void {
    if (this.isTimedOut()) {
      throw new Error('Job timeout exceeded')
    }
  }

  private isTimedOut(): boolean {
    if (!this.currentJobId || !this.jobStartTime || !this.config.jobTimeout) {
      return false
    }
    return Date.now() - this.jobStartTime > this.config.jobTimeout
  }

  private async getRetryCount(jobId: string): Promise<number> {
    const job = await this.store.getJob(jobId)
    if (!job) return 0
    return job.logs?.filter(log => log.includes('Error:')).length ?? 0
  }
}
