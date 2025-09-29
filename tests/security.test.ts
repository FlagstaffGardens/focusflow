import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

function createRequest(ip: string) {
  return new NextRequest('http://localhost/api/test', {
    headers: {
      'x-forwarded-for': ip,
    },
  })
}

describe('enforceRateLimit', () => {
  const originalWindow = process.env.RATE_LIMIT_WINDOW_MS
  const originalMax = process.env.RATE_LIMIT_MAX_REQUESTS

  beforeEach(() => {
    process.env.RATE_LIMIT_WINDOW_MS = '1000'
    process.env.RATE_LIMIT_MAX_REQUESTS = '2'
    vi.resetModules()
  })

  afterEach(() => {
    process.env.RATE_LIMIT_WINDOW_MS = originalWindow
    process.env.RATE_LIMIT_MAX_REQUESTS = originalMax
  })

  it('returns 429 after the threshold is exceeded', async () => {
    const { enforceRateLimit } = await import('@/lib/server/security')

    const req = createRequest('203.0.113.1')
    expect(enforceRateLimit(req)).toBeNull()
    expect(enforceRateLimit(req)).toBeNull()
    const limited = enforceRateLimit(req)
    expect(limited?.status).toBe(429)
  })

  it('tracks rate limits per IP', async () => {
    const { enforceRateLimit } = await import('@/lib/server/security')

    const first = createRequest('203.0.113.2')
    const second = createRequest('203.0.113.3')

    expect(enforceRateLimit(first)).toBeNull()
    expect(enforceRateLimit(second)).toBeNull()
    expect(enforceRateLimit(first)).toBeNull()
    // second IP still under limit
    expect(enforceRateLimit(second)).toBeNull()
  })
})
