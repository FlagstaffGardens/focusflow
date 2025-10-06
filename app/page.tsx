'use client'

import { Suspense, useState, useEffect, useCallback, useMemo, Children, type MouseEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useMobile } from '@/lib/hooks/use-mobile'

interface Job {
  id: string
  status: 'discovered' | 'transcribing' | 'transcribed' | 'summarizing' | 'syncing' | 'completed' | 'failed'
  source: 'plaud' | 'cube-acr'

  // Cube ACR specific
  contact_name?: string | null
  contact_number?: string | null
  call_direction?: 'incoming' | 'outgoing' | null
  call_timestamp?: string | null
  call_type?: 'phone' | 'whatsapp' | null
  duration_seconds?: number | null
  gdrive_file_id?: string | null
  gdrive_file_name?: string | null

  // Plaud.ai (backwards compat)
  url?: string
  plaud_url?: string | null
  title?: string
  meeting_date?: string

  // Processing results
  summary?: string | null
  transcript?: string | null

  // Notion
  notion_page_id?: string | null
  notion_url?: string | null

  // Error tracking
  error_message?: string | null

  // Timestamps
  created_at: string
  updated_at?: string
  discovered_at?: string | null
}

interface EnvStatus {
  assemblyai: boolean
  openai: boolean
}

export default function Page() {
  return (
    <Suspense fallback={
      <div className="flex h-screen items-center justify-center text-sm text-gray-500">
        Loading meeting…
      </div>
    }>
      <HomeContent />
    </Suspense>
  )
}

function HomeContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [jobs, setJobs] = useState<Job[]>([])
  const [envStatus, setEnvStatus] = useState<EnvStatus>({ assemblyai: false, openai: false })
  const [transcript, setTranscript] = useState<string>('')
  const [showTranscript, setShowTranscript] = useState(false)
  const [copiedTranscript, setCopiedTranscript] = useState(false)
  const [copiedSummary, setCopiedSummary] = useState(false)
  const isMobile = useMobile()

  const [selectedJob, setSelectedJob] = useState<Job | null>(null)

  const selectedJobId = searchParams.get('job')

  const summaryComponents = useMemo(() => ({
    h1: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
      <h1 className="mt-10 text-2xl font-semibold leading-tight text-gray-900" {...props} />
    ),
    h2: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
      <h2 className="mt-8 text-xl font-semibold leading-tight text-gray-900" {...props} />
    ),
    h3: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
      <h3 className="mt-6 text-lg font-semibold leading-snug text-gray-900" {...props} />
    ),
    p: ({ children, ...props }: React.HTMLAttributes<HTMLParagraphElement>) => {
      const childArray = Children.toArray(children)
      if (childArray.length === 1 && typeof childArray[0] === 'string') {
        const text = childArray[0].trim()
        const labelMatch = text.match(/^([A-Za-z0-9()\-/\s]+):\s*(.*)$/)
        const headingMatch = text.match(/^[A-Z][A-Za-z\s/()-]{1,40}$/)

        if (labelMatch) {
          const [, label, value] = labelMatch
          return (
            <div className="mb-4 flex flex-col gap-1 md:flex-row md:items-baseline md:gap-4">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 md:text-sm">
                {label.trim()}
              </span>
              <span className="text-base leading-relaxed text-gray-800 md:text-lg md:leading-8">
                {value?.length ? value : '—'}
              </span>
            </div>
          )
        }

        if (headingMatch && text.length < 35) {
          return (
            <h4 className="mt-6 text-lg font-semibold uppercase tracking-wide text-gray-700" {...props}>
              {text}
            </h4>
          )
        }
      }

      return (
        <p
          className="mb-5 whitespace-pre-line text-base leading-relaxed text-gray-700 md:text-lg md:leading-8"
          {...props}
        >
          {children}
        </p>
      )
    },
    strong: (props: React.HTMLAttributes<HTMLElement>) => (
      <strong className="font-semibold text-gray-900" {...props} />
    ),
    ul: (props: React.HTMLAttributes<HTMLUListElement>) => (
      <ul className="list-disc space-y-3 pl-6 text-base leading-relaxed text-gray-700 md:text-lg md:leading-8" {...props} />
    ),
    ol: (props: React.HTMLAttributes<HTMLOListElement>) => (
      <ol className="list-decimal space-y-3 pl-6 text-base leading-relaxed text-gray-700 md:text-lg md:leading-8" {...props} />
    ),
    li: (props: React.HTMLAttributes<HTMLLIElement>) => (
      <li className="leading-relaxed" {...props} />
    ),
    blockquote: (props: React.HTMLAttributes<HTMLQuoteElement>) => (
      <blockquote className="border-l-4 border-gray-300 pl-4 italic text-gray-600" {...props} />
    ),
    table: (props: React.HTMLAttributes<HTMLTableElement>) => (
      <table className="w-full text-sm text-gray-700" {...props} />
    ),
    th: (props: React.HTMLAttributes<HTMLTableCellElement>) => (
      <th className="border-b border-gray-200 px-3 py-2 text-left font-semibold" {...props} />
    ),
    td: (props: React.HTMLAttributes<HTMLTableCellElement>) => (
      <td className="border-b border-gray-100 px-3 py-2 align-top" {...props} />
    ),
    code: ({ inline, children, ...props }: React.HTMLAttributes<HTMLElement> & { inline?: boolean }) => (
      inline ? (
        <code className="rounded bg-gray-100 px-1 py-0.5 text-sm text-pink-600" {...props}>
          {children}
        </code>
      ) : (
        <code className="block rounded-lg bg-gray-900 p-4 text-sm text-gray-100" {...props}>
          {children}
        </code>
      )
    ),
  }), [])

  // Fetch environment status
  useEffect(() => {
    fetch('/api/health')
      .then(res => res.json())
      .then(data => {
        if (data.env) {
          setEnvStatus({
            assemblyai: data.env.assemblyai === true,
            openai: data.env.openai === true
          })
        }
      })
      .catch(console.error)
  }, [])

  const fetchJobs = useCallback(async () => {
    try {
      const response = await fetch('/api/jobs')
      const data = await response.json()
      const jobsList = data.jobs || []
      // Jobs are already sorted by created_at desc from the API
      setJobs(jobsList)
    } catch (error) {
      console.error('Failed to fetch jobs:', error)
    }
  }, [])

  useEffect(() => {
    fetchJobs()
    const interval = setInterval(fetchJobs, 5000)
    return () => clearInterval(interval)
  }, [fetchJobs])

  useEffect(() => {
    if (!selectedJobId) {
      setSelectedJob(null)
      return
    }
    setSelectedJob(prev => prev?.id === selectedJobId ? prev : jobs.find(job => job.id === selectedJobId) ?? prev ?? null)
  }, [selectedJobId, jobs])

  const loadTranscript = useCallback(async (job: Job) => {
    // Transcript is now stored directly in the job object (V2)
    setTranscript(job.transcript || '')
  }, [])

  const selectJob = useCallback((job: Job | null) => {
    if (job) {
      loadTranscript(job)
      router.push(`/?job=${job.id}`)
    } else {
      router.replace('/', { scroll: false })
    }
  }, [router, loadTranscript])

  useEffect(() => {
    if (selectedJob) {
      loadTranscript(selectedJob)
      setShowTranscript(false)
    }
  }, [selectedJob, loadTranscript])

  // Removed unused URL submission flow from v1 UI

  const deleteJob = async (
    jobId: string,
    e?: MouseEvent<HTMLButtonElement>
  ) => {
    e?.stopPropagation()
    try {
      const response = await fetch(`/api/jobs/${jobId}`, {
        method: 'DELETE',
      })
      if (response.ok) {
        fetchJobs()
        if (selectedJob?.id === jobId) {
          selectJob(null)
          setTranscript('')
        }
      }
    } catch (error) {
      console.error('Failed to delete job:', error)
    }
  }

  const retryJob = async (jobId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await fetch(`/api/jobs/${jobId}/retry`, {
        method: 'POST',
      })
      fetchJobs()
    } catch (error) {
      console.error('Failed to retry job:', error)
    }
  }

  const resummarizeJob = async (jobId: string) => {
    try {
      await fetch(`/api/jobs/${jobId}/resummarize`, {
        method: 'POST',
      })
      fetchJobs()
    } catch (error) {
      console.error('Failed to resummarize job:', error)
    }
  }

  const transcribeJob = async (jobId: string, e?: React.MouseEvent) => {
    e?.stopPropagation()
    try {
      // Optimistically update UI to show processing state
      setJobs(prev => prev.map(j =>
        j.id === jobId ? { ...j, status: 'transcribing' as const } : j
      ))

      const response = await fetch(`/api/jobs/${jobId}/process`, {
        method: 'POST',
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.message || 'Processing failed')
      }

      // Fetch updated job list
      fetchJobs()
    } catch (error) {
      console.error('Failed to transcribe job:', error)
      // Revert on error
      fetchJobs()
    }
  }

  const syncToNotion = async (jobId: string, e?: React.MouseEvent) => {
    e?.stopPropagation()
    try {
      const response = await fetch(`/api/jobs/${jobId}/sync-notion`, {
        method: 'POST',
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.message || 'Notion sync failed')
      }

      // Fetch updated job list to get new Notion URL
      fetchJobs()
    } catch (error) {
      console.error('Failed to sync to Notion:', error)
      alert(error instanceof Error ? error.message : 'Failed to sync to Notion')
    }
  }

  const copyToClipboard = async (text: string, type: 'transcript' | 'summary') => {
    try {
      await navigator.clipboard.writeText(text)
      if (type === 'transcript') {
        setCopiedTranscript(true)
        setTimeout(() => setCopiedTranscript(false), 2000)
      } else {
        setCopiedSummary(true)
        setTimeout(() => setCopiedSummary(false), 2000)
      }
    } catch (error) {
      console.error('Failed to copy:', error)
    }
  }

  const getStatusColor = (status: Job['status']) => {
    switch (status) {
      case 'completed': return 'text-green-600'
      case 'failed': return 'text-red-600'
      case 'discovered': return 'text-gray-500'
      case 'transcribing': return 'text-blue-600'
      case 'transcribed': return 'text-blue-600'
      case 'summarizing': return 'text-blue-600'
      case 'syncing': return 'text-purple-600'
      default: return 'text-gray-600'
    }
  }

  const getStatusIcon = (status: Job['status']) => {
    const isProcessing = ['transcribing', 'transcribed', 'summarizing', 'syncing'].includes(status)
    const spinnerClass = isProcessing ? 'inline-block animate-spin' : ''

    switch (status) {
      case 'completed': return '✓'
      case 'failed': return '✗'
      case 'discovered': return '🔍'
      case 'transcribing': return <span className={spinnerClass}>⏳</span>
      case 'transcribed': return <span className={spinnerClass}>⏳</span>
      case 'summarizing': return <span className={spinnerClass}>⏳</span>
      case 'syncing': return <span className={spinnerClass}>☁️</span>
      default: return '•'
    }
  }

  const getJobTitle = (job: Job) => {
    if (job.contact_name) {
      const typeIcon = job.call_type === 'whatsapp' ? '💬' : '📞'
      const directionIcon = job.call_direction === 'incoming' ? '↙' : '↗'
      return `${typeIcon} ${job.contact_name} ${directionIcon}`
    }
    return job.title || 'Untitled Meeting'
  }

  const formatDuration = (seconds?: number | null) => {
    if (!seconds) return null
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}m ${secs}s`
  }

  const formatDate = (job: Job) => {
    const dateToUse = job.call_timestamp || job.meeting_date || job.created_at
    if (!dateToUse) return 'Unknown date'

    const date = new Date(dateToUse)
    // Force Melbourne, Australia timezone regardless of client/server locale
    return new Intl.DateTimeFormat('en-AU', {
      timeZone: 'Australia/Melbourne',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      year: 'numeric',
      hour12: true,
    }).format(date)
  }

  if (isMobile) {
    if (selectedJob) {
      return (
        <div className="min-h-screen bg-gray-50 flex flex-col">
        <div className="bg-white border-b sticky top-0 z-10">
          <div className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <button
                onClick={() => selectJob(null)}
                className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-600 shadow-sm transition hover:border-gray-300 hover:text-gray-800"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  className="h-4 w-4"
                >
                  <path
                    fillRule="evenodd"
                    d="M17 10a.75.75 0 0 1-.75.75H5.56l4.22 4.22a.75.75 0 1 1-1.06 1.06l-5.5-5.5a.75.75 0 0 1 0-1.06l5.5-5.5a.75.75 0 1 1 1.06 1.06L5.56 9.25H16.25A.75.75 0 0 1 17 10Z"
                    clipRule="evenodd"
                  />
                </svg>
                Back
              </button>
            </div>
            <h2 className="text-lg font-semibold">
              {getJobTitle(selectedJob)}
            </h2>
            <p className="text-xs text-gray-500 mt-1">
              {formatDate(selectedJob)}
              {selectedJob.duration_seconds && (
                <span className="ml-2">• {formatDuration(selectedJob.duration_seconds)}</span>
              )}
            </p>
            <span className={`text-xs ${getStatusColor(selectedJob.status)}`}>
              {getStatusIcon(selectedJob.status)} {selectedJob.status}
            </span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {selectedJob.status === 'discovered' && (
            <div className="p-4 bg-white border-b">
              <Button
                onClick={() => transcribeJob(selectedJob.id)}
                size="sm"
                className="w-full bg-blue-600 hover:bg-blue-700"
              >
                ▶ Transcribe
              </Button>
            </div>
          )}

          {['transcribing', 'transcribed', 'summarizing', 'syncing'].includes(selectedJob.status) && (
            <div className="p-4 bg-blue-50 border-b">
              <div className="flex items-center gap-3">
                <div className="animate-spin h-4 w-4 border-2 border-blue-600 border-t-transparent rounded-full"></div>
                <div className="text-sm text-blue-700">
                  {selectedJob.status === 'transcribing' && 'Transcribing audio...'}
                  {selectedJob.status === 'transcribed' && 'Preparing summarization...'}
                  {selectedJob.status === 'summarizing' && 'Generating summary...'}
                  {selectedJob.status === 'syncing' && 'Syncing to Notion...'}
                </div>
              </div>
            </div>
          )}

          {selectedJob.status === 'completed' && (
            <div className="p-4 bg-white border-b space-y-2">
              <Button
                onClick={(e) => syncToNotion(selectedJob.id, e)}
                size="sm"
                className="w-full bg-purple-600 hover:bg-purple-700"
              >
                📝 Sync to Notion
              </Button>
              {selectedJob.notion_url && (
                <a
                  href={selectedJob.notion_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block w-full text-center rounded-md bg-purple-50 px-4 py-2 text-sm font-medium text-purple-600 border border-purple-200 hover:bg-purple-100"
                >
                  View in Notion →
                </a>
              )}
              <div className="flex gap-2">
                {selectedJob.transcript && (
                  <Button
                    onClick={() => resummarizeJob(selectedJob.id)}
                    size="sm"
                    className="flex-1"
                  >
                    🔄 Resummarize
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    deleteJob(selectedJob.id)
                    selectJob(null)
                  }}
                  className="text-red-600"
                >
                  Delete
                </Button>
              </div>
            </div>
          )}

          {transcript && (
            <div className="bg-white mb-2">
              <div className="p-4 border-b">
                <div className="flex items-center justify-between">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowTranscript(!showTranscript)}
                    className="font-medium p-0"
                  >
                    {showTranscript ? '▼' : '▶'} Transcript
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => copyToClipboard(transcript, 'transcript')}
                  >
                    {copiedTranscript ? '✓ Copied' : 'Copy'}
                  </Button>
                </div>
              </div>
              {showTranscript && (
                <div className="p-4 max-h-64 overflow-y-auto">
                  <pre className="text-sm whitespace-pre-wrap">
                    {transcript}
                  </pre>
                </div>
              )}
            </div>
          )}

          <div className="bg-white">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <h3 className="font-medium">Summary</h3>
              {selectedJob.summary && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => copyToClipboard(selectedJob.summary || '', 'summary')}
                >
                  {copiedSummary ? '✓ Copied' : 'Copy'}
                </Button>
              )}
            </div>
            <div className="px-4 pb-6">
              {selectedJob.summary ? (
                <div className="rounded-lg border border-gray-200 bg-white shadow-sm p-4">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={summaryComponents}
                  >
                    {selectedJob.summary}
                  </ReactMarkdown>
                </div>
              ) : (
                <p className="text-gray-500 text-sm">
                  {selectedJob.status === 'completed'
                    ? 'No summary available'
                    : 'Summary will appear here when ready'}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    )
    }

    return (
      <div className="min-h-screen bg-gray-50">
        <div className="bg-white border-b">
          <div className="p-4">
            <h1 className="text-xl font-bold">FocusFlow</h1>
            <p className="text-sm text-gray-600 mt-1">Call Recordings</p>

            <div className="flex gap-3 text-xs mt-3">
              <span className={envStatus.assemblyai ? 'text-green-600' : 'text-red-600'}>
                AssemblyAI {envStatus.assemblyai ? '✓' : '✗'}
              </span>
              <span className={envStatus.openai ? 'text-green-600' : 'text-red-600'}>
                OpenAI {envStatus.openai ? '✓' : '✗'}
              </span>
            </div>
          </div>
        </div>

        <div className="p-4 space-y-3">
          {jobs.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-300 bg-white px-6 py-12 text-center text-gray-500">
              No recordings found. New calls will appear here automatically.
            </div>
          ) : (
            jobs.map(job => (
              <Card
                key={job.id}
                className="p-4 active:bg-gray-50"
                onClick={() => selectJob(job)}
              >
                <p className="font-medium truncate">
                  {getJobTitle(job)}
                </p>
                <p className="text-sm text-gray-500 mt-1">
                  {formatDate(job)}
                  {job.duration_seconds && (
                    <span className="ml-2">• {formatDuration(job.duration_seconds)}</span>
                  )}
                </p>
                <div className="flex items-center justify-between mt-2">
                  <p className={`text-sm ${getStatusColor(job.status)}`}>
                    {getStatusIcon(job.status)} {job.status}
                  </p>
                  {job.status === 'discovered' && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={(e) => transcribeJob(job.id, e)}
                      className="text-xs h-7 px-2 bg-blue-50 hover:bg-blue-100 text-blue-600 border-blue-200"
                    >
                      ▶ Transcribe
                    </Button>
                  )}
                </div>
              </Card>
            ))
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen bg-gray-50">
      <div className="w-96 border-r bg-white flex flex-col">
        <div className="p-4 border-b">
          <h1 className="text-2xl font-bold mb-2">FocusFlow</h1>
          <p className="text-sm text-gray-600">Call Recordings</p>

          <div className="mt-3 flex gap-4 text-xs">
            <span className={envStatus.assemblyai ? 'text-green-600' : 'text-red-600'}>
              AssemblyAI {envStatus.assemblyai ? '✓' : '✗'}
            </span>
            <span className={envStatus.openai ? 'text-green-600' : 'text-red-600'}>
              OpenAI {envStatus.openai ? '✓' : '✗'}
            </span>
          </div>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-2">
            {jobs.length === 0 ? (
              <p className="text-center text-gray-500 py-8">No recordings yet</p>
            ) : (
              jobs.map((job) => (
                <Card
                  key={job.id}
                  className={`mb-2 p-3 cursor-pointer hover:bg-gray-50 ${
                    selectedJob?.id === job.id ? 'border-blue-500 bg-blue-50' : ''
                  }`}
                  onClick={() => selectJob(job)}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">
                        {getJobTitle(job)}
                      </p>
                      <p className="text-xs text-gray-500 mt-1">
                        {formatDate(job)}
                      </p>
                      {job.duration_seconds && (
                        <p className="text-xs text-gray-400 mt-0.5">
                          {formatDuration(job.duration_seconds)}
                        </p>
                      )}
                      <p className={`text-xs mt-1 ${getStatusColor(job.status)}`}>
                        {getStatusIcon(job.status)} {job.status}
                      </p>
                    </div>
                    {job.status === 'discovered' && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={(e) => transcribeJob(job.id, e)}
                        className="h-7 px-2 bg-blue-50 hover:bg-blue-100 text-blue-600 border-blue-200"
                      >
                        ▶ Transcribe
                      </Button>
                    )}
                    {job.status === 'failed' && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={(e) => retryJob(job.id, e)}
                        className="h-7 px-2"
                      >
                        Retry
                      </Button>
                    )}
                  </div>
                </Card>
              ))
            )}
          </div>
        </ScrollArea>
      </div>

      <div className="flex-1 flex flex-col">
        {selectedJob ? (
          <>
            <div className="border-b bg-white px-6 py-5">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-2">
                  <h2 className="text-xl font-semibold text-gray-900">
                    {getJobTitle(selectedJob)}
                  </h2>
                  <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-gray-600">
                    <span className={getStatusColor(selectedJob.status)}>
                      {getStatusIcon(selectedJob.status)} {selectedJob.status}
                    </span>
                    <span>{formatDate(selectedJob)}</span>
                    {selectedJob.duration_seconds && (
                      <span>{formatDuration(selectedJob.duration_seconds)}</span>
                    )}
                    {selectedJob.contact_number && (
                      <span>{selectedJob.contact_number}</span>
                    )}
                  </div>

                  {/* Processing progress indicator */}
                  {['transcribing', 'transcribed', 'summarizing', 'syncing'].includes(selectedJob.status) && (
                    <div className="mt-3 rounded-lg bg-blue-50 border border-blue-200 px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="animate-spin h-5 w-5 border-2 border-blue-600 border-t-transparent rounded-full"></div>
                        <div className="text-sm text-blue-700">
                          {selectedJob.status === 'transcribing' && 'Transcribing audio...'}
                          {selectedJob.status === 'transcribed' && 'Preparing summarization...'}
                          {selectedJob.status === 'summarizing' && 'Generating summary...'}
                          {selectedJob.status === 'syncing' && 'Syncing to Notion...'}
                        </div>
                      </div>
                    </div>
                  )}
                  {selectedJob.gdrive_file_name && (
                    <p className="text-sm text-gray-500 truncate max-w-2xl">
                      📁 {selectedJob.gdrive_file_name}
                    </p>
                  )}
                  {selectedJob.url && (
                    <p className="text-sm text-gray-500 break-all max-w-2xl">
                      {selectedJob.url}
                    </p>
                  )}
                  {selectedJob.error_message && (
                    <p className="text-sm text-red-600">
                      Error: {selectedJob.error_message}
                    </p>
                  )}
                  {selectedJob.notion_url && (
                    <a
                      href={selectedJob.notion_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-sm text-purple-600 hover:text-purple-800 underline"
                    >
                      📝 View in Notion →
                    </a>
                  )}
                </div>

                {selectedJob.status === 'discovered' && (
                  <button
                    onClick={() => transcribeJob(selectedJob.id)}
                    className="inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700"
                  >
                    ▶ Transcribe
                  </button>
                )}
                {selectedJob.status === 'completed' && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => syncToNotion(selectedJob.id)}
                      className="inline-flex items-center justify-center rounded-md bg-purple-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-purple-700"
                    >
                      📝 Sync to Notion
                    </button>
                    {transcript && (
                      <button
                        onClick={() => resummarizeJob(selectedJob.id)}
                        className="inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700"
                      >
                        🔄 Resummarize
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="flex-1 flex flex-col overflow-y-auto">
              {transcript && (
                <div className="border-b bg-gray-50/80">
                  <div className="flex items-center justify-between px-6 py-3">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowTranscript(!showTranscript)}
                      className="font-medium"
                    >
                      {showTranscript ? '▼' : '▶'} Transcript
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => copyToClipboard(transcript, 'transcript')}
                    >
                      {copiedTranscript ? '✓ Copied' : 'Copy'}
                    </Button>
                  </div>

                  {showTranscript && (
                    <div className="border-t bg-white max-h-72 overflow-y-auto">
                      <pre className="px-6 py-4 text-sm whitespace-pre-wrap font-sans leading-relaxed">
                        {transcript}
                      </pre>
                    </div>
                  )}
                </div>
              )}

              <div className="flex-1 flex flex-col min-h-0">
                <div className="flex items-center justify-between border-b bg-gray-50/80 px-6 py-3">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-600">
                    Summary
                  </h3>
                  {selectedJob.summary && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => copyToClipboard(selectedJob.summary || '', 'summary')}
                    >
                      {copiedSummary ? '✓ Copied' : 'Copy'}
                    </Button>
                  )}
                </div>

                <ScrollArea className="flex-1 overflow-y-auto bg-gray-50">
                  <div className="mx-auto w-full max-w-3xl space-y-8 px-6 py-10">
                    {selectedJob.summary ? (
                      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
                        <div className="space-y-6 p-8">
                          <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            components={summaryComponents}
                          >
                            {selectedJob.summary}
                          </ReactMarkdown>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-lg border border-dashed border-gray-300 bg-white px-6 py-12 text-center text-gray-500">
                        {selectedJob.status === 'completed'
                          ? 'No summary available for this job.'
                          : 'Summary will appear here when processing finishes.'}
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-500">
            <div className="text-center">
              <p className="text-xl mb-2">Select a recording to view details</p>
              <p className="text-sm">Choose a call from the list to see transcript and summary</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
