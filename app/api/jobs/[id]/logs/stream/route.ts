import { getJobQueue } from '@/lib/queue'
import { enforceRateLimit } from '@/lib/server/security'
import type { NextRequest } from 'next/server'

export const runtime = 'nodejs'

type RouteParams = { id: string }

// GET /api/jobs/[id]/logs/stream - SSE stream of job logs
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<RouteParams> }
) {
  const limited = enforceRateLimit(request)
  if (limited) return limited

  const { id: jobId } = await params
  const queue = getJobQueue()
  const job = await queue.getStore().getJob(jobId)

  if (!job) {
    return new Response('Job not found', { status: 404 })
  }

  // Create SSE stream
  const encoder = new TextEncoder()
  const stream = new TransformStream()
  const writer = stream.writable.getWriter()

  // Set up SSE headers
  const response = new Response(stream.readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable Nginx buffering
    },
  })

  // Send initial logs
  const sendEvent = async (
    data: Record<string, unknown>,
    eventType: string = 'message'
  ): Promise<void> => {
    const event = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`
    await writer.write(encoder.encode(event))
  }

  // Send existing logs
  let lastLogIndex = 0
  for (const log of job.logs) {
    await sendEvent({ message: log, ts: Date.now() })
    lastLogIndex++
  }

  // Watch for log file changes
  let watchInterval: NodeJS.Timeout | null = null
  let heartbeatInterval: NodeJS.Timeout | null = null
  let closed = false

  const cleanup = () => {
    if (closed) return
    if (watchInterval) clearInterval(watchInterval)
    if (heartbeatInterval) clearInterval(heartbeatInterval)
    closed = true
    writer.close().catch(() => {})
  }

  // Watch for new log entries (polling approach for simplicity)
  watchInterval = setInterval(() => {
    void (async () => {
      try {
        const updatedJob = await queue.getStore().getJob(jobId)
        if (!updatedJob) {
          cleanup()
          return
        }

        const newLogs = updatedJob.logs.slice(lastLogIndex)
        for (const log of newLogs) {
          await sendEvent({ message: log, ts: Date.now() })
          lastLogIndex++
        }

        if (updatedJob.status === 'completed' || updatedJob.status === 'error') {
          await sendEvent({ status: updatedJob.status }, 'status')
          cleanup()
        }
      } catch (error) {
        console.error('Error in log stream:', error)
        cleanup()
      }
    })()
  }, 500)

  // Send heartbeat every 30 seconds to keep connection alive
  heartbeatInterval = setInterval(() => {
    void (async () => {
      try {
        await writer.write(encoder.encode(': heartbeat\n\n'))
      } catch {
        cleanup()
      }
    })()
  }, 30000)

  // Clean up on client disconnect
  request.signal.addEventListener('abort', cleanup)

  return response
}
