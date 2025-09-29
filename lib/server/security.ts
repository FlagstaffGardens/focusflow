import { NextRequest, NextResponse } from 'next/server'

const DEFAULT_WINDOW_MS = 60_000
const DEFAULT_MAX_REQUESTS = 60

const windowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '', 10)
const maxRequests = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '', 10)

const RATE_LIMIT_WINDOW_MS = Number.isFinite(windowMs) && windowMs > 0 ? windowMs : DEFAULT_WINDOW_MS
const RATE_LIMIT_MAX_REQUESTS = Number.isFinite(maxRequests) && maxRequests > 0 ? maxRequests : DEFAULT_MAX_REQUESTS

interface RateBucket {
  count: number
  expiresAt: number
}

const buckets = new Map<string, RateBucket>()

function clientKey(request: NextRequest): string {
  const headerKeys = [
    'x-forwarded-for',
    'x-real-ip',
    'cf-connecting-ip',
    'true-client-ip',
  ] as const

  for (const header of headerKeys) {
    const value = request.headers.get(header)
    if (value) {
      const ip = value.split(',')[0]?.trim()
      if (ip) return ip
    }
  }

  // NextRequest doesn't expose remote IP in every runtime; fall back to a constant key.
  return 'local'
}

export function enforceRateLimit(request: NextRequest): NextResponse | null {
  if (RATE_LIMIT_MAX_REQUESTS <= 0) {
    return null
  }

  const key = clientKey(request)
  const now = Date.now()
  const bucket = buckets.get(key)

  if (!bucket || bucket.expiresAt <= now) {
    buckets.set(key, { count: 1, expiresAt: now + RATE_LIMIT_WINDOW_MS })
    return null
  }

  if (bucket.count >= RATE_LIMIT_MAX_REQUESTS) {
    return NextResponse.json({ error: 'Too Many Requests' }, { status: 429 })
  }

  bucket.count += 1
  return null
}
