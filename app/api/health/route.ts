import { NextResponse } from 'next/server'

// GET /api/health - Health check endpoint
export async function GET() {
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    env: {
      assemblyai: !!process.env.ASSEMBLYAI_API_KEY,
      openai: !!process.env.OPENAI_API_KEY,
      dataDir: process.env.DATA_DIR || 'data',
    },
  }

  return NextResponse.json(health)
}