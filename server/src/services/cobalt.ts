/**
 * cobalt.tools API integration — fast YouTube / social media downloader
 * Docs: https://github.com/imputnet/cobalt
 *
 * Tries community instances first (no auth required), then falls back to
 * api.cobalt.tools (which requires JWT). If COBALT_API_URL is set in .env,
 * that instance is tried first.
 */

import fs from 'fs'
import path from 'path'
import { pipeline } from 'stream/promises'
import { Readable } from 'stream'

// Community instances that historically don't require auth.
// The primary api.cobalt.tools instance requires JWT (Turnstile) — skip it.
const COBALT_INSTANCES: string[] = [
  ...(process.env.COBALT_API_URL ? [process.env.COBALT_API_URL.replace(/\/$/, '')] : []),
  'https://cobalt.api.li',
  'https://cobalt.7tv.app',
  'https://capi.oak.lgbt',
  'https://cobalt.synzr.space',
  // api.cobalt.tools last — requires JWT auth, will fail without it
  'https://api.cobalt.tools',
]

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

/**
 * Try each cobalt instance in order. Skip instances that return auth errors.
 * Throws if all instances fail.
 */
async function cobaltRequest(body: CobaltRequest): Promise<CobaltResponse> {
  let lastError = ''
  for (const base of COBALT_INSTANCES) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 30_000)
    try {
      const res = await fetch(`${base}/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        // Auth errors → skip to next instance
        if (text.includes('auth.jwt') || text.includes('auth.api_key') || res.status === 401) {
          lastError = `${base}: auth required (${res.status})`
          continue
        }
        lastError = `${base}: HTTP ${res.status}`
        continue
      }
      const data = await res.json() as CobaltResponse
      // Auth error in JSON body → skip to next instance
      if (data.status === 'error' && data.error?.code?.includes('auth')) {
        lastError = `${base}: ${data.error.code}`
        continue
      }
      return data
    } catch (e) {
      lastError = `${base}: ${String(e).slice(0, 80)}`
      // continue to next instance
    } finally {
      clearTimeout(timer)
    }
  }
  throw new Error(`All cobalt instances failed. Last error: ${lastError}`)
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
