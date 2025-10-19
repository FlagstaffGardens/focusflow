import { NextRequest, NextResponse } from 'next/server'
import { enforceRateLimit } from '@/lib/server/security'

export const runtime = 'nodejs'

// GET /api/health - Health check endpoint
export async function GET(request: NextRequest) {
  const limited = enforceRateLimit(request)
  if (limited) return limited

  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    env: {
      assemblyai: !!process.env.ASSEMBLYAI_API_KEY,
      openai: !!(process.env.MODELSCOPE_API_KEY || process.env.OPENAI_API_KEY),
      dataDir: process.env.DATA_DIR || 'data',
    },
  }

  return NextResponse.json(health)
}
