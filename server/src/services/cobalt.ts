/**
 * cobalt.tools API integration — fast YouTube / social media downloader
 * Docs: https://github.com/imputnet/cobalt
 * Public endpoint: https://api.cobalt.tools/
 *
 * No API key required. Falls back to yt-dlp if cobalt fails.
 */

import fs from 'fs'
import path from 'path'
import { pipeline } from 'stream/promises'
import { Readable } from 'stream'

const COBALT_API = process.env.COBALT_API_URL?.replace(/\/$/, '') ?? 'https://api.cobalt.tools'

type DownloadMode = 'auto' | 'audio' | 'mute'
type AudioFormat  = 'best' | 'mp3' | 'ogg' | 'wav' | 'opus'
type VideoQuality = '144' | '240' | '360' | '480' | '720' | '1080' | '1440' | '2160' | 'max'

interface CobaltRequest {
  url:            string
  videoQuality?:  VideoQuality
  audioFormat?:   AudioFormat
  downloadMode?:  DownloadMode
  filenameStyle?: 'classic' | 'pretty' | 'basic' | 'nerdy'
  youtubeDubLang?: string
  disableMetadata?: boolean
}

interface CobaltResponse {
  status:   'error' | 'redirect' | 'tunnel' | 'picker'
  url?:     string
  urls?:    string[]
  filename?: string
  error?:   { code: string; context?: Record<string, unknown> }
}

// ── Core request ──────────────────────────────────────────────────────────────

async function cobaltRequest(body: CobaltRequest): Promise<CobaltResponse> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30_000)

  try {
    const res = await fetch(`${COBALT_API}/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`Cobalt API HTTP ${res.status}: ${text.slice(0, 300)}`)
    }

    return res.json() as Promise<CobaltResponse>
  } finally {
    clearTimeout(timer)
  }
}

// ── Stream download URL → file ────────────────────────────────────────────────

async function fetchToFile(url: string, destPath: string): Promise<void> {
  fs.mkdirSync(path.dirname(destPath), { recursive: true })

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10 * 60_000) // 10-min cap

  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok || !res.body) throw new Error(`Stream download HTTP ${res.status}`)

    const fileStream = fs.createWriteStream(destPath)
    await pipeline(Readable.fromWeb(res.body as ReadableStream<Uint8Array>), fileStream)
  } finally {
    clearTimeout(timer)
  }
}

// ── Public helpers ────────────────────────────────────────────────────────────

/**
 * Download a video (best quality ≤ 1080p, merged MP4) to destPath.
 * destPath should end in .mp4.
 */
export async function downloadVideoViaCobalt(url: string, destPath: string): Promise<void> {
  const data = await cobaltRequest({
    url,
    videoQuality: '1080',
    downloadMode: 'auto',
    filenameStyle: 'basic',
    disableMetadata: true,
  })

  if (data.status === 'error') {
    throw new Error(`Cobalt: ${data.error?.code ?? 'unknown error'}`)
  }

  const dlUrl = data.url
  if (!dlUrl) {
    throw new Error(`Cobalt: status "${data.status}" — no direct URL returned`)
  }

  await fetchToFile(dlUrl, destPath)
}

/**
 * Download audio-only (MP3) to destPath.
 * destPath should end in .mp3.
 */
export async function downloadAudioViaCobalt(url: string, destPath: string): Promise<void> {
  const data = await cobaltRequest({
    url,
    downloadMode: 'audio',
    audioFormat: 'mp3',
    filenameStyle: 'basic',
    disableMetadata: true,
  })

  if (data.status === 'error') {
    throw new Error(`Cobalt: ${data.error?.code ?? 'unknown error'}`)
  }

  const dlUrl = data.url
  if (!dlUrl) {
    throw new Error(`Cobalt: status "${data.status}" — no direct URL returned`)
  }

  await fetchToFile(dlUrl, destPath)
}
