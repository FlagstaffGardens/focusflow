// Simple endpoint test for OpenAI-compatible chat completions
// Env precedence:
//   - API key: OPENAI_API_KEY (required)
//   - Base URL: MODELSCOPE_BASE_URL || OPENAI_BASE_URL || https://api.openai.com/v1
//   - Model: MODELSCOPE_MODEL_ID || OPENAI_MODEL || gpt-4o-mini
require('dotenv').config()
const { fetch } = require('undici')

async function main() {
  const apiKey = process.env.OPENAI_API_KEY
  const base = process.env.MODELSCOPE_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'
  const model = process.env.MODELSCOPE_MODEL_ID || process.env.OPENAI_MODEL || 'gpt-4o-mini'

  if (!apiKey) {
    console.error('OPENAI_API_KEY is required')
    process.exit(1)
  }

  const url = base.replace(/\/$/, '') + '/chat/completions'
  const body = {
    model,
    messages: [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Reply with exactly: ok' },
    ],
    temperature: 0,
    stream: false,
  }

  console.log('Testing:', url, 'model=', model)
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  })

  console.log('Status:', res.status)
  const text = await res.text()
  try {
    const json = JSON.parse(text)
    const content = json.choices?.[0]?.message?.content?.trim()
    console.log('Content:', content)
  } catch {
    console.log('Raw response:', text.slice(0, 500))
  }
}

main().catch(e => {
  console.error('Test failed:', e)
  process.exit(1)
})

