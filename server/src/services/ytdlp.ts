import { spawn } from 'child_process'
import path from 'path'
import fs from 'fs'
import https from 'https'
import http from 'http'

/** Returns ['--cookies', '/path'] if YTDLP_COOKIES_PATH is set and the file exists */
function cookiesArgs(): string[] {
  const p = process.env.YTDLP_COOKIES_PATH
  if (p && fs.existsSync(p)) return ['--cookies', p]
  return []
}

/**
 * Use Android + web embedded clients for YouTube — bypasses the
 * "Sign in to confirm you're not a bot" error without needing cookies.
 * Safe to always include: yt-dlp applies extractor-args only to matching URLs.
 */
const YT_BYPASS_ARGS = [
  '--extractor-args', 'youtube:player_client=android,web',
]

export interface YtdlpMeta {
  id: string
  title: string
  uploader?: string
  uploader_id?: string
  thumbnail?: string
  duration?: number
  webpage_url: string
  extractor: string
}

/** Fetch metadata without downloading */
export function getYtdlpMeta(url: string): Promise<YtdlpMeta> {
  return new Promise((resolve, reject) => {
    const proc = spawn('yt-dlp', [
      '--dump-json',
      '--no-playlist',
      '--no-warnings',
      ...YT_BYPASS_ARGS,
      ...cookiesArgs(),
      url,
    ], { stdio: ['ignore', 'pipe', 'pipe'] })

    let out = ''
    let err = ''
    proc.stdout.on('data', (d: Buffer) => { out += d.toString() })
    proc.stderr.on('data', (d: Buffer) => { err += d.toString() })

    proc.on('close', code => {
      if (code !== 0) return reject(new Error(err.slice(-600) || `yt-dlp exited ${code}`))
      try { resolve(JSON.parse(out.trim().split('\n')[0])) }
      catch (e) { reject(new Error('Failed to parse yt-dlp JSON')) }
    })
    proc.on('error', (e: NodeJS.ErrnoException) => {
      if (e.code === 'ENOENT') reject(new Error('yt-dlp not found — install it and restart the server'))
      else reject(e)
    })
  })
}

/** Download and extract audio to MP3 at outputPath (without extension — yt-dlp appends .mp3) */
export function downloadAudioYtdlp(url: string, outputPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // yt-dlp replaces the extension; pass path without .mp3 so we know the final name
    const base = outputPath.replace(/\.mp3$/i, '')
    const args = [
      url,
      '-x',
      '--audio-format', 'mp3',
      '--audio-quality', '0',
      '-o', `${base}.%(ext)s`,
      '--no-playlist',
      '--no-part',
      '--no-continue',
      '--no-warnings',
      '--compat-options', 'allow-unsafe-ext',
      '--retries', '2',
      '--extractor-retries', '2',
      ...YT_BYPASS_ARGS,
      ...cookiesArgs(),
    ]

    const proc = spawn('yt-dlp', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let err = ''
    proc.stderr.on('data', (d: Buffer) => { err += d.toString() })

    proc.on('close', code => {
      if (code !== 0) return reject(new Error(err.slice(-600) || `yt-dlp exited ${code}`))
      // Find the produced .mp3 file
      const dir = path.dirname(base)
      const stem = path.basename(base)
      const produced = fs.readdirSync(dir).find(f => f.startsWith(stem) && f.endsWith('.mp3'))
      if (!produced) return reject(new Error('yt-dlp finished but no MP3 file found'))
      resolve(path.join(dir, produced))
    })
    proc.on('error', (e: NodeJS.ErrnoException) => {
      if (e.code === 'ENOENT') reject(new Error('yt-dlp not found — install it and restart the server'))
      else reject(e)
    })
  })
}

/** Detect social platform from URL */
export function detectPlatform(url: string): 'tiktok' | 'instagram' | 'twitter' | 'snapchat' | 'youtube' | null {
  if (/tiktok\.com/i.test(url))    return 'tiktok'
  if (/instagram\.com/i.test(url)) return 'instagram'
  if (/(twitter|x)\.com/i.test(url)) return 'twitter'
  if (/snapchat\.com/i.test(url))  return 'snapchat'
  if (/(youtube\.com|youtu\.be)/i.test(url)) return 'youtube'
  return null
}

/** Download video(s) (MP4) — supports playlists, returns all produced video paths.
 * @param uniquePrefix  If provided, used as filename prefix so repeated downloads
 *                      of the same URL produce distinct filenames (prevents the
 *                      "before-set" false-negative where the same filename already
 *                      existed in destDir and is not detected as "new").
 */
export function downloadVideoYtdlp(url: string, destDir: string, uniquePrefix?: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(destDir, { recursive: true })
    const before = new Set(fs.readdirSync(destDir))

    // Use uniquePrefix to guarantee a distinct output filename per download call.
    // Without this, the same video downloaded twice produces the same filename
    // (e.g. 00001_{videoId}.mp4) and the second call falsely reports "no new files".
    const outputTemplate = uniquePrefix
      ? path.join(destDir, `${uniquePrefix}_%(id)s.%(ext)s`)
      : path.join(destDir, '%(autonumber)05d_%(id)s.%(ext)s')

    const args = [
      url,
      // Prefer H.264+AAC (container-compatible, no re-encode needed)
      '-f', 'bestvideo[vcodec^=avc1][height<=1080]+bestaudio[acodec^=mp4a]/bestvideo[height<=1080]+bestaudio/best',
      '--merge-output-format', 'mp4',
      '-o', outputTemplate,
      '--no-part',
      '--no-continue',
      '--no-warnings',
      '--no-playlist',
      // Bypass any user yt-dlp config that might add --no-overwrites or other flags
      '--ignore-config',
      '--compat-options', 'allow-unsafe-ext',
      '--retries', '3',
      '--extractor-retries', '3',
      '--socket-timeout', '30',
      ...YT_BYPASS_ARGS,
      ...cookiesArgs(),
    ]

    const proc = spawn('yt-dlp', args, { stdio: ['ignore', 'pipe', 'pipe'] })

    // Kill after 10 minutes to prevent infinite hangs
    const timeout = setTimeout(() => {
      proc.kill('SIGTERM')
      reject(new Error('yt-dlp timed out after 10 minutes'))
    }, 10 * 60_000)

    let out = ''
    let err = ''
    proc.stdout.on('data', (d: Buffer) => { out += d.toString() })
    proc.stderr.on('data', (d: Buffer) => { err += d.toString() })

    proc.on('close', code => {
      clearTimeout(timeout)
      if (code !== 0) return reject(new Error(err.slice(-800) || `yt-dlp exited ${code}`))
      const allFiles = fs.readdirSync(destDir).filter(f => !before.has(f))
      // Accept any video container — MP4 is preferred but mkv/webm may appear
      // when ffmpeg cannot remux to MP4 for a given codec combination.
      const VIDEO_EXTS = new Set(['.mp4', '.mkv', '.webm', '.mov', '.avi', '.m4v'])
      const produced = allFiles
        .filter(f => VIDEO_EXTS.has(path.extname(f).toLowerCase()))
        .map(f => path.join(destDir, f))
      if (produced.length === 0) {
        return reject(new Error(
          `yt-dlp finished but no video file found.\nNew files: [${allFiles.join(', ') || 'none'}]\nSTDOUT: ${out.slice(-400)}\nSTDERR: ${err.slice(-400)}`
        ))
      }
      resolve(produced)
    })
    proc.on('error', (e: NodeJS.ErrnoException) => {
      clearTimeout(timeout)
      if (e.code === 'ENOENT') reject(new Error('yt-dlp not found — install it and restart the server'))
      else reject(e)
    })
  })
}

// ── Snapchat direct scraper ─────────────────────────────────────────────────

function httpGetBuffer(url: string, depth = 0): Promise<Buffer> {
  if (depth > 5) return Promise.reject(new Error('Too many redirects'))
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http
    const req = protocol.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36' },
      timeout: 20000,
    }, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        httpGetBuffer(res.headers.location!, depth + 1).then(resolve).catch(reject)
        return
      }
      if ((res.statusCode ?? 0) >= 400) {
        reject(new Error(`HTTP ${res.statusCode}`)); return
      }
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => resolve(Buffer.concat(chunks)))
      res.on('error', reject)
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')) })
  })
}

function ffmpegRemux(input: string, output: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', [
      '-i', input, '-c', 'copy', '-movflags', 'faststart', '-y', output,
    ], { stdio: ['ignore', 'ignore', 'pipe'] })
    let err = ''
    proc.stderr.on('data', (d: Buffer) => { err += d.toString() })
    proc.on('close', code => {
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg: ${err.slice(-200)}`))
    })
    proc.on('error', reject)
  })
}

/** Fetch all Snapchat Stories from a public profile and return MP4 file paths */
export async function downloadSnapchatStories(profileUrl: string, destDir: string): Promise<string[]> {
  fs.mkdirSync(destDir, { recursive: true })

  // Extract username from any Snapchat URL format
  let username = ''
  try {
    const u = new URL(profileUrl)
    const m = u.pathname.match(/\/(?:s|add)\/([^/?#]+)/)
           ?? u.pathname.match(/\/@([^/?#]+)/)
           ?? u.pathname.match(/\/([^/?#]+)/)
    if (m) username = m[1].replace(/^@/, '')
  } catch { /* ignore */ }
  if (!username) throw new Error('Impossible d\'extraire le nom d\'utilisateur Snapchat')

  // Fetch public profile page
  const html = (await httpGetBuffer(`https://www.snapchat.com/@${username}`)).toString('utf-8')

  // Extract all mediaUrl values (JSON-encoded in the page HTML)
  const mediaUrls: string[] = []
  const re = /"mediaUrl"\s*:\s*"(https:\/\/[^"]+)"/g
  let match: RegExpExecArray | null
  while ((match = re.exec(html)) !== null) {
    // Decode JSON unicode escapes (\u0026 → &, \u003d → =)
    const mediaUrl = match[1]
      .replace(/\\u0026/g, '&')
      .replace(/\\u003[dD]/g, '=')
      .replace(/\\u003[fF]/g, '?')
    mediaUrls.push(mediaUrl)
  }

  if (mediaUrls.length === 0) {
    throw new Error(`Aucune story trouvée sur @${username}. Profil privé ou aucune story active.`)
  }

  // Download each story and remux to MP4 (already H.264 — no re-encode needed)
  const ts = Date.now()
  const produced: string[] = []
  for (let i = 0; i < mediaUrls.length; i++) {
    const prefix = String(i + 1).padStart(5, '0')
    const rawFile = path.join(destDir, `${prefix}_snap_${username}_${ts}.raw`)
    const mp4File = path.join(destDir, `${prefix}_snap_${username}_${ts}.mp4`)
    try {
      const buf = await httpGetBuffer(mediaUrls[i])
      fs.writeFileSync(rawFile, buf)
      await ffmpegRemux(rawFile, mp4File)
      produced.push(mp4File)
    } catch { /* skip failed stories */ } finally {
      try { if (fs.existsSync(rawFile)) fs.unlinkSync(rawFile) } catch { /* ignore */ }
    }
  }

  if (produced.length === 0) throw new Error('Tous les téléchargements de stories ont échoué')
  return produced
}
