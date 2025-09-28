import { fetch } from 'undici'
import { createReadStream } from 'fs'
import { LogFunction } from '../plaud/resolver'

const BASE_URL = 'https://api.assemblyai.com/v2'

export interface TranscriptResult {
  text: string
  utterances?: Array<{
    speaker: string
    text: string
    start: number
    end: number
  }>
}

export async function transcribeWithAssemblyAI(
  filePath: string,
  apiKey: string,
  log: LogFunction
): Promise<TranscriptResult | null> {
  if (!apiKey) {
    log('ASSEMBLYAI_API_KEY not set → skipping transcription')
    return null
  }

  const headers = {
    authorization: apiKey,
  }

  // Upload file
  log('Uploading to AssemblyAI...')
  const fileStream = createReadStream(filePath)
  const uploadResponse = await fetch(`${BASE_URL}/upload`, {
    method: 'POST',
    headers,
    body: fileStream as any,
    duplex: 'half',
  } as any)

  if (!uploadResponse.ok) {
    throw new Error(`Upload failed: ${uploadResponse.status}`)
  }

  const { upload_url } = await uploadResponse.json() as { upload_url: string }

  // Create transcription job with speaker diarization
  log('Creating transcript job with speaker diarization...')
  const transcriptResponse = await fetch(`${BASE_URL}/transcript`, {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      audio_url: upload_url,
      speaker_labels: true,
      format_text: true,
    }),
  })

  if (!transcriptResponse.ok) {
    throw new Error(`Transcript creation failed: ${transcriptResponse.status}`)
  }

  const { id } = await transcriptResponse.json() as { id: string }

  // Poll for completion
  log(`Transcript ID: ${id} - processing...`)
  let status = 'processing'
  let result: any

  while (status === 'processing' || status === 'queued') {
    await new Promise(resolve => setTimeout(resolve, 2000))

    const pollResponse = await fetch(`${BASE_URL}/transcript/${id}`, {
      headers,
    })

    if (!pollResponse.ok) {
      throw new Error(`Poll failed: ${pollResponse.status}`)
    }

    result = await pollResponse.json()
    status = result.status

    if (status === 'processing' || status === 'queued') {
      log(`Transcript status: ${status}...`)
    }
  }

  if (status === 'error') {
    throw new Error(`Transcription failed: ${result.error}`)
  }

  log('Transcription complete')

  // Format transcript with speaker labels
  if (result.utterances && result.utterances.length > 0) {
    const formatted = formatTranscriptWithSpeakers(result.utterances)
    return {
      text: formatted,
      utterances: result.utterances,
    }
  }

  return {
    text: result.text || '',
    utterances: [],
  }
}

function formatTranscriptWithSpeakers(
  utterances: Array<{
    speaker: string
    text: string
    start: number
    end: number
  }>
): string {
  let formatted = ''
  let lastSpeaker = ''

  for (const utterance of utterances) {
    if (utterance.speaker !== lastSpeaker) {
      if (formatted) formatted += '\n\n'
      formatted += `[Speaker ${utterance.speaker}]:\n`
      lastSpeaker = utterance.speaker
    }
    formatted += `${utterance.text}\n`
  }

  return formatted
}