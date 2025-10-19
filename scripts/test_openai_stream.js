// Tests streaming chat.completions with SSE parsing
require('dotenv').config()
const { fetch } = require('undici')

async function main() {
  const apiKey = process.env.OPENAI_API_KEY
  const base = (process.env.MODELSCOPE_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.openai.com').replace(/\/$/, '')
  const model = process.env.MODELSCOPE_MODEL_ID || process.env.OPENAI_MODEL || 'gpt-4o-mini'
  if (!apiKey) {
    console.error('OPENAI_API_KEY is required')
    process.exit(1)
  }

  const url = base + '/chat/completions'
  console.log('Streaming test:', url, 'model=', model)
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: 'You are a helpful assistant that replies concisely.' },
        { role: 'user', content: 'Say the word: stream-ok (nothing else).' },
      ],
      temperature: 0,
      stream: true,
    }),
  })

  console.log('Status:', res.status)
  if (!res.ok) {
    console.log('Error:', await res.text())
    process.exit(1)
  }

  const reader = res.body?.getReader()
  if (!reader) throw new Error('No body reader')
  const decoder = new TextDecoder()
  let buffer = ''
  let received = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const data = line.slice(6).trim()
      if (!data || data === '[DONE]') continue
      try {
        const json = JSON.parse(data)
        const text = json.choices?.[0]?.delta?.content
        if (typeof text === 'string') {
          received += text
        }
      } catch {}
    }
  }

  const out = received.trim()
  console.log('Streamed text:', out)
  if (!out.includes('stream-ok')) {
    console.error('Did not receive expected token in stream output')
    process.exit(2)
  }
}

main().catch(err => {
  console.error('Stream test failed:', err)
  process.exit(1)
})

