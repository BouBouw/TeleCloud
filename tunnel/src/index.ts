/**
 * vibot-tunnel
 *
 * Local CLI that:
 *  1. Sends a heartbeat to the VPS every 10 s so the server knows we're alive
 *  2. Polls /api/tunnel/jobs/next every 2 s for pending YouTube downloads
 *  3. Downloads the video/audio using yt-dlp --cookies-from-browser
 *  4. Uploads the file to /api/tunnel/jobs/:id/complete
 *  5. Cleans up the local temp file
 *
 * Requires:
 *   - yt-dlp installed and on PATH  (https://github.com/yt-dlp/yt-dlp)
 *   - .env file next to tunnel/  (see .env.example)
 */

import 'dotenv/config'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { spawn } from 'child_process'
import FormData from 'form-data'
import https from 'https'
import http from 'http'
import { URL } from 'url'

// ── Config ────────────────────────────────────────────────────────────────────

const VPS_URL       = (process.env.VPS_URL       ?? '').replace(/\/$/, '')
const TUNNEL_SECRET = process.env.TUNNEL_SECRET  ?? ''
const PREF_BROWSER  = process.env.PREFERRED_BROWSER ?? ''
const COOKIES_FILE  = process.env.COOKIES_FILE   ?? ''
const TEMP_DIR      = process.env.TEMP_DIR       ?? os.tmpdir()

if (!VPS_URL || !TUNNEL_SECRET) {
  console.error('❌  Missing VPS_URL or TUNNEL_SECRET in .env')
  process.exit(1)
}

// ── Tunnel job interface (mirrors server) ─────────────────────────────────────

interface TunnelJob {
  id:           string
  url:          string
  outputFormat: 'MP3' | 'MP4' | 'MONTAGE'
  meta: {
    ytId:       string
    title:      string
    uploader?:  string
    duration?:  number
    webpage_url: string
  }
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function httpRequest(options: https.RequestOptions & { body?: string }, url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const mod = parsed.protocol === 'https:' ? https : http
    const req = mod.request(url, options, (res) => {
      let data = ''
      res.on('data', (chunk: Buffer) => { data += chunk.toString() })
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }))
    })
    req.on('error', reject)
    if (options.body) req.write(options.body)
    req.end()
  })
}

async function apiGet<T>(path_: string): Promise<T> {
  const res = await httpRequest({
    method: 'GET',
    headers: { 'x-tunnel-secret': TUNNEL_SECRET },
  }, `${VPS_URL}/api${path_}`)
  if (res.status >= 400) throw new Error(`GET ${path_} → ${res.status}: ${res.body}`)
  return JSON.parse(res.body) as T
}

async function apiPost<T>(path_: string, bodyObj?: object): Promise<T> {
  const body = bodyObj ? JSON.stringify(bodyObj) : ''
  const res = await httpRequest({
    method: 'POST',
    headers: {
      'x-tunnel-secret': TUNNEL_SECRET,
      'content-type':    'application/json',
      'content-length':  Buffer.byteLength(body).toString(),
    },
    body,
  }, `${VPS_URL}/api${path_}`)
  if (res.status >= 400) throw new Error(`POST ${path_} → ${res.status}: ${res.body}`)
  return JSON.parse(res.body) as T
}

function uploadFile(jobId: string, filePath: string): Promise<{ ok: boolean }> {
  return new Promise((resolve, reject) => {
    const form = new FormData()
    form.append('file', fs.createReadStream(filePath), {
      filename: path.basename(filePath),
    })
    const headers = form.getHeaders()
    const url = `${VPS_URL}/api/tunnel/jobs/${jobId}/complete`
    const parsed = new URL(url)
    const mod = parsed.protocol === 'https:' ? https : http
    const req = mod.request(url, {
      method: 'POST',
      headers: {
        ...headers,
        'x-tunnel-secret': TUNNEL_SECRET,
      },
    }, (res) => {
      let body = ''
      res.on('data', (c: Buffer) => { body += c.toString() })
      res.on('end', () => {
        if ((res.statusCode ?? 0) >= 400) {
          reject(new Error(`Upload failed ${res.statusCode}: ${body}`))
        } else {
          resolve(JSON.parse(body) as { ok: boolean })
        }
      })
    })
    req.on('error', reject)
    form.pipe(req)
  })
}

// ── yt-dlp helpers ────────────────────────────────────────────────────────────

function runYtdlp(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('yt-dlp', args, { stdio: ['ignore', 'inherit', 'inherit'] })
    proc.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`yt-dlp exited with code ${code}`))
    })
    proc.on('error', (e) => reject(new Error(`yt-dlp not found: ${e.message}. Install yt-dlp and make sure it's on your PATH.`)))
  })
}

/** Cache the working browser after first detection */
let detectedBrowser: string | null = null

/** Returns the cookie args for yt-dlp: either --cookies <file> or --cookies-from-browser <browser> */
async function cookieArgs(): Promise<string[]> {
  // Explicit cookies file — most reliable, works regardless of open browsers
  if (COOKIES_FILE) {
    if (!fs.existsSync(COOKIES_FILE)) throw new Error(`COOKIES_FILE not found: ${COOKIES_FILE}`)
    return ['--cookies', COOKIES_FILE]
  }
  const browser = await detectBrowser()
  return ['--cookies-from-browser', browser]
}

async function detectBrowser(): Promise<string> {
  if (detectedBrowser) return detectedBrowser
  if (PREF_BROWSER) {
    detectedBrowser = PREF_BROWSER
    return detectedBrowser
  }

  // Firefox uses NSS key storage — readable while the browser is open, no DPAPI.
  // On Chromium-based browsers (Chrome 127+, Edge) the cookie DB is locked when
  // the browser is running and also protected by App-Bound Encryption (DPAPI).
  // So we try Firefox first on all platforms.
  const candidates = ['firefox', 'edge', 'chrome', 'chromium', 'brave', 'opera', 'vivaldi']

  console.log('  🔍 Detecting browser with YouTube cookies…')
  for (const b of candidates) {
    try {
      // Use --print id instead of --skip-download:
      // skip-download still triggers format selection which can fail independently of cookies.
      // --print id only extracts metadata (no format selection needed) → exits 0 if cookies load OK.
      await runYtdlp([
        '--cookies-from-browser', b,
        '--print', 'id',
        '--no-playlist',
        '--no-warnings',
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      ])
      console.log(`  ✓ Using browser: ${b}`)
      detectedBrowser = b
      return b
    } catch {
      // try next
    }
  }
  throw new Error(
    'No browser with valid YouTube cookies found.\n' +
    '\n' +
    '  The easiest fix on Windows:\n' +
    '  1. Install "Get cookies.txt LOCALLY" in Chrome:\n' +
    '     https://chromewebstore.google.com/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc\n' +
    '  2. Open youtube.com while logged in → click extension → Export\n' +
    '  3. Add to tunnel/.env:\n' +
    '     COOKIES_FILE=C:\\Users\\samy7\\Downloads\\youtube-cookies.txt\n' +
    '  4. Restart the tunnel\n' +
    '\n' +
    '  Or install Firefox, log in to YouTube, and restart the tunnel.'
  )
}

async function downloadLocally(job: TunnelJob): Promise<string> {
  const prefix = path.join(TEMP_DIR, `vibot-${job.id}`)
  const ext = job.outputFormat === 'MP3' ? 'mp3' : 'mp4'
  const outPath = `${prefix}.${ext}`

  // yt-dlp 2026+ requires an explicit JS runtime for YouTube's n-challenge/signature solving.
  // By default only "deno" is enabled; we must opt-in to node.
  // --remote-components ejs:github allows yt-dlp to download the solver script (cached after first run).
  const jsArgs = ['--js-runtimes', 'node', '--remote-components', 'ejs:github']

  // 1080p on YouTube only exists as DASH (separate video 137 + audio 140). The Android
  // client returns ONLY low-res progressive MP4 (≤360/720p) — that's why downloads were
  // 360-480p. The `tv` (TVHTML5) and `web_safari` clients expose the full 1080p DASH ladder
  // and, now that we solve the n-challenge (JS runtime above), their URLs are properly
  // signed and don't 403. `android` is kept last as a progressive fallback.
  const ytClientArgs = ['--extractor-args', 'youtube:player_client=tv,web_safari,android']

  const args: string[] = [...await cookieArgs(), '--no-playlist', ...jsArgs, ...ytClientArgs]

  if (job.outputFormat === 'MP3') {
    args.push(
      '-x', '--audio-format', 'mp3', '--audio-quality', '0',
      '-o', `${prefix}.%(ext)s`,
    )
  } else {
    // Prefer 1080p H.264 DASH (137+140), then any 1080p, then the best single ≤1080p
    // progressive (720p over 360p), and only then any best. Sort by resolution so we
    // never silently pick a low format when a higher one is available.
    args.push(
      '-S', 'res:1080,vcodec:h264,acodec:aac',
      '-f', 'bestvideo[height<=1080][vcodec^=avc1]+bestaudio[acodec^=mp4a]/bestvideo[height<=1080]+bestaudio/best[height<=1080]/best',
      '--merge-output-format', 'mp4',
      '-o', `${prefix}.%(ext)s`,
    )
  }

  args.push('--no-warnings', job.url)

  await runYtdlp(args)

  // yt-dlp uses the template, find what it actually wrote
  const tmpFiles = fs.readdirSync(TEMP_DIR).filter(f => f.startsWith(`vibot-${job.id}`))
  if (!tmpFiles.length) throw new Error('yt-dlp produced no output file')

  const actual = path.join(TEMP_DIR, tmpFiles[0])
  // Rename to canonical name if needed
  if (actual !== outPath) {
    fs.renameSync(actual, outPath)
  }
  return outPath
}

// ── Main control loop ─────────────────────────────────────────────────────────

async function sendHeartbeat(): Promise<void> {
  try {
    await apiPost('/tunnel/heartbeat')
  } catch (e) {
    console.warn('  ⚠ Heartbeat failed:', String(e).split('\n')[0])
  }
}

async function getNextJob(): Promise<TunnelJob | null> {
  const res = await apiGet<{ job: TunnelJob | null }>('/tunnel/jobs/next')
  if (res.job) {
    console.log(`\n  📥 Job received: [${res.job.outputFormat}] ${res.job.url}`)
  }
  return res.job
}

async function reportFailure(jobId: string, error: string): Promise<void> {
  try {
    await apiPost(`/tunnel/jobs/${jobId}/fail`, { error })
  } catch (e) {
    console.warn('  ⚠ Could not report failure:', String(e).split('\n')[0])
  }
}

async function processJob(job: TunnelJob): Promise<void> {
  const label = `[${job.outputFormat}] «${job.meta.title}»`
  console.log(`\n  ⬇  Downloading ${label}`)
  console.log(`     ${job.url}`)

  let filePath: string | null = null
  try {
    filePath = await downloadLocally(job)
    const sizeMB = (fs.statSync(filePath).size / 1024 / 1024).toFixed(1)
    console.log(`  ⬆  Uploading ${sizeMB} MB → VPS`)
    await uploadFile(job.id, filePath)
    console.log(`  ✓  Done: ${label}`)
  } catch (err) {
    const msg = String(err)
    const firstLine = msg.split('\n')[0]
    if (msg.includes('DPAPI') || msg.includes('Could not copy') || msg.includes('database')) {
      console.error(`  ✗  Browser cookie error (${detectedBrowser ?? 'unknown browser'})`)
      console.error(`     Chrome/Edge lock their cookie DB while open.`)
      console.error(`     → Export cookies.txt from Chrome and set COOKIES_FILE in tunnel/.env:`)
      console.error(`       Extension: https://chromewebstore.google.com/detail/cclelndahbckbenkjhflpdbgdldlbecc`)
      console.error(`       COOKIES_FILE=C:\\Users\\samy7\\Downloads\\youtube-cookies.txt`)
      detectedBrowser = null
    } else if (msg.includes('No browser with valid YouTube cookies')) {
      console.error(`  ✗  No usable browser found. Add this to tunnel/.env and restart:`)
      console.error(`     COOKIES_FILE=C:\\Users\\samy7\\Downloads\\youtube-cookies.txt`)
      console.error(`     (export from Chrome with the "Get cookies.txt LOCALLY" extension)`)
    } else {
      console.error(`  ✗  Failed: ${firstLine}`)
    }
    await reportFailure(job.id, firstLine)
  } finally {
    if (filePath && fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath) } catch { /* ignore */ }
    }
  }
}

async function pollOnce(): Promise<void> {
  try {
    const job = await getNextJob()
    if (job) await processJob(job)
  } catch (e) {
    // Network/JSON error — suppress, will retry
    const msg = String(e).split('\n')[0]
    if (!msg.includes('ECONNREFUSED') && !msg.includes('ECONNRESET')) {
      console.warn('  ⚠ Poll error:', msg)
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

async function main(): Promise<void> {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('  vibot-tunnel  —  YouTube local download bridge')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log(`  VPS : ${VPS_URL}`)
  console.log(`  Temp: ${TEMP_DIR}`)
  console.log('─────────────────────────────────────────────────')

  // Verify yt-dlp is available
  try {
    await runYtdlp(['--version'])
  } catch {
    console.error('\n❌  yt-dlp is not installed or not on PATH.')
    console.error('   Install it: https://github.com/yt-dlp/yt-dlp#installation')
    process.exit(1)
  }

  // Initial heartbeat + connection test
  try {
    await apiPost('/tunnel/heartbeat')
    console.log('  ✓ Connected to VPS')
  } catch (e) {
    console.error(`\n❌  Cannot reach VPS: ${String(e).split('\n')[0]}`)
    console.error(`   Check VPS_URL and TUNNEL_SECRET in .env`)
    process.exit(1)
  }

  console.log('  Polling for YouTube jobs…  (Ctrl+C to stop)\n')

  // Heartbeat every 10 s
  const hbInterval = setInterval(sendHeartbeat, 10_000)

  // Poll loop
  let consecutiveErrors = 0
  while (true) {
    try {
      await pollOnce()
      consecutiveErrors = 0
    } catch {
      consecutiveErrors++
      if (consecutiveErrors > 5) {
        console.error('  Too many consecutive errors. Retrying in 30 s…')
        await sleep(30_000)
        consecutiveErrors = 0
        continue
      }
    }
    await sleep(2_000)
  }

  clearInterval(hbInterval) // unreachable but keeps TS happy
}

main().catch((e) => {
  console.error('Fatal:', e)
  process.exit(1)
})
