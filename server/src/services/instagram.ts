/**
 * Instagram extractor via Cloudflare Worker relay.
 *
 * Bypasses Instagram's API blocks on datacenter IPs by routing the
 * metadata API call through a CF Worker (edge IP).  The actual video
 * CDN download happens directly from the VPS because scontent-*.cdninstagram.com
 * is a standard CDN and not IP-restricted.
 *
 * Required env vars:
 *   INSTAGRAM_CF_WORKER_URL    – e.g. https://instagram-relay.xxx.workers.dev
 *   INSTAGRAM_CF_WORKER_SECRET – secret token set via `wrangler secret put RELAY_SECRET`
 *   INSTAGRAM_COOKIES_PATH     – (optional) path to Netscape cookie file for auth
 *   YTDLP_COOKIES_PATH         – fallback if INSTAGRAM_COOKIES_PATH is absent
 */
import https from 'https'
import http  from 'http'
import fs    from 'fs'
import path  from 'path'
import { spawn }      from 'child_process'
import { randomUUID } from 'crypto'

const FFMPEG = process.env.FFMPEG_PATH ?? 'ffmpeg'

// ── Config helpers ─────────────────────────────────────────────────────────

export function isConfigured(): boolean {
  return !!(process.env.INSTAGRAM_CF_WORKER_URL && process.env.INSTAGRAM_CF_WORKER_SECRET)
}

/** Parse a Netscape-format cookies file → Cookie header string */
function readCookiesHeader(cookiePath: string): string {
  if (!fs.existsSync(cookiePath)) return ''
  const pairs: string[] = []
  for (const line of fs.readFileSync(cookiePath, 'utf8').split('\n')) {
    if (line.startsWith('#') || !line.trim()) continue
    const parts = line.split('\t')
    if (parts.length >= 7) pairs.push(`${parts[5]}=${parts[6]}`)
  }
  return pairs.join('; ')
}

function getCookies(): string {
  const p = process.env.INSTAGRAM_COOKIES_PATH ?? process.env.YTDLP_COOKIES_PATH
  return p ? readCookiesHeader(p) : ''
}

// ── CF Worker relay ────────────────────────────────────────────────────────

interface WorkerResponse { ok: boolean; status: number; body: string; error?: string }

async function fetchViaWorker(
  url: string,
  headers: Record<string, string> = {},
  cookies?: string,
): Promise<WorkerResponse> {
  const workerUrl = process.env.INSTAGRAM_CF_WORKER_URL!
  const secret    = process.env.INSTAGRAM_CF_WORKER_SECRET!
  if (!workerUrl || !secret) throw new Error('CF Worker not configured')

  const payload = Buffer.from(JSON.stringify({ url, headers, cookies: cookies ?? undefined }))
  const parsed  = new URL(workerUrl)

  return new Promise<WorkerResponse>((resolve, reject) => {
    const req = https.request({
      hostname: parsed.hostname,
      port:     Number(parsed.port) || 443,
      path:     parsed.pathname,
      method:   'POST',
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': payload.length,
        'Authorization':  `Bearer ${secret}`,
      },
    }, (res) => {
      let data = ''
      res.on('data', (c: Buffer) => (data += c.toString()))
      res.on('end', () => {
        try   { resolve(JSON.parse(data) as WorkerResponse) }
        catch { reject(new Error(`Worker non-JSON response: ${data.slice(0, 200)}`)) }
      })
    })
    req.on('error', reject)
    req.setTimeout(30_000, () => { req.destroy(); reject(new Error('CF Worker request timed out')) })
    req.write(payload)
    req.end()
  })
}

// ── Instagram URL helpers ──────────────────────────────────────────────────

function extractCode(url: string): string | null {
  const m = url.match(/instagram\.com\/(?:p|reel|tv)\/([\w-]+)/)
  return m?.[1] ?? null
}

// ── Public meta interface ──────────────────────────────────────────────────

export interface InstagramMeta {
  videoUrl:  string
  title:     string
  thumbnail?: string
  duration?:  number
  uploader?:  string
}

// ── Meta extraction ────────────────────────────────────────────────────────

export async function getInstagramMeta(postUrl: string): Promise<InstagramMeta> {
  const code = extractCode(postUrl)
  if (!code) throw new Error(`Cannot extract post code from: ${postUrl}`)

  const cookies = getCookies()

  // ── Attempt 1: /__a=1 JSON API (returns full GraphQL data when authed) ──
  try {
    const resp = await fetchViaWorker(
      `https://www.instagram.com/p/${code}/?__a=1&__d=dis`,
      {
        Accept:              'application/json, text/javascript',
        'X-Requested-With':  'XMLHttpRequest',
        'X-IG-App-ID':       '936619743392459',
        Referer:             'https://www.instagram.com/',
      },
      cookies,
    )
    if (resp.ok && resp.body) {
      try {
        const data = JSON.parse(resp.body)
        const media =
          data?.items?.[0] ??
          data?.graphql?.shortcode_media ??
          data?.data?.shortcode_media
        if (media) return parseMedia(media)
      } catch { /* malformed — fall through */ }
    }
  } catch { /* network error — fall through */ }

  // ── Attempt 2: embed page (no auth needed) ─────────────────────────────
  const embedResp = await fetchViaWorker(
    `https://www.instagram.com/p/${code}/embed/captioned/`,
    { Accept: 'text/html', 'Accept-Language': 'en-US,en;q=0.9' },
    cookies,
  )
  if (!embedResp.ok) throw new Error(`Instagram embed returned HTTP ${embedResp.status}`)
  return parseEmbed(embedResp.body)
}

function parseMedia(media: Record<string, unknown>): InstagramMeta {
  const isVideo = media.is_video === true || (media.media_type as number) === 2
  if (!isVideo) throw new Error('Not a video post')

  type VideoVersion = { url: string }
  const videoUrl =
    (media.video_url as string | undefined) ??
    ((media.video_versions as VideoVersion[] | undefined)?.[0]?.url)
  if (!videoUrl) throw new Error('No video_url in Instagram media data')

  type Owner = { username?: string }
  const caption =
    ((media.caption as Owner | undefined)?.username) ??   // wrong but harmless fallback
    ((media.caption as Record<string, unknown> | undefined)?.text as string | undefined) ??
    (((media.edge_media_to_caption as Record<string, unknown> | undefined)
      ?.edges as Array<{ node: { text: string } }> | undefined)?.[0]?.node?.text) ??
    ''

  return {
    videoUrl,
    title:     String(caption).slice(0, 120),
    thumbnail: (media.display_url ?? media.thumbnail_url) as string | undefined,
    duration:  media.video_duration as number | undefined,
    uploader:  ((media.owner as Owner | undefined)?.username) ??
               ((media.user  as Owner | undefined)?.username),
  }
}

function parseEmbed(html: string): InstagramMeta {
  // Try __NEXT_DATA__ JSON blob
  const nd = html.match(/<script id="__NEXT_DATA__" type="application\/json">([^<]+)<\/script>/)
  if (nd) {
    try {
      const str = JSON.stringify(JSON.parse(nd[1]))
      const vm  = str.match(/"video_url":"(https?:[^"]+)"/)
      if (vm) return { videoUrl: vm[1].replace(/\\u0026/g, '&'), title: '' }
    } catch { /* ignore */ }
  }
  // OG meta tags fallback
  const videoMeta = html.match(/<meta[^>]+property="og:video(?::secure_url)?"[^>]+content="([^"]+)"/)
                 ?? html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:video(?::secure_url)?"/)
  const titleMeta = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/)
  const thumbMeta = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/)
  if (videoMeta) {
    return {
      videoUrl:  videoMeta[1].replace(/&amp;/g, '&'),
      title:     titleMeta?.[1] ?? '',
      thumbnail: thumbMeta?.[1],
    }
  }
  throw new Error('Could not extract video URL from Instagram embed page')
}

// ── Download helpers ───────────────────────────────────────────────────────

/** Stream a URL directly to disk, following redirects */
function streamToDisk(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath)
    const follow = (u: string, depth = 0) => {
      if (depth > 5) { file.destroy(); reject(new Error('Too many redirects')); return }
      const mod = u.startsWith('https://') ? https : http
      mod.get(u, { headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)' } }, (res) => {
        if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
          follow(res.headers.location, depth + 1); return
        }
        if (res.statusCode !== 200) {
          file.destroy(); reject(new Error(`HTTP ${res.statusCode} when downloading video`)); return
        }
        res.pipe(file)
        file.on('finish', () => file.close(() => resolve()))
        file.on('error',  reject)
      }).on('error', reject)
    }
    follow(url)
  })
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let err = ''
    proc.stderr.on('data', (d: Buffer) => (err += d.toString()))
    proc.on('close', code => code === 0 ? resolve() : reject(new Error(`FFmpeg exit ${code}: ${err.slice(-300)}`)))
    proc.on('error', reject)
  })
}

/**
 * Download Instagram post as MP4 video.
 * Returns the absolute path to the produced file.
 */
export async function downloadInstagramVideo(postUrl: string, destDir: string, prefix = 'ig'): Promise<string> {
  const meta    = await getInstagramMeta(postUrl)
  const rawPath = path.join(destDir, `${prefix}_${randomUUID()}_raw.mp4`)
  const outPath = path.join(destDir, `${prefix}_${randomUUID()}.mp4`)
  fs.mkdirSync(destDir, { recursive: true })
  await streamToDisk(meta.videoUrl, rawPath)
  // Remux → seekable, clean MP4
  await runFfmpeg(['-y', '-i', rawPath, '-c', 'copy', outPath])
  fs.unlink(rawPath, () => {})
  return outPath
}

/**
 * Download Instagram post and extract audio as MP3.
 * outputMp3Path should be the desired output path (with .mp3 extension).
 * Returns the resolved output path.
 */
export async function downloadInstagramAudio(postUrl: string, outputMp3Path: string): Promise<string> {
  const meta    = await getInstagramMeta(postUrl)
  const rawPath = outputMp3Path.replace(/\.mp3$/i, '_raw.mp4')
  await streamToDisk(meta.videoUrl, rawPath)
  await runFfmpeg(['-y', '-i', rawPath, '-vn', '-c:a', 'libmp3lame', '-b:a', '192k', outputMp3Path])
  fs.unlink(rawPath, () => {})
  return outputMp3Path
}
