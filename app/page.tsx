'use client'

import { Suspense, useState, useEffect, useCallback, useMemo, Children, type MouseEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useMobile } from '@/lib/hooks/use-mobile'

interface Job {
  id: string
  url: string
  resolved_url?: string
  meeting_date?: string
  status: 'queued' | 'resolving' | 'downloading' | 'transcribing' | 'summarizing' | 'completed' | 'error'
  title?: string
  summary?: string
  summary_path?: string
  transcript?: string
  transcript_path?: string
  file_path?: string
  created_at: number
  updated_at: number
  error?: string
  logs?: string[]
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
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [envStatus, setEnvStatus] = useState<EnvStatus>({ assemblyai: false, openai: false })
  const [transcript, setTranscript] = useState<string>('')
  const [showTranscript, setShowTranscript] = useState(false)
  const [copiedTranscript, setCopiedTranscript] = useState(false)
  const [copiedSummary, setCopiedSummary] = useState(false)
  const isMobile = useMobile()

  const selectedJob = useMemo(() => {
    if (!selectedJobId) return null
    return jobs.find(job => job.id === selectedJobId) ?? null
  }, [jobs, selectedJobId])

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

  // Fetch jobs
  const fetchJobs = useCallback(async () => {
    try {
      const response = await fetch('/api/jobs')
      const data = await response.json()
      const jobsList = data.jobs || []
      // Sort jobs by meeting_date (newest first), fallback to created_at
      const sortedJobs = jobsList.sort((a: Job, b: Job) => {
        const dateA = a.meeting_date ? new Date(a.meeting_date).getTime() : a.created_at
        const dateB = b.meeting_date ? new Date(b.meeting_date).getTime() : b.created_at
        return dateB - dateA // Newest first
      })
      setJobs(sortedJobs)
    } catch (error) {
      console.error('Failed to fetch jobs:', error)
    }
  }, [])

  // Load transcript for selected job
  const loadTranscript = useCallback(async (job: Job) => {
    if (!job.transcript_path) {
      setTranscript('')
      return
    }

    try {
      const response = await fetch(`/api/jobs/${job.id}/transcript`)
      if (response.ok) {
        const data = await response.json()
        setTranscript(data.transcript || '')
      }
    } catch (error) {
      console.error('Failed to load transcript:', error)
    }
  }, [])

  // Handle job selection with URL update
  const selectJob = useCallback((job: Job | null) => {
    const nextId = job?.id ?? null
    setSelectedJobId(nextId)
    if (nextId) {
      router.push(`/?job=${nextId}`)
    } else {
      router.push('/')
    }
  }, [router])

  // Load job from URL on mount and when jobs change
  useEffect(() => {
    const jobId = searchParams.get('job')
    if (jobId) {
      setSelectedJobId(prev => (prev === jobId ? prev : jobId))
      return
    }

    // Clear selection if the currently selected job no longer exists
    if (selectedJobId && !jobs.some(job => job.id === selectedJobId)) {
      setSelectedJobId(null)
    }
  }, [searchParams, jobs, selectedJobId])

  useEffect(() => {
    fetchJobs()
    const interval = setInterval(fetchJobs, 5000)
    return () => clearInterval(interval)
  }, [fetchJobs])

  // Load transcript when job is selected
  useEffect(() => {
    if (selectedJob) {
      loadTranscript(selectedJob)
      setShowTranscript(false) // Reset transcript toggle when switching jobs
    }
  }, [selectedJob, loadTranscript])

  const createJob = async () => {
    if (!url) return

    setLoading(true)
    try {
      const response = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })

      if (response.ok) {
        setUrl('')
        fetchJobs()
      }
    } catch (error) {
      console.error('Failed to create job:', error)
    } finally {
      setLoading(false)
    }
  }

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
      case 'error': return 'text-red-600'
      case 'queued': return 'text-gray-500'
      default: return 'text-blue-600'
    }
  }

  const getStatusIcon = (status: Job['status']) => {
    switch (status) {
      case 'completed': return '✓'
      case 'error': return '✗'
      case 'queued': return '⏳'
      case 'resolving': return '🔍'
      case 'downloading': return '⬇️'
      case 'transcribing': return '📝'
      case 'summarizing': return '📋'
      default: return '•'
    }
  }

  const formatDate = (meetingDate: string | undefined, fallback?: number) => {
    // Use meeting_date if available, otherwise use fallback (created_at)
    const dateToUse = meetingDate || (fallback ? new Date(fallback).toISOString() : null)
    if (!dateToUse) return 'Unknown date'

    const date = new Date(dateToUse)
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      year: 'numeric',
    })
  }


  // Mobile view - List of calls or single call detail
  if (isMobile && selectedJob) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        {/* Mobile Header */}
        <div className="bg-white border-b sticky top-0 z-10">
          <div className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => selectJob(null)}
                className="p-0 h-auto"
              >
                ← Back
              </Button>
            </div>
            <h2 className="text-lg font-semibold">
              {selectedJob.title || 'Meeting Details'}
            </h2>
            <p className="text-xs text-gray-500 mt-1">
              {formatDate(selectedJob.meeting_date, selectedJob.created_at)}
            </p>
            <span className={`text-xs ${getStatusColor(selectedJob.status)}`}>
              {getStatusIcon(selectedJob.status)} {selectedJob.status}
            </span>
          </div>
        </div>

        {/* Mobile Content */}
        <div className="flex-1 overflow-y-auto">
          {/* Actions */}
          {selectedJob.status === 'completed' && (
            <div className="p-4 bg-white border-b">
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

          {/* Transcript Section */}
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

          {/* Summary Section */}
          <div className="bg-white">
            <div className="p-4 border-b flex items-center justify-between">
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
            <div className="p-4">
              {selectedJob.summary ? (
                <div className="prose prose-sm prose-neutral max-w-none
                  prose-headings:text-gray-900 prose-headings:font-semibold
                  prose-h1:text-xl prose-h1:mb-3
                  prose-h2:text-lg prose-h2:mb-2
                  prose-h3:text-base prose-h3:mb-2
                  prose-p:text-gray-700 prose-p:leading-relaxed prose-p:mb-3
                  prose-ul:my-2 prose-li:my-1
                  prose-strong:text-gray-900 prose-strong:font-semibold">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {selectedJob.summary}
                  </ReactMarkdown>
                </div>
              ) : (
                <p className="text-gray-500">
                  {selectedJob.status === 'completed'
                    ? 'No summary available'
                    : 'Summary will appear here when ready'}
                </p>
              )}
            </div>
          </div>

          {/* Error message */}
          {selectedJob.error && (
            <div className="p-4 bg-red-50 text-red-600 text-sm">
              Error: {selectedJob.error}
            </div>
          )}
        </div>
      </div>
    )
  }

  // Mobile view - List of calls
  if (isMobile) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        {/* Mobile Header */}
        <div className="bg-white border-b sticky top-0 z-10">
          <div className="p-4">
            <h1 className="text-2xl font-bold mb-3">FocusFlow</h1>

            {/* Create new job */}
            <div className="flex gap-2">
              <Input
                type="url"
                placeholder="Enter Plaud.ai share link"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && createJob()}
                disabled={loading}
                className="flex-1"
              />
              <Button
                onClick={createJob}
                disabled={loading || !url}
                size="sm"
              >
                {loading ? '...' : 'Add'}
              </Button>
            </div>

            {/* Environment status */}
            <div className="mt-2 flex gap-3 text-xs">
              <span className={envStatus.assemblyai ? 'text-green-600' : 'text-red-600'}>
                AssemblyAI {envStatus.assemblyai ? '✓' : '✗'}
              </span>
              <span className={envStatus.openai ? 'text-green-600' : 'text-red-600'}>
                OpenAI {envStatus.openai ? '✓' : '✗'}
              </span>
            </div>
          </div>
        </div>

        {/* Jobs list */}
        <div className="flex-1 overflow-y-auto p-4">
          {jobs.length === 0 ? (
            <div className="text-center text-gray-500 py-12">
              <p className="text-lg mb-2">No calls yet</p>
              <p className="text-sm">Add a Plaud.ai link to get started</p>
            </div>
          ) : (
            <div className="space-y-3">
              {jobs.map((job) => (
                <Card
                  key={job.id}
                  className="p-4 cursor-pointer active:bg-gray-50"
                  onClick={() => selectJob(job)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">
                        {job.title || 'Untitled Meeting'}
                      </p>
                      <p className="text-sm text-gray-500 mt-1">
                        {formatDate(job.meeting_date, job.created_at)}
                      </p>
                      <p className={`text-sm mt-1 ${getStatusColor(job.status)}`}>
                        {job.status}
                      </p>
                    </div>
                    {job.status === 'error' && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={(e) => retryJob(job.id, e)}
                        className="shrink-0"
                      >
                        Retry
                      </Button>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  // Desktop view (original layout)
  return (
    <div className="flex h-screen bg-gray-50">
      {/* Left sidebar - Job list */}
      <div className="w-96 border-r bg-white flex flex-col">
        <div className="p-4 border-b">
          <h1 className="text-2xl font-bold mb-4">FocusFlow</h1>

          {/* Create new job */}
          <div className="flex gap-2">
            <Input
              type="url"
              placeholder="Enter Plaud.ai share link"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && createJob()}
              disabled={loading}
              className="flex-1"
            />
            <Button
              onClick={createJob}
              disabled={loading || !url}
            >
              {loading ? 'Processing...' : 'Add'}
            </Button>
          </div>

          {/* Environment status */}
          <div className="mt-3 flex gap-4 text-xs">
            <span className={envStatus.assemblyai ? 'text-green-600' : 'text-red-600'}>
              AssemblyAI {envStatus.assemblyai ? '✓' : '✗'}
            </span>
            <span className={envStatus.openai ? 'text-green-600' : 'text-red-600'}>
              OpenAI {envStatus.openai ? '✓' : '✗'}
            </span>
          </div>
        </div>

        {/* Jobs list */}
        <ScrollArea className="flex-1">
          <div className="p-2">
            {jobs.length === 0 ? (
              <p className="text-center text-gray-500 py-8">No jobs yet</p>
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
                        {job.title || 'Untitled Meeting'}
                      </p>
                      <p className="text-xs text-gray-500 mt-1">
                        {formatDate(job.meeting_date, job.created_at)}
                      </p>
                      <p className={`text-xs mt-1 ${getStatusColor(job.status)}`}>
                        {job.status}
                      </p>
                    </div>
                    {job.status === 'error' && (
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

      {/* Right side - Job details */}
      <div className="flex-1 flex flex-col">
        {selectedJob ? (
          <>
            {/* Header */}
            <div className="border-b bg-white px-6 py-5">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-2">
                  <h2 className="text-xl font-semibold text-gray-900">
                    {selectedJob.title || 'Meeting Details'}
                  </h2>
                  <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-gray-600">
                    <span className={getStatusColor(selectedJob.status)}>
                      Status: {selectedJob.status}
                    </span>
                    <span>{formatDate(selectedJob.meeting_date, selectedJob.created_at)}</span>
                  </div>
                  <p className="text-sm text-gray-500 break-all">
                    {selectedJob.url}
                  </p>
                  {selectedJob.error && (
                    <p className="text-sm text-red-600">
                      Error: {selectedJob.error}
                    </p>
                  )}
                </div>

                {selectedJob.status === 'completed' && transcript && (
                  <button
                    onClick={() => resummarizeJob(selectedJob.id)}
                    className="inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700"
                  >
                    🔄 Resummarize
                  </button>
                )}
              </div>
            </div>

            {/* Content area */}
            <div className="flex-1 flex flex-col overflow-y-auto">
              {/* Transcript toggle */}
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

              {/* Summary */}
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
              <p className="text-xl mb-2">Select a job to view details</p>
              <p className="text-sm">Create a new job or select one from the list</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
  const summaryComponents = useMemo(() => ({
    h1: ({ node, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
      <h1 className="mt-10 text-2xl font-semibold leading-tight text-gray-900" {...props} />
    ),
    h2: ({ node, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
      <h2 className="mt-8 text-xl font-semibold leading-tight text-gray-900" {...props} />
    ),
    h3: ({ node, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
      <h3 className="mt-6 text-lg font-semibold leading-snug text-gray-900" {...props} />
    ),
    p: ({ node, children, ...props }: React.HTMLAttributes<HTMLParagraphElement>) => {
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
    strong: ({ node, ...props }: React.HTMLAttributes<HTMLElement>) => (
      <strong className="font-semibold text-gray-900" {...props} />
    ),
    ul: ({ node, ...props }: React.HTMLAttributes<HTMLUListElement>) => (
      <ul className="list-disc space-y-3 pl-6 text-base leading-relaxed text-gray-700 md:text-lg md:leading-8" {...props} />
    ),
    ol: ({ node, ...props }: React.HTMLAttributes<HTMLOListElement>) => (
      <ol className="list-decimal space-y-3 pl-6 text-base leading-relaxed text-gray-700 md:text-lg md:leading-8" {...props} />
    ),
    li: ({ node, ...props }: React.HTMLAttributes<HTMLLIElement>) => (
      <li className="leading-relaxed" {...props} />
    ),
    blockquote: ({ node, ...props }: React.HTMLAttributes<HTMLQuoteElement>) => (
      <blockquote className="border-l-4 border-gray-300 pl-4 italic text-gray-600" {...props} />
    ),
    table: ({ node, ...props }: React.HTMLAttributes<HTMLTableElement>) => (
      <table className="w-full text-sm text-gray-700" {...props} />
    ),
    th: ({ node, ...props }: React.HTMLAttributes<HTMLTableCellElement>) => (
      <th className="border-b border-gray-200 px-3 py-2 text-left font-semibold" {...props} />
    ),
    td: ({ node, ...props }: React.HTMLAttributes<HTMLTableCellElement>) => (
      <td className="border-b border-gray-100 px-3 py-2 align-top" {...props} />
    ),
    code: ({ node, inline, className, children, ...props }: React.HTMLAttributes<HTMLElement> & { inline?: boolean }) => (
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
