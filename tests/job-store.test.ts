import { describe, it, beforeEach, afterEach, expect } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'

import { JobStore } from '@/lib/pipeline/storage/job-store'

describe('JobStore', () => {
  let dataDir: string
  let store: JobStore

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'focusflow-store-'))
    store = new JobStore(dataDir)
  })

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true })
  })

  it('creates and retrieves jobs', async () => {
    const created = await store.createJob('https://example.com/audio.mp3')
    expect(created.id).toMatch(/^job_/) // sanity

    const fetched = await store.getJob(created.id)
    expect(fetched?.url).toBe('https://example.com/audio.mp3')

    const jobsFile = path.join(dataDir, 'jobs.json')
    const persisted = JSON.parse(await readFile(jobsFile, 'utf-8'))
    expect(persisted).toHaveLength(1)
    expect(persisted[0].id).toBe(created.id)
  })

  it('adds logs and removes job artefacts', async () => {
    const job = await store.createJob('https://example.com/audio.mp3')
    await store.addLog(job.id, 'testing log entry')

    const logPath = path.join(dataDir, 'logs', `${job.id}.log`)
    const logContent = await readFile(logPath, 'utf-8')
    expect(logContent).toContain('testing log entry')

    // write fake artefacts
    const transcriptPath = path.join(dataDir, 'transcripts', `${job.id}.txt`)
    await writeFile(transcriptPath, 'transcript', 'utf-8')

    const summaryPath = path.join(dataDir, 'summaries', `${job.id}.md`)
    await writeFile(summaryPath, 'summary', 'utf-8')

    await store.updateJob(job.id, {
      transcript_path: transcriptPath,
      summary_path: summaryPath,
    })

    const deleted = await store.deleteJob(job.id)
    expect(deleted).toBe(true)

    const afterDelete = await store.getJob(job.id)
    expect(afterDelete).toBeUndefined()

    // transcript should be gone
    const exists = async (file: string) =>
      readFile(file, 'utf-8')
        .then(() => true)
        .catch(() => false)

    expect(await exists(transcriptPath)).toBe(false)
    expect(await exists(summaryPath)).toBe(false)
  })
})
