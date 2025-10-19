import { fetch } from 'undici'
import { LogFunction } from '../plaud/resolver'
import { promises as fs } from 'fs'
import path from 'path'

export interface OpenAIConfig {
  apiKey: string
  baseUrl?: string
  model?: string
}

/**
 * Summarize transcript using OpenAI-compatible API
 * Uses OpenAI-compatible Chat Completions API with streaming
 * Following the contract in doc/ai_endpoints.md
 */
export async function* summarizeWithGPT(
  transcript: string,
  meetingDate: string,
  config: OpenAIConfig,
  log: LogFunction
): AsyncGenerator<string, string, unknown> {
  // Allow MODELSCOPE_* env overrides via config defaults
  const {
    apiKey,
    baseUrl = process.env.OPENAI_BASE_URL || process.env.MODELSCOPE_BASE_URL || 'https://api.openai.com',
    model = process.env.OPENAI_MODEL || process.env.MODELSCOPE_MODEL_ID || 'gpt-4'
  } = config

  if (!apiKey) {
    log('OPENAI_API_KEY not set → skipping summarization')
    return ''
  }

  // Load and render prompt template
  const promptTemplate = await loadPromptTemplate()
  const renderedPrompt = promptTemplate
    .replace('{{transcript}}', transcript)
    .replace('{{meeting_date}}', meetingDate)

  log('Calling GPT for summary...')

  const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: 'You are an expert meeting analyst and technical program manager. Produce clear, executive-ready meeting summaries.' },
        { role: 'user', content: renderedPrompt },
      ],
      temperature: 0.2,
      stream: true,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    log(`GPT API error: ${response.status} - ${error.slice(0, 200)}`)
    throw new Error(`GPT API failed: ${response.status}`)
  }

  // Process streaming response (OpenAI chat.completions SSE)
  let fullText = ''
  const decoder = new TextDecoder()
  const reader = response.body?.getReader()

  if (!reader) {
    throw new Error('No response body')
  }

  let buffer = ''

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
        const chunk = JSON.parse(data)
        const choice = chunk.choices && chunk.choices[0]
        const delta = choice && choice.delta
        const text = delta && delta.content
        if (typeof text === 'string' && text.length > 0) {
          fullText += text
          yield text
        }
      } catch {
        // ignore
      }
    }
  }

  log('Summary generation complete')
  return fullText
}

async function loadPromptTemplate(): Promise<string> {
  try {
    const promptPath = process.env.PROMPT_PATH || 'prompts/meeting_summary.md'
    const absolutePath = path.resolve(process.cwd(), promptPath)
    return await fs.readFile(absolutePath, 'utf-8')
  } catch (error) {
    console.error('Failed to load prompt template:', error)
    return `# Meeting Summary Request

## Transcript
{{transcript}}

## Meeting Date
{{meeting_date}}

Please provide a comprehensive summary of this meeting including:
- Executive summary
- Key discussion points
- Decisions made
- Action items with owners and due dates
- Open questions
- Next steps`
  }
}

/**
 * Generate a title for the meeting based on the summary
 */
export async function generateTitle(
  summary: string,
  config: OpenAIConfig,
  log: LogFunction
): Promise<string> {
  const {
    apiKey,
    baseUrl = process.env.OPENAI_BASE_URL || process.env.MODELSCOPE_BASE_URL || 'https://api.openai.com',
    model = process.env.OPENAI_MODEL || process.env.MODELSCOPE_MODEL_ID || 'gpt-4'
  } = config

  if (!apiKey) {
    return extractTitleFromSummary(summary)
  }

  try {
    // Load title generator prompt
    const promptPath =
      process.env.PROMPT_PATH?.replace('meeting_summary.md', 'title_generator.md') ||
      path.resolve(process.cwd(), 'prompts/title_generator.md')
    let titlePrompt = ''
    try {
      titlePrompt = await fs.readFile(promptPath, 'utf-8')
    } catch {
      log(`Failed to load title prompt, using default`)
      titlePrompt = `Generate a concise, descriptive title for this meeting.

## Requirements
- Maximum 50 characters
- Capture the main topic or purpose
- Be specific and actionable
- NO quotes, hashtags, or special formatting
- Return ONLY the title text

## Meeting Content
[The meeting transcript/summary will be inserted here]`
    }

    // Replace placeholder with summary
    const renderedPrompt = titlePrompt.replace(
      '[The meeting transcript/summary will be inserted here]',
      summary.slice(0, 2000)
    )

    const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: 'You generate concise, descriptive meeting titles.' },
          { role: 'user', content: renderedPrompt },
        ],
        temperature: 0.2,
        stream: false,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      log(`Title API error: ${response.status} - ${error.slice(0, 200)}`)
      throw new Error(`Title API failed: ${response.status}`)
    }

    const json: any = await response.json()
    const title = (json.choices?.[0]?.message?.content || '').trim().slice(0, 50)
    if (title) {
      log(`Generated title: ${title}`)
      return title
    }
  } catch (error) {
    log(`Title generation failed: ${error}`)
  }

  return extractTitleFromSummary(summary)
}

function extractTitleFromSummary(summary: string): string {
  // Extract first heading or first line as fallback
  const headingMatch = summary.match(/^#+\s+(.+)$/m)
  if (headingMatch) {
    return headingMatch[1].slice(0, 60)
  }

  const firstLine = summary.split('\n')[0]
  return firstLine.slice(0, 60) || 'Untitled Meeting'
}
