/**
 * Invidious API — open-source YouTube frontend that proxies streams
 * through its own servers. This bypasses YouTube IP blocks on the VPS.
 *
 * When ?local=true, Invidious proxies stream URLs through its own server,
 * so YouTube never sees the VPS IP.
 *
 * Docs: https://docs.invidious.io/api/
 */

import fs from 'fs'
import path from 'path'
import { spawn } from 'child_process'
import { pipeline } from 'stream/promises'
import { Readable } from 'stream'

// Public Invidious instances — tried in order, first success wins
const INVIDIOUS_INSTANCES = [
  'https://iv.datura.network',
  'https://invidious.privacydev.net',
  'https://inv.nadeko.net',
  'https://invidious.io.lol',
  'https://yt.cdaut.de',
]

// Public Piped instances — second-tier fallback when all Invidious instances fail.
// Piped is an independent YouTube proxy with different infrastructure.
// Stream URLs are proxied through Piped CDN nodes — the VPS IP is never exposed to YouTube.
const PIPED_INSTANCES = [
  'https://pipedapi.kavin.rocks',
  'https://pipedapi.in',
  'https://pipedapi.darkness.services',
  'https://pipedapi.moomoo.me',
]

interface InvidiousAdaptiveFormat {
  itag: string
  url: string
  type: string
  bitrate?: string
  container?: string
  audioQuality?: string
  audioSampleRate?: number
  audioChannels?: number
  qualityLabel?: string
  resolution?: string
}

interface InvidiousFormatStream {
  itag: string
  url: string
  type: string
  quality: string
  container?: string
  qualityLabel?: string
  resolution?: string
}

interface InvidiousVideoInfo {
  title: string
  videoId: string
  author: string
  lengthSeconds: number
  thumbnailUrl?: string
  adaptiveFormats: InvidiousAdaptiveFormat[]
  formatStreams: InvidiousFormatStream[]
}

const TIMEOUT_MS = 20_000

async function fetchJson<T>(url: string): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json() as Promise<T>
  } finally {
    clearTimeout(timer)
  }
}

async function fetchVideoInfo(videoId: string): Promise<InvidiousVideoInfo> {
  const fields = 'title,videoId,author,lengthSeconds,videoThumbnails,adaptiveFormats,formatStreams'
  for (const instance of INVIDIOUS_INSTANCES) {
    try {
      const data = await fetchJson<InvidiousVideoInfo & { videoThumbnails?: { url: string; quality: string }[] }>(
        `${instance}/api/v1/videos/${videoId}?local=true&fields=${fields}`,
      )
      // Attach best thumbnail
      const thumb = data.videoThumbnails?.find(t => t.quality === 'maxres')
        ?? data.videoThumbnails?.find(t => t.quality === 'sddefault')
        ?? data.videoThumbnails?.[0]
      if (thumb) data.thumbnailUrl = thumb.url
      return data
    } catch {
      // Try next instance
    }
  }
  // All Invidious instances failed — try Piped (independent proxy infrastructure)
  return fetchPipedVideoInfo(videoId)
}

interface PipedVideoInfo {
  title: string
  uploader: string
  duration: number
  thumbnailUrl: string
  audioStreams: Array<{ url: string; mimeType: string; quality: string; bitrate: number }>
  videoStreams: Array<{ url: string; mimeType: string; quality: string; videoOnly: boolean; bitrate: number }>
}

async function fetchPipedVideoInfo(videoId: string): Promise<InvidiousVideoInfo> {
  for (const instance of PIPED_INSTANCES) {
    try {
      const data = await fetchJson<PipedVideoInfo>(`${instance}/streams/${videoId}`)

      // Convert Piped audio streams → Invidious adaptiveFormats (audio)
      const audioAdaptive: InvidiousAdaptiveFormat[] = data.audioStreams.map(s => ({
        itag: '',
        url: s.url,
        type: s.mimeType,
        bitrate: s.bitrate.toString(),
        container: s.mimeType.includes('mp4') ? 'm4a' : 'webm',
        audioQuality: s.quality,
      }))

      // Convert Piped video-only streams → Invidious adaptiveFormats (video)
      const videoAdaptive: InvidiousAdaptiveFormat[] = data.videoStreams
        .filter(s => s.videoOnly)
        .map(s => ({
          itag: '',
          url: s.url,
          type: s.mimeType,
          container: s.mimeType.includes('mp4') ? 'mp4' : 'webm',
          qualityLabel: s.quality,
          resolution: s.quality,
        }))

      // Convert Piped combined streams (video+audio) → Invidious formatStreams
      const formatStreams: InvidiousFormatStream[] = data.videoStreams
        .filter(s => !s.videoOnly)
        .map(s => ({
          itag: '',
          url: s.url,
          type: s.mimeType,
          quality: s.quality,
          container: s.mimeType.includes('mp4') ? 'mp4' : 'webm',
          qualityLabel: s.quality,
        }))

      return {
        title: data.title,
        videoId,
        author: data.uploader,
        lengthSeconds: data.duration,
        thumbnailUrl: data.thumbnailUrl,
        adaptiveFormats: [...audioAdaptive, ...videoAdaptive],
        formatStreams,
      }
    } catch {
      // Try next instance
    }
  }
  throw new Error('All Invidious and Piped instances failed to return video info')
}

async function downloadUrl(url: string, destPath: string): Promise<void> {
  fs.mkdirSync(path.dirname(destPath), { recursive: true })
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15 * 60_000)
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok || !res.body) throw new Error(`Stream download HTTP ${res.status}`)
    const fileStream = fs.createWriteStream(destPath)
    await pipeline(Readable.fromWeb(res.body as ReadableStream<Uint8Array>), fileStream)
  } finally {
    clearTimeout(timer)
  }
}

/** Metadata for resolve-social (no download) */
export async function getInvidiousMeta(url: string): Promise<{
  id: string; title: string; uploader: string; thumbnail?: string; duration?: number; webpage_url: string
}> {
  const m = url.match(/(?:v=|youtu\.be\/|\/shorts\/|\/embed\/)([A-Za-z0-9_-]{11})/)
  if (!m) throw new Error('Could not extract YouTube video ID')
  const videoId = m[1]
  const info = await fetchVideoInfo(videoId)
  return {
    id: videoId,
    title: info.title,
    uploader: info.author,
    thumbnail: info.thumbnailUrl,
    duration: info.lengthSeconds,
    webpage_url: `https://www.youtube.com/watch?v=${videoId}`,
  }
}

/**
 * Download audio as MP3 via Invidious proxy.
 * Finds best audio-only stream, downloads m4a/webm, converts to MP3 with ffmpeg.
 */
export async function downloadAudioViaInvidious(url: string, destMp3Path: string): Promise<void> {
  const m = url.match(/(?:v=|youtu\.be\/|\/shorts\/|\/embed\/)([A-Za-z0-9_-]{11})/)
  if (!m) throw new Error('Could not extract YouTube video ID')
  const videoId = m[1]
  const info = await fetchVideoInfo(videoId)

  // Best audio-only adaptive format (highest bitrate)
  const audioFormats = info.adaptiveFormats
    .filter(f => f.type.startsWith('audio/'))
    .sort((a, b) => Number(b.bitrate ?? 0) - Number(a.bitrate ?? 0))

  if (!audioFormats.length) throw new Error('No audio formats found via Invidious')

  const best = audioFormats[0]
  const ext = best.container ?? (best.type.includes('webm') ? 'webm' : 'm4a')
  const tmpPath = destMp3Path.replace(/\.mp3$/i, `.${ext}`)

  await downloadUrl(best.url, tmpPath)

  // Convert to MP3 using ffmpeg
  await new Promise<void>((resolve, reject) => {
    const proc = spawn('ffmpeg', [
      '-y', '-i', tmpPath,
      '-vn', '-ar', '44100', '-ac', '2', '-b:a', '192k',
      destMp3Path,
    ], { stdio: ['ignore', 'pipe', 'pipe'] })
    proc.on('close', code => {
      try { fs.unlinkSync(tmpPath) } catch { /* ignore */ }
      code === 0 ? resolve() : reject(new Error(`ffmpeg exit code ${code}`))
    })
    proc.on('error', reject)
  })
}

/**
 * Download video as MP4 via Invidious proxy.
 * Uses combined stream (video+audio) if available, else merges adaptive streams.
 */
export async function downloadVideoViaInvidious(url: string, destMp4Path: string): Promise<void> {
  const m = url.match(/(?:v=|youtu\.be\/|\/shorts\/|\/embed\/)([A-Za-z0-9_-]{11})/)
  if (!m) throw new Error('Could not extract YouTube video ID')
  const videoId = m[1]
  const info = await fetchVideoInfo(videoId)

  fs.mkdirSync(path.dirname(destMp4Path), { recursive: true })

  // Try combined mp4 stream first (simplest — already has audio)
  const combined = info.formatStreams
    .filter(f => f.container === 'mp4' || f.type.includes('mp4'))
    .sort((a, b) => {
      const qa = parseInt(a.qualityLabel ?? '0') || 0
      const qb = parseInt(b.qualityLabel ?? '0') || 0
      return qb - qa
    })

  if (combined.length) {
    await downloadUrl(combined[0].url, destMp4Path)
    return
  }

  // Fallback: merge best video + best audio adaptive streams with ffmpeg
  const videoFormats = info.adaptiveFormats
    .filter(f => f.type.startsWith('video/') && f.container === 'mp4')
    .sort((a, b) => {
      const qa = parseInt(a.qualityLabel ?? '0') || 0
      const qb = parseInt(b.qualityLabel ?? '0') || 0
      return qb - qa
    })

  const audioFormats = info.adaptiveFormats
    .filter(f => f.type.startsWith('audio/'))
    .sort((a, b) => Number(b.bitrate ?? 0) - Number(a.bitrate ?? 0))

  if (!videoFormats.length || !audioFormats.length) {
    throw new Error('No suitable formats found via Invidious')
  }

  const tmpVideo = destMp4Path.replace(/\.mp4$/i, '_video.mp4')
  const tmpAudio = destMp4Path.replace(/\.mp4$/i, '_audio.m4a')

  await Promise.all([
    downloadUrl(videoFormats[0].url, tmpVideo),
    downloadUrl(audioFormats[0].url, tmpAudio),
  ])

  await new Promise<void>((resolve, reject) => {
    const proc = spawn('ffmpeg', [
      '-y',
      '-i', tmpVideo, '-i', tmpAudio,
      '-c:v', 'copy', '-c:a', 'copy',
      '-movflags', '+faststart',
      destMp4Path,
    ], { stdio: ['ignore', 'pipe', 'pipe'] })
    proc.on('close', code => {
      try { fs.unlinkSync(tmpVideo); fs.unlinkSync(tmpAudio) } catch { /* ignore */ }
      code === 0 ? resolve() : reject(new Error(`ffmpeg merge exit code ${code}`))
    })
    proc.on('error', reject)
  })
}

// ─── Cobalt.tools proxy ──────────────────────────────────────────────────────
// cobalt is an open-source media downloader that proxies YouTube streams
// through its own servers, so the VPS IP is never exposed to YouTube.
// API docs: https://github.com/imputnet/cobalt/blob/main/docs/api.md

const COBALT_API = 'https://api.cobalt.tools'

interface CobaltResponse {
  status: 'tunnel' | 'redirect' | 'picker' | 'error'
  url?: string
  audio?: string
  picker?: Array<{ url: string; type: string }>
  error?: { code: string }
}

async function cobaltStreamUrl(url: string, audioOnly: boolean): Promise<string> {
  const body = audioOnly
    ? { url, downloadMode: 'audio', audioFormat: 'mp3', filenameStyle: 'basic' }
    : { url, videoQuality: '720', filenameStyle: 'basic' }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30_000)
  try {
    const res = await fetch(`${COBALT_API}/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`Cobalt HTTP ${res.status}`)
    const data = await res.json() as CobaltResponse
    if (data.status === 'error') throw new Error(`Cobalt error: ${data.error?.code ?? 'unknown'}`)
    // picker = multiple streams (e.g. YouTube separates video/audio on their server)
    if (data.status === 'picker') {
      const target = audioOnly ? data.audio : data.picker?.[0]?.url
      if (!target) throw new Error('Cobalt picker returned no usable URL')
      return target
    }
    if (!data.url) throw new Error('Cobalt returned no download URL')
    return data.url
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Download audio as MP3 via cobalt.tools.
 * cobalt converts to MP3 server-side (audioFormat: 'mp3').
 */
export async function downloadAudioViaCobalt(url: string, destMp3Path: string): Promise<void> {
  const streamUrl = await cobaltStreamUrl(url, true)
  await downloadUrl(streamUrl, destMp3Path)
}

/**
 * Download video as MP4 via cobalt.tools.
 * cobalt muxes video+audio on their servers and returns a progressive MP4.
 */
export async function downloadVideoViaCobalt(url: string, destMp4Path: string): Promise<void> {
  const streamUrl = await cobaltStreamUrl(url, false)
  fs.mkdirSync(path.dirname(destMp4Path), { recursive: true })
  await downloadUrl(streamUrl, destMp4Path)
}
