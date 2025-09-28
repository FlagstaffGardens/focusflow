import { fetch } from 'undici'
import { LogFunction } from '../plaud/resolver'
import { readFileSync } from 'fs'
import path from 'path'

export interface OpenAIConfig {
  apiKey: string
  baseUrl?: string
  model?: string
}

/**
 * Summarize transcript using OpenAI-compatible API
 * Uses /openai/v1/responses endpoint with streaming
 * Following the contract in doc/ai_endpoints.md
 */
export async function* summarizeWithGPT(
  transcript: string,
  meetingDate: string,
  config: OpenAIConfig,
  log: LogFunction
): AsyncGenerator<string, string, unknown> {
  const { apiKey, baseUrl = 'https://api.openai.com', model = 'gpt-4' } = config

  if (!apiKey) {
    log('OPENAI_API_KEY not set → skipping summarization')
    return ''
  }

  // Load and render prompt template
  const promptTemplate = loadPromptTemplate()
  const renderedPrompt = promptTemplate
    .replace('{{transcript}}', transcript)
    .replace('{{meeting_date}}', meetingDate)

  log('Calling GPT for summary...')

  const response = await fetch(`${baseUrl}/v1/responses`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: [
        {
          type: 'message',
          role: 'user',
          content: `You are an expert meeting analyst and technical program manager. Produce clear, executive-ready meeting summaries.\n\n${renderedPrompt}`,
        },
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

  // Process streaming response (Codex-style format)
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
      if (line.startsWith('data: ')) {
        const data = line.slice(6).trim()
        if (!data || data === '[DONE]') {
          continue
        }

        try {
          const event = JSON.parse(data)

          // Look for Codex-style output text events
          if (event.type === 'response.output_text.delta') {
            const text = event.text
            if (text) {
              fullText += text
              yield text
            }
          } else if (event.type === 'response.output_text.done') {
            // Final text output
            const text = event.text
            if (text && !fullText.includes(text)) {
              fullText = text
              yield text
            }
          } else if (event.type === 'response.content_part.delta') {
            // Alternative delta format
            const text = event.part?.text
            if (text) {
              fullText += text
              yield text
            }
          }
        } catch (e) {
          // Skip invalid JSON chunks
        }
      }
    }
  }

  log('Summary generation complete')
  return fullText
}

function loadPromptTemplate(): string {
  try {
    const promptPath = process.env.PROMPT_PATH || 'prompts/meeting_summary.md'
    const absolutePath = path.resolve(process.cwd(), promptPath)
    return readFileSync(absolutePath, 'utf-8')
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
  const { apiKey, baseUrl = 'https://api.openai.com', model = 'gpt-4' } = config

  if (!apiKey) {
    return extractTitleFromSummary(summary)
  }

  try {
    // Load title generator prompt
    const promptPath = process.env.PROMPT_PATH?.replace('meeting_summary.md', 'title_generator.md')
      || path.resolve(process.cwd(), '../../prompts/title_generator.md')
    let titlePrompt = ''
    try {
      titlePrompt = readFileSync(promptPath, 'utf-8')
    } catch (e) {
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

    const response = await fetch(`${baseUrl}/v1/responses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        input: [
          {
            type: 'message',
            role: 'user',
            content: renderedPrompt,
          },
        ],
        temperature: 0.2,
        stream: true,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      log(`Title API error: ${response.status} - ${error.slice(0, 200)}`)
      throw new Error(`Title API failed: ${response.status}`)
    }

    // Process streaming response
    let fullTitle = ''
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
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim()
          if (!data || data === '[DONE]') continue

          try {
            const event = JSON.parse(data)
            if (event.type === 'response.output_text.delta') {
              fullTitle += event.text || ''
            } else if (event.type === 'response.output_text.done') {
              fullTitle = event.text || fullTitle
            } else if (event.type === 'response.content_part.delta') {
              fullTitle += event.part?.text || ''
            }
          } catch (e) {
            // Skip invalid JSON
          }
        }
      }
    }

    const title = fullTitle.trim().slice(0, 50)
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