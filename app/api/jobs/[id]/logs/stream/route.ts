import { getJobQueue } from '@/lib/queue'
import type { NextRequest } from 'next/server'

type RouteParams = { id: string }

// GET /api/jobs/[id]/logs/stream - SSE stream of job logs
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<RouteParams> }
) {
  const { id: jobId } = await params
  const queue = getJobQueue()
  const job = queue.getStore().getJob(jobId)

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

  const cleanup = () => {
    if (watchInterval) clearInterval(watchInterval)
    if (heartbeatInterval) clearInterval(heartbeatInterval)
    writer.close()
  }

  // Watch for new log entries (polling approach for simplicity)
  watchInterval = setInterval(async () => {
    try {
      const updatedJob = queue.getStore().getJob(jobId)
      if (!updatedJob) {
        cleanup()
        return
      }

      // Send new logs
      const newLogs = updatedJob.logs.slice(lastLogIndex)
      for (const log of newLogs) {
        await sendEvent({ message: log, ts: Date.now() })
        lastLogIndex++
      }

      // Check if job is complete
      if (updatedJob.status === 'completed' || updatedJob.status === 'error') {
        await sendEvent({ status: updatedJob.status }, 'status')
        cleanup()
      }
    } catch (error) {
      console.error('Error in log stream:', error)
      cleanup()
    }
  }, 500) // Poll every 500ms

  // Send heartbeat every 30 seconds to keep connection alive
  heartbeatInterval = setInterval(async () => {
    try {
      await writer.write(encoder.encode(': heartbeat\n\n'))
    } catch {
      cleanup()
    }
  }, 30000)

  // Clean up on client disconnect
  request.signal.addEventListener('abort', cleanup)

  return response
}
