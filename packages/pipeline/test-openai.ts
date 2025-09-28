import { summarizeWithGPT } from './src/openai/client'
import { readFileSync } from 'fs'

async function test() {
  const transcript = readFileSync('/Users/ethan/code/focusflow/apps/web/data/test-transcript.txt', 'utf-8')

  const config = {
    apiKey: process.env.OPENAI_API_KEY || 'cr_9d03dab2234d0d9a5715e140f371a508fd77cc671e6034007bf7ce6861a75942',
    baseUrl: process.env.OPENAI_BASE_URL || 'https://20250731.xyz/openai',
    model: process.env.OPENAI_MODEL || 'gpt-5',
  }

  console.log('Testing OpenAI API with config:', { baseUrl: config.baseUrl, model: config.model })
  console.log('Transcript length:', transcript.length, 'chars')
  console.log('---')

  try {
    let fullSummary = ''
    for await (const chunk of summarizeWithGPT(transcript, '2025-09-28', config, console.log)) {
      process.stdout.write(chunk)
      fullSummary += chunk
    }
    console.log('\n---')
    console.log('Summary complete, length:', fullSummary.length)
  } catch (error) {
    console.error('Error:', error)
  }
}

test()