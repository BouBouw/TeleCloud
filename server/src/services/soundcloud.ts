import path from 'path'
import fs from 'fs'
import https from 'https'
import http from 'http'
import logger from '../lib/logger'

const STORAGE_ROOT = path.resolve(process.env.STORAGE_PATH ?? './storage')

export function ensureWorkspaceDir(workspaceId: string): string {
  const dir = path.join(STORAGE_ROOT, 'tracks', workspaceId)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

// ── Lightweight SoundCloud metadata fetcher ──────────────────────────────────

interface SCTrackInfo {
  id: string
  title: string
  artist: string
  artworkUrl?: string
  duration?: number
  streamUrl?: string
  permalink_url: string
  likesCount?: number
  playCount?: number
  createdAt?: string
}

/**
 * Resolve SoundCloud metadata via the Widget API (returns stream URL + duration).
 */
export async function resolveSCMetadata(trackUrl: string): Promise<SCTrackInfo> {
  const SC_KEY = 'KKzJxmw11tYpCs6T24P4uUYhqmjalG6M'
  const url = `https://api-widget.soundcloud.com/resolve?url=${encodeURIComponent(trackUrl)}&client_id=${SC_KEY}`
  const raw = await fetchJson<RawSCTrack>(url)
  return mapRaw(raw)
}

/**
 * Search SoundCloud — one page at a time.
 * Returns the tracks for that page and whether more pages exist.
 */
export async function searchSoundCloud(
  query: string,
  perPage = 20,
  offset = 0,
): Promise<{ tracks: SCTrackInfo[]; hasMore: boolean }> {
  const SC_KEY = 'KKzJxmw11tYpCs6T24P4uUYhqmjalG6M'
  const url = `https://api-widget.soundcloud.com/search/tracks?q=${encodeURIComponent(query)}&limit=${perPage}&offset=${offset}&linked_partitioning=1&client_id=${SC_KEY}`

  try {
    const data = await fetchJson<{ collection: RawSCTrack[]; next_href?: string }>(url)
    const tracks = (data.collection ?? []).map(mapRaw)
    return { tracks, hasMore: !!data.next_href }
  } catch {
    logger.warn('SoundCloud widget search failed, returning empty')
    return { tracks: [], hasMore: false }
  }
}

interface RawSCTrack {
  kind: string
  id: number
  title: string
  user: { username: string }
  artwork_url?: string
  duration: number
  permalink_url: string
  stream_url?: string
  likes_count?: number
  playback_count?: number
  created_at?: string
  media?: {
    transcodings: Array<{
      url: string
      format: { protocol: string; mime_type: string }
    }>
  }
}

function mapRaw(t: RawSCTrack): SCTrackInfo {
  // New widget API uses media.transcodings; prefer progressive (direct audio URL)
  const transcodings = t.media?.transcodings ?? []
  const progressive = transcodings.find(c => c.format.protocol === 'progressive')
  const hls = transcodings.find(c => c.format.protocol === 'hls')
  const streamUrl = progressive?.url ?? hls?.url ?? t.stream_url

  return {
    id: String(t.id),
    title: t.title,
    artist: t.user?.username ?? 'Unknown',
    artworkUrl: t.artwork_url?.replace('-large', '-t300x300') ?? undefined,
    duration: Math.floor(t.duration / 1000),
    permalink_url: t.permalink_url,
    streamUrl,
    likesCount: t.likes_count,
    playCount: t.playback_count,
    createdAt: t.created_at,
  }
}

/**
 * Download a track from a direct stream URL to disk.
 * Returns the absolute file path.
 */
export async function downloadTrack(
  streamUrl: string,
  destDir: string,
  filename: string,
): Promise<{ filePath: string; fileSize: number }> {
  fs.mkdirSync(destDir, { recursive: true })
  const filePath = path.join(destDir, filename)

  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(filePath)
    const protocol = streamUrl.startsWith('https') ? https : http

    const request = protocol.get(streamUrl, { timeout: 30_000 }, response => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        // Follow redirect
        file.close()
        const redirectUrl = response.headers.location!
        downloadTrack(redirectUrl, destDir, filename).then(resolve).catch(reject)
        return
      }
      if (response.statusCode !== 200) {
        reject(new Error(`Download failed with status ${response.statusCode}`))
        return
      }
      response.pipe(file)
      file.on('finish', () => {
        const stats = fs.statSync(filePath)
        resolve({ filePath, fileSize: stats.size })
      })
    })

    request.on('error', err => {
      fs.unlink(filePath, () => {})
      reject(err)
    })
    file.on('error', err => {
      fs.unlink(filePath, () => {})
      reject(err)
    })
  })
}

// ── Utility ──────────────────────────────────────────────────────────────────
function fetchJson<T>(url: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http
    protocol.get(url, {
      headers: { 'User-Agent': 'Vibot/1.0' },
      timeout: 10_000,
    }, res => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        try { resolve(JSON.parse(data)) }
        catch (e) { reject(e) }
      })
    }).on('error', reject)
  })
}

// ── Resolve a SoundCloud transcoding URL to the actual CDN stream URL ─────────
function resolveTranscodingUrl(url: string): Promise<string | null> {
  return new Promise(resolve => {
    https.get(url, { headers: { 'User-Agent': 'Vibot/1.0' }, timeout: 10_000 }, res => {
      let raw = ''
      res.on('data', (c: string) => { raw += c })
      res.on('end', () => {
        try { resolve((JSON.parse(raw) as { url?: string }).url ?? null) }
        catch { resolve(null) }
      })
    }).on('error', () => resolve(null))
  })
}

/**
 * Fetch a SoundCloud track by its numeric SC ID, resolve the transcoding URL,
 * and download the audio file to disk.
 * Called automatically when a track has no local file (e.g. metadata-only scrape).
 */
export async function downloadSCTrackById(
  scId: string,
  destDir: string,
  filename: string,
): Promise<{ filePath: string; fileSize: number }> {
  const clientId = process.env.SC_CLIENT_ID ?? 'KKzJxmw11tYpCs6T24P4uUYhqmjalG6M'

  // Fetch full track metadata from the widget API (includes transcodings)
  const trackData = await fetchJson<RawSCTrack>(
    `https://api-widget.soundcloud.com/tracks/${scId}?client_id=${clientId}`,
  )
  const mapped = mapRaw(trackData)
  if (!mapped.streamUrl) throw new Error('No stream URL available for this track')

  // streamUrl is a transcoding endpoint — resolve it to the actual CDN URL
  const cdnUrl = await resolveTranscodingUrl(`${mapped.streamUrl}?client_id=${clientId}`)
  if (!cdnUrl) throw new Error('Could not resolve CDN URL from transcoding endpoint')

  return downloadTrack(cdnUrl, destDir, filename)
}
