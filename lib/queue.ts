import { SimpleJobQueue } from '@/lib/pipeline'

let queue: SimpleJobQueue | null = null

export function getJobQueue(): SimpleJobQueue {
  if (!queue) {
    queue = new SimpleJobQueue({
      dataDir: process.env.DATA_DIR || 'data',
      assemblyAiApiKey: process.env.ASSEMBLYAI_API_KEY,
      openAiConfig: {
        apiKey: process.env.MODELSCOPE_API_KEY || process.env.OPENAI_API_KEY || '',
        baseUrl: process.env.MODELSCOPE_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.openai.com',
        model: process.env.MODELSCOPE_MODEL_ID || process.env.OPENAI_MODEL || 'gpt-4',
      },
    })
  }
  return queue
}
