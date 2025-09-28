import { fetch } from 'undici'

export type LogFunction = (message: string) => void

export interface PlaudMetadata {
  audioUrl: string
  meetingDate?: string
  title?: string
}

/**
 * Resolve a Plaud share URL to a direct audio URL and extract metadata
 * Tries multiple strategies in order:
 * 1. temp_url API
 * 2. share-content API
 * 3. HTML page parsing
 * 4. Returns original URL as fallback
 */
export async function resolvePlaudAudioUrl(
  url: string,
  log: LogFunction
): Promise<PlaudMetadata> {
  if (!url.includes('plaud.ai')) {
    return { audioUrl: url }
  }

  log('Resolving Plaud link...')

  const normalizedHtmlUrl = normalizePlaudShareHtmlUrl(url)
  if (normalizedHtmlUrl !== url) {
    log(`Normalized Plaud URL for HTML fetch → ${normalizedHtmlUrl}`)
  }

  // Extract token from URL
  const tokenMatch = url.match(/\/share\/([0-9a-zA-Z]+)/)
  const token = tokenMatch?.[1]

  // First, fetch the HTML page to extract meeting date AND keep it for later parsing if needed
  let meetingDate: string | undefined
  let htmlContent: string | undefined
  try {
    log(`Fetching HTML page to extract meeting date...`)
    const response = await fetch(normalizedHtmlUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    })

    if (response.ok) {
      htmlContent = await response.text()
      const titleMatch = htmlContent.match(/<title>([^<]+)<\/title>/i)
      log(`Title found: ${titleMatch ? titleMatch[1] : 'none'}`)

      if (titleMatch) {
        // Try to parse date from title like "2025-09-25 20:05:39"
        const dateMatch = titleMatch[1].match(/(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})/)
        if (dateMatch) {
          // Parse the date properly - assuming it's in local time
          const [datePart, timePart] = dateMatch[1].split(' ')
          meetingDate = new Date(`${datePart}T${timePart}`).toISOString()
          log(`Meeting date extracted from title: ${meetingDate}`)
        } else {
          log(`No date pattern found in title`)
        }
      }
    }
  } catch (error) {
    log(`Failed to extract meeting date: ${error}`)
  }

  if (token) {
    // Try temp API first
    try {
      const tempUrl = `https://api.plaud.ai/file/share-file-temp/${token}`
      const response = await fetch(tempUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
      })

      if (response.ok) {
        const text = await response.text()

        // Try to parse as JSON
        try {
          const data = JSON.parse(text)
          const keys = ['temp_url', 'url', 'fileUrl', 'audioUrl', 'downloadUrl']
          for (const key of keys) {
            const val = data[key]
            if (typeof val === 'string' && val.startsWith('http')) {
              log(`Plaud API resolved (temp) → ${val}`)
              return { audioUrl: val, meetingDate }
            }
          }
        } catch {
          // Not JSON, try regex
          const match = text.match(/https?:\/\/[^"'\s]+\.(?:mp3|m4a|wav)(?:\?[^"'\s]*)?/)
          if (match) {
            log(`Plaud API resolved (regex) → ${match[0]}`)
            return { audioUrl: match[0], meetingDate }
          }
        }
      }
    } catch (error) {
      log(`Plaud temp API failed: ${error}`)
    }

    // Try content API
    try {
      const contentUrl = `https://api.plaud.ai/file/share-content/${token}`
      const response = await fetch(contentUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
      })

      if (response.ok) {
        const data = await response.json() as any
        const content = data.data || data

        // Extract meeting date if available (only if we don't already have one from HTML)
        if (!meetingDate) {
          if (content.createTime) {
            meetingDate = new Date(content.createTime).toISOString()
            log(`Meeting date extracted from API: ${meetingDate}`)
          } else if (content.timestamp) {
            meetingDate = new Date(content.timestamp).toISOString()
            log(`Meeting date extracted from API: ${meetingDate}`)
          }
        }

        const keys = ['fileUrl', 'audioUrl', 'url']
        for (const key of keys) {
          if (content[key] && typeof content[key] === 'string') {
            log(`Plaud content API resolved → ${content[key]}`)
            return {
              audioUrl: content[key],
              meetingDate,
              title: content.title || content.name
            }
          }
        }
      }
    } catch (error) {
      log(`Plaud content API failed: ${error}`)
    }
  }

  // Fallback: parse HTML content for audio URLs (we already have the HTML from earlier)
  if (htmlContent) {
    try {
      // Look for direct audio links
      const audioLinks = htmlContent.matchAll(/https?:\/\/[^'"\s]+\.(?:mp3|m4a|wav)\b/gi)
      for (const match of audioLinks) {
        log(`Plaud resolved (html) → ${match[0]}`)
        return { audioUrl: match[0], meetingDate }
      }

      // Look for __NEXT_DATA__ JSON
      const nextDataMatch = htmlContent.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/si)
      if (nextDataMatch) {
        try {
          const data = JSON.parse(nextDataMatch[1])
          // Extract meeting date from Next.js data (only if we don't have one already)
          const pageProps = data?.props?.pageProps
          if (!meetingDate) {
            if (pageProps?.createTime) {
              meetingDate = new Date(pageProps.createTime).toISOString()
              log(`Meeting date extracted from Next.js data: ${meetingDate}`)
            } else if (pageProps?.timestamp) {
              meetingDate = new Date(pageProps.timestamp).toISOString()
              log(`Meeting date extracted from Next.js data: ${meetingDate}`)
            }
          }

          const audioUrl = findAudioUrlInObject(data)
          if (audioUrl) {
            log(`Plaud resolved (next) → ${audioUrl}`)
            return { audioUrl, meetingDate, title: pageProps?.title || pageProps?.name }
          }
        } catch {
          // Ignore JSON parse errors
        }
      }

      // Look for JSON audio URLs in HTML
      const jsonUrls = htmlContent.matchAll(/"(audioUrl|audio_url|url|source|src)"\s*:\s*"(https?:\/\/[^"]+)"/gi)
      for (const [, , candidate] of jsonUrls) {
        const url = candidate.replace(/\\u002F/g, '/')
        if (/\.(mp3|m4a|wav)$/i.test(url)) {
          log(`Plaud resolved (json) → ${url}`)
          return { audioUrl: url, meetingDate }
        }
      }
    } catch (error) {
      log(`HTML parsing error: ${error}`)
    }
  }

  log('Plaud resolution failed; using original URL')
  return { audioUrl: url, meetingDate }
}

function findAudioUrlInObject(obj: any): string | null {
  if (typeof obj === 'string') {
    const decoded = obj.replace(/\\u002F/g, '/')
    if (/^https?:\/\/.*\.(mp3|m4a|wav)(\?.*)?$/i.test(decoded)) {
      return decoded
    }
  } else if (Array.isArray(obj)) {
    for (const item of obj) {
      const result = findAudioUrlInObject(item)
      if (result) return result
    }
  } else if (obj && typeof obj === 'object') {
    for (const value of Object.values(obj)) {
      const result = findAudioUrlInObject(value)
      if (result) return result
    }
  }
  return null
}

function normalizePlaudShareHtmlUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl)

    if (parsed.hostname.endsWith('plaud.ai') && parsed.hostname !== 'web.plaud.ai') {
      // Share links often use share.plaud.ai which does not resolve in Node.
      parsed.hostname = 'web.plaud.ai'
    }

    return parsed.toString()
  } catch {
    // Fallback in case URL parsing fails for some reason.
    return rawUrl.replace(/^https?:\/\/share\.plaud\.ai/i, 'https://web.plaud.ai')
  }
}
