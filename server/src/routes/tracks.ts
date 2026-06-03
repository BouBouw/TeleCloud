import { Router } from 'express'
import type { Response } from 'express'
import path from 'path'
import fs from 'fs'
import https from 'https'
import http from 'http'
import { spawn } from 'child_process'
import multer from 'multer'
import { v4 as uuid } from 'uuid'
import prisma from '../lib/prisma'
import { authenticate } from '../middleware/auth'
import { ensureWorkspaceDir, resolveSCMetadata, downloadSCTrackById, searchSoundCloud } from '../services/soundcloud'
import { getYtdlpMeta, downloadAudioYtdlp, downloadVideoYtdlp, downloadSnapchatStories, detectPlatform } from '../services/ytdlp'
import logger from '../lib/logger'

const router = Router({ mergeParams: true })
router.use(authenticate)

/** Extract @username from social media URL as artist fallback */
function extractUsernameFromUrl(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.hostname.includes('snapchat.com')) {
      const m = u.pathname.match(/\/(?:s|add|p)\/([^/?#]+)/)
      if (m) return `@${m[1]}`
    }
    if (u.hostname.includes('tiktok.com')) {
      const m = u.pathname.match(/\/@([^/?#/]+)/)
      if (m) return `@${m[1]}`
    }
    if (u.hostname.includes('instagram.com')) {
      const m = u.pathname.match(/^\/([^/?#/]+)/)
      if (m && !['p', 'reel', 'stories', 'explore'].includes(m[1])) return `@${m[1]}`
    }
    if (u.hostname.includes('x.com') || u.hostname.includes('twitter.com')) {
      const m = u.pathname.match(/^\/([^/?#/]+)/)
      if (m && !['i', 'home', 'search'].includes(m[1])) return `@${m[1]}`
    }
  } catch { /* ignore */ }
  return null
}

interface WsParams { wsId: string; [key: string]: string }
interface TrackParams extends WsParams { trackId: string }

const STORAGE_ROOT = path.resolve(process.env.STORAGE_PATH ?? './storage')

// ── Multer for direct file upload ────────────────────────────────────────────
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      const dir = ensureWorkspaceDir(req.params.wsId)
      cb(null, dir)
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname) || '.mp3'
      cb(null, `${uuid()}${ext}`)
    },
  }),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['.mp3', '.wav', '.ogg', '.flac', '.m4a']
    cb(null, allowed.includes(path.extname(file.originalname).toLowerCase()))
  },
})

// ── Multer for artwork image upload ──────────────────────────────────────────
const uploadArtwork = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      const dir = path.join(STORAGE_ROOT, '_artwork')
      fs.mkdirSync(dir, { recursive: true })
      cb(null, dir)
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname) || '.jpg'
      cb(null, `${uuid()}${ext}`)
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (_req, file, cb) => {
    cb(null, file.mimetype.startsWith('image/'))
  },
})

// ── Helper: check workspace membership ──────────────────────────────────────
async function assertMember(workspaceId: string, userId: string) {
  const m = await prisma.workspaceMember.findFirst({ where: { workspaceId, userId } })
  return m
}

/* ── GET /api/workspaces/:wsId/tracks ── */
router.get<WsParams>('/', async (req, res) => {
  const member = await assertMember(req.params.wsId, req.user!.userId)
  if (!member) { res.status(403).json({ error: 'Not a member' }); return }

  const { q, limit = '50', offset = '0' } = req.query as Record<string, string>
  try {
    const tracks = await prisma.track.findMany({
      where: {
        workspaceId: req.params.wsId,
        ...(q ? { OR: [{ title: { contains: q } }, { artist: { contains: q } }] } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit ? Math.min(Number(limit), 10000) : undefined,
      skip: Number(offset),
    })
    const total = await prisma.track.count({ where: { workspaceId: req.params.wsId } })
    res.json({ tracks, total })
  } catch {
    res.status(500).json({ error: 'Internal server error' })
  }
})

/* ── POST /api/workspaces/:wsId/tracks/upload ── */
router.post<WsParams>('/upload', upload.single('file'), async (req, res) => {
  const member = await assertMember(req.params.wsId, req.user!.userId)
  if (!member) { res.status(403).json({ error: 'Not a member' }); return }
  if (!req.file) { res.status(400).json({ error: 'No file provided' }); return }

  try {
    const relativePath = path.relative(STORAGE_ROOT, req.file.path)
    const track = await prisma.track.create({
      data: {
        id: uuid(),
        workspaceId: req.params.wsId,
        title: req.body.title ?? path.parse(req.file.originalname).name,
        artist: req.body.artist ?? 'Unknown',
        format: path.extname(req.file.originalname).replace('.', '').toLowerCase(),
        fileSize: req.file.size,
        filePath: relativePath,
      },
    })
    res.status(201).json({ track })
  } catch {
    res.status(500).json({ error: 'Internal server error' })
  }
})

/* ── POST /api/workspaces/:wsId/tracks/scrape ── */
router.post<WsParams>('/scrape', async (req, res) => {
  const member = await assertMember(req.params.wsId, req.user!.userId)
  if (!member || member.role === 'EDITOR') {
    // EDITOR can scrape but not manage bots — keep it permissive for scraping
  }
  if (!member) { res.status(403).json({ error: 'Not a member' }); return }

  const { soundcloudUrl } = req.body as { soundcloudUrl: string }
  if (!soundcloudUrl?.includes('soundcloud.com')) {
    res.status(400).json({ error: 'Invalid SoundCloud URL' }); return
  }

  try {
    const meta = await resolveSCMetadata(soundcloudUrl)

    // Check if already scraped
    const existing = await prisma.track.findFirst({
      where: { workspaceId: req.params.wsId, soundcloudId: meta.id },
    })
    if (existing) { res.json({ track: existing, alreadyExists: true }); return }

    // Download via downloadSCTrackById which correctly resolves
    // the transcoding URL (JSON {url:"..."}) before downloading
    let filePath = ''
    let fileSize = 0
    try {
      const destDir = ensureWorkspaceDir(req.params.wsId)
      const filename = `${uuid()}.mp3`
      const result = await downloadSCTrackById(meta.id, destDir, filename)
      filePath = path.relative(STORAGE_ROOT, result.filePath)
      fileSize = result.fileSize
    } catch (e) {
      logger.warn('Could not download stream, saving metadata only', { err: String(e) })
    }

    const track = await prisma.track.create({
      data: {
        id: uuid(),
        workspaceId: req.params.wsId,
        title: meta.title,
        artist: meta.artist,
        artworkUrl: meta.artworkUrl,
        duration: meta.duration,
        soundcloudId: meta.id,
        soundcloudUrl: meta.permalink_url,
        filePath: filePath || '',
        fileSize: fileSize || null,
        format: 'mp3',
      },
    })
    res.status(201).json({ track })
  } catch (err) {
    logger.error('Scrape error', { err: String(err) })
    res.status(500).json({ error: 'Failed to scrape track' })
  }
})

/* ── POST /api/workspaces/:wsId/tracks/scrape-social ── */
router.post<WsParams>('/scrape-social', async (req, res) => {
  const member = await assertMember(req.params.wsId, req.user!.userId)
  if (!member) { res.status(403).json({ error: 'Not a member' }); return }

  const { url, outputFormat = 'MP3' } = req.body as { url?: string; outputFormat?: 'MP3' | 'MP4' }
  if (!url || !detectPlatform(url)) {
    res.status(400).json({ error: 'URL TikTok / Instagram / X / Snapchat / YouTube requise' }); return
  }

  try {
    const meta = await getYtdlpMeta(url)
    const platform = detectPlatform(url)!
    const socialId = `${platform}:${meta.id}`

    if (outputFormat === 'MP4') {
      // ── Gallery (VideoFile) ──
      // For Snapchat: skip yt-dlp duplicate check (stories change every 24h)
      if (platform !== 'snapchat') {
        const existing = await prisma.videoFile.findFirst({
          where: { workspaceId: req.params.wsId, socialId },
        })
        if (existing) { res.json({ video: existing, alreadyExists: true }); return }
      }

      let producedFiles: string[] = []
      try {
        const destDir = path.join(STORAGE_ROOT, 'videos', req.params.wsId)
        if (platform === 'snapchat') {
          // Direct scraper: extracts all story mediaUrls from the profile page
          producedFiles = await downloadSnapchatStories(url, destDir)
        } else {
          producedFiles = await downloadVideoYtdlp(url, destDir)
        }
      } catch (e) {
        logger.warn('Social video download failed', { err: String(e) })
        res.status(500).json({ error: String(e).replace('Error: ', '') }); return
      }

      const artist = extractUsernameFromUrl(url) ?? meta.uploader ?? meta.uploader_id ?? 'Unknown'
      const baseTitle = platform === 'snapchat'
        ? (extractUsernameFromUrl(url) ?? meta.title.replace(/\s*\(\d+\)\s*$/, '').trim())
        : meta.title

      const videos = await Promise.all(producedFiles.map(async (produced, i) => {
        const filePath = path.relative(STORAGE_ROOT, produced)
        const fileSize = fs.statSync(produced).size
        return prisma.videoFile.create({
          data: {
            id: uuid(),
            workspaceId: req.params.wsId,
            title: producedFiles.length > 1 ? `${baseTitle} - Story ${i + 1}` : baseTitle,
            artist,
            platform,
            sourceUrl: url,
            thumbnailUrl: meta.thumbnail,
            duration: meta.duration ? Math.floor(meta.duration) : null,
            filePath,
            fileSize: fileSize || null,
            socialId: `${socialId}:${i}`,
          },
        })
      }))
      res.status(201).json({ video: videos[0], count: videos.length })
    } else {
      // ── Library (Track / MP3) ──
      const existing = await prisma.track.findFirst({
        where: { workspaceId: req.params.wsId, soundcloudId: socialId },
      })
      if (existing) { res.json({ track: existing, alreadyExists: true }); return }

      let filePath = ''
      let fileSize = 0
      try {
        const destDir = ensureWorkspaceDir(req.params.wsId)
        const filename = uuid()
        const produced = await downloadAudioYtdlp(url, path.join(destDir, `${filename}.mp3`))
        filePath = path.relative(STORAGE_ROOT, produced)
        fileSize = fs.statSync(produced).size
      } catch (e) {
        logger.warn('Social audio download failed, saving metadata only', { err: String(e) })
      }

      const track = await prisma.track.create({
        data: {
          id: uuid(),
          workspaceId: req.params.wsId,
          title: meta.title,
          artist: meta.uploader ?? meta.uploader_id ?? extractUsernameFromUrl(url) ?? 'Unknown',
          artworkUrl: meta.thumbnail,
          duration: meta.duration ? Math.floor(meta.duration) : null,
          soundcloudId: socialId,
          soundcloudUrl: meta.webpage_url,
          filePath: filePath || '',
          fileSize: fileSize || null,
          format: 'mp3',
        },
      })
      res.status(201).json({ track })
    }
  } catch (err) {
    logger.error('Scrape social error', { err: String(err) })
    res.status(500).json({ error: String(err).replace('Error: ', '') })
  }
})

// ── Audio stream proxy (follows SoundCloud redirects) ───────────────────────
function proxyAudioStream(url: string, res: Response, depth = 0): void {
  if (depth > 6) { if (!res.headersSent) res.status(502).json({ error: 'Too many redirects' }); return }
  const protocol = url.startsWith('https') ? https : http
  protocol.get(url, { headers: { 'User-Agent': 'Vibot/1.0' }, timeout: 15_000 }, remote => {
    if (remote.statusCode === 301 || remote.statusCode === 302) {
      proxyAudioStream(remote.headers.location!, res, depth + 1)
      return
    }
    if ((remote.statusCode ?? 0) >= 400) {
      if (!res.headersSent) res.status(502).json({ error: `Upstream ${remote.statusCode}` })
      return
    }
    if (!res.headersSent) {
      res.setHeader('Content-Type', remote.headers['content-type'] ?? 'audio/mpeg')
      res.setHeader('Accept-Ranges', 'bytes')
      res.setHeader('Cache-Control', 'no-store')
      if (remote.headers['content-length']) res.setHeader('Content-Length', remote.headers['content-length'])
    }
    remote.pipe(res)
    remote.on('error', () => { if (!res.headersSent) res.status(502).end() })
  }).on('error', () => { if (!res.headersSent) res.status(502).json({ error: 'Stream error' }) })
}

// Resolve a SoundCloud transcoding URL to the actual CDN stream URL
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

const SC_CLIENT_ID = process.env.SC_CLIENT_ID ?? 'KKzJxmw11tYpCs6T24P4uUYhqmjalG6M'
const ALLOWED_SC = [
  'https://api.soundcloud.com',
  'https://api-v2.soundcloud.com',
  'https://api-widget.soundcloud.com',
]

/* ── GET /api/workspaces/:wsId/tracks/stream-preview ── */
router.get<WsParams>('/stream-preview', async (req, res) => {
  const member = await assertMember(req.params.wsId, req.user!.userId)
  if (!member) { res.status(403).json({ error: 'Not a member' }); return }

  const { streamUrl } = req.query as Record<string, string>
  if (!streamUrl || !ALLOWED_SC.some(h => streamUrl.startsWith(h))) {
    res.status(400).json({ error: 'Invalid stream URL' }); return
  }

  const urlWithKey = `${streamUrl}?client_id=${SC_CLIENT_ID}`

  // Transcoding URLs return JSON { url: "..." } — resolve to real CDN URL first
  const isTranscoding =
    streamUrl.includes('api-v2.soundcloud.com') ||
    streamUrl.includes('api-widget.soundcloud.com')

  if (isTranscoding) {
    const cdnUrl = await resolveTranscodingUrl(urlWithKey)
    if (!cdnUrl) { res.status(502).json({ error: 'Could not resolve stream' }); return }
    proxyAudioStream(cdnUrl, res)
  } else {
    proxyAudioStream(urlWithKey, res)
  }
})

/* ── GET /api/workspaces/:wsId/tracks/search ── */
router.get<WsParams>('/search', async (req, res) => {
  const member = await assertMember(req.params.wsId, req.user!.userId)
  if (!member) { res.status(403).json({ error: 'Not a member' }); return }

  const { q = '', offset = '0' } = req.query as Record<string, string>
  if (!q) { res.status(400).json({ error: 'Query required' }); return }

  try {
    const { tracks: results, hasMore } = await searchSoundCloud(q, 20, Number(offset))
    res.json({ results, hasMore, nextOffset: hasMore ? Number(offset) + 20 : null })
  } catch {
    res.status(500).json({ error: 'Search failed' })
  }
})

/* ── GET /api/workspaces/:wsId/tracks/resolve ── */
router.get<WsParams>('/resolve', async (req, res) => {
  const member = await assertMember(req.params.wsId, req.user!.userId)
  if (!member) { res.status(403).json({ error: 'Not a member' }); return }

  const { url } = req.query as Record<string, string>
  if (!url?.includes('soundcloud.com')) {
    res.status(400).json({ error: 'Invalid SoundCloud URL' }); return
  }

  try {
    const result = await resolveSCMetadata(url)
    res.json({ result })
  } catch {
    res.status(500).json({ error: 'Failed to resolve URL' })
  }
})

/* ── GET /api/workspaces/:wsId/tracks/resolve-social ── */
router.get<WsParams>('/resolve-social', async (req, res) => {
  const member = await assertMember(req.params.wsId, req.user!.userId)
  if (!member) { res.status(403).json({ error: 'Not a member' }); return }

  const { url } = req.query as Record<string, string>
  if (!url || !detectPlatform(url)) {
    res.status(400).json({ error: 'URL TikTok / Instagram / X / Snapchat / YouTube requise' }); return
  }

  try {
    const meta = await getYtdlpMeta(url)
    res.json({
      result: {
        id: meta.id,
        title: meta.title,
        artist: meta.uploader ?? meta.uploader_id ?? extractUsernameFromUrl(url) ?? 'Unknown',
        artworkUrl: meta.thumbnail,
        duration: meta.duration ? Math.floor(meta.duration) : undefined,
        permalink_url: meta.webpage_url,
        platform: detectPlatform(url),
      },
    })
  } catch (err) {
    res.status(500).json({ error: String(err).replace('Error: ', '') })
  }
})

/* ── POST /api/workspaces/:wsId/tracks/send ── */
router.post<WsParams>('/send', async (req, res) => {
  const member = await assertMember(req.params.wsId, req.user!.userId)
  if (!member) { res.status(403).json({ error: 'Not a member' }); return }

  const { trackIds, botId } = req.body as { trackIds?: string[]; botId?: string }
  if (!Array.isArray(trackIds) || !trackIds.length || !botId) {
    res.status(400).json({ error: 'trackIds (array) and botId are required' }); return
  }

  const bot = await prisma.bot.findFirst({ where: { id: botId, workspaceId: req.params.wsId } })
  if (!bot) { res.status(404).json({ error: 'Bot not found' }); return }

  const results: { trackId: string; ok: boolean; error?: string }[] = []

  for (const trackId of trackIds) {
    const track = await prisma.track.findFirst({
      where: { id: trackId, workspaceId: req.params.wsId },
    })
    if (!track) {
      results.push({ trackId, ok: false, error: 'Track not found' })
      continue
    }

    let abs = track.filePath ? path.join(STORAGE_ROOT, track.filePath) : ''

    // ── If no local file, try to download from SoundCloud first ─────────────
    if (!abs || !fs.existsSync(abs)) {
      if (!track.soundcloudId) {
        results.push({ trackId, ok: false, error: 'No local file and no SoundCloud source' })
        continue
      }
      try {
        const destDir = ensureWorkspaceDir(req.params.wsId)
        const filename = `${uuid()}.mp3`
        const result = await downloadSCTrackById(track.soundcloudId, destDir, filename)
        const relPath = path.relative(STORAGE_ROOT, result.filePath)
        await prisma.track.update({
          where: { id: trackId },
          data: { filePath: relPath, fileSize: result.fileSize },
        })
        abs = result.filePath
      } catch (e) {
        results.push({ trackId, ok: false, error: `Download failed: ${String(e).replace('Error: ', '')}` })
        continue
      }
    }

    try {
      const ext = path.extname(track.filePath).toLowerCase()
      const mimeMap: Record<string, string> = {
        '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
        '.flac': 'audio/flac', '.m4a': 'audio/mp4',
      }
      const mimeType = mimeMap[ext] ?? 'audio/mpeg'
      const fileBuffer = fs.readFileSync(abs)

      // Build caption
      const artistLine = track.artist
        ? `Artiste(s) - ${track.artist}${track.featuring ? ` Ft. ${track.featuring}` : ''}`
        : null
      const titleLine = `Titre - ${track.title}`
      const caption = [artistLine, titleLine].filter(Boolean).join('\n')

      const formData = new FormData()
      formData.append('chat_id', bot.channelId)
      formData.append('audio', new Blob([fileBuffer], { type: mimeType }), `${track.title ?? 'track'}${ext}`)
      if (track.title)    formData.append('title',     track.title)
      if (track.artist)   formData.append('performer', track.artist)
      if (track.duration) formData.append('duration',  String(Math.round(track.duration)))
      formData.append('caption', caption)

      const tgRes = await fetch(`https://api.telegram.org/bot${bot.telegramToken}/sendAudio`, {
        method: 'POST',
        body: formData,
      })
      const data = await tgRes.json() as { ok: boolean; result?: { message_id: number }; description?: string }
      if (data.ok) {
        // Persist the Telegram message_id so we can delete it later
        if (data.result?.message_id) {
          await prisma.telegramMessage.create({
            data: { id: uuid(), trackId, botId: bot.id, messageId: data.result.message_id },
          }).catch(() => {}) // non-critical
        }
        results.push({ trackId, ok: true })
      } else {
        results.push({ trackId, ok: false, error: data.description ?? 'Telegram error' })
      }
    } catch (err) {
      results.push({ trackId, ok: false, error: String(err) })
    }
  }

  const allOk = results.every(r => r.ok)
  res.status(allOk ? 200 : 207).json({ results })
})

/* ── PATCH /api/workspaces/:wsId/tracks/:trackId ── */
router.patch<TrackParams>('/:trackId', async (req, res) => {
  const member = await assertMember(req.params.wsId, req.user!.userId)
  if (!member) { res.status(403).json({ error: 'Not a member' }); return }

  const { title, artist, featuring, album, artworkUrl } = req.body as Record<string, string | undefined>
  try {
    const track = await prisma.track.update({
      where: { id: req.params.trackId },
      data: {
        ...(title      !== undefined && { title }),
        ...(artist     !== undefined && { artist }),
        ...(featuring  !== undefined && { featuring }),
        ...(album      !== undefined && { album }),
        ...(artworkUrl !== undefined && { artworkUrl }),
      },
    })
    res.json({ track })
  } catch {
    res.status(500).json({ error: 'Failed to update track' })
  }
})

/* ── POST /api/workspaces/:wsId/tracks/:trackId/artwork ── */
router.post<TrackParams>('/:trackId/artwork', uploadArtwork.single('artwork'), async (req, res) => {
  const member = await assertMember(req.params.wsId, req.user!.userId)
  if (!member) { res.status(403).json({ error: 'Not a member' }); return }
  if (!req.file) { res.status(400).json({ error: 'No file uploaded' }); return }

  const artworkUrl = `/storage/_artwork/${req.file.filename}`
  try {
    const track = await prisma.track.update({
      where: { id: req.params.trackId },
      data: { artworkUrl },
    })
    res.json({ track, artworkUrl })
  } catch {
    res.status(500).json({ error: 'Failed to update artwork' })
  }
})

/* ── DELETE /api/workspaces/:wsId/tracks/:trackId ── */
router.delete<TrackParams>('/:trackId', async (req, res) => {
  const member = await assertMember(req.params.wsId, req.user!.userId)
  if (!member || !['OWNER', 'MANAGER'].includes(member.role)) {
    res.status(403).json({ error: 'Insufficient permissions' }); return
  }

  try {
    const track = await prisma.track.findFirst({
      where: { id: req.params.trackId, workspaceId: req.params.wsId },
      include: { telegramMessages: { include: { bot: true } } },
    })
    if (!track) { res.status(404).json({ error: 'Track not found' }); return }

    // Delete from Telegram (best-effort — don't block if it fails)
    await Promise.allSettled(
      track.telegramMessages.map((msg: { bot: { telegramToken: string; channelId: string }; messageId: number }) =>
        fetch(
          `https://api.telegram.org/bot${msg.bot.telegramToken}/deleteMessage`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: msg.bot.channelId, message_id: msg.messageId }),
          },
        ),
      ),
    )

    // Delete file from disk
    if (track.filePath) {
      const abs = path.join(STORAGE_ROOT, track.filePath)
      if (fs.existsSync(abs)) fs.unlinkSync(abs)
    }

    await prisma.track.delete({ where: { id: track.id } })
    res.json({ message: 'Track deleted' })
  } catch {
    res.status(500).json({ error: 'Internal server error' })
  }
})

/* ── GET /api/workspaces/:wsId/tracks/:trackId/stream ── */
router.get<TrackParams>('/:trackId/stream', async (req, res) => {
  const member = await assertMember(req.params.wsId, req.user!.userId)
  if (!member) { res.status(403).json({ error: 'Not a member' }); return }

  try {
    const track = await prisma.track.findFirst({
      where: { id: req.params.trackId, workspaceId: req.params.wsId },
    })
    if (!track || !track.filePath) { res.status(404).json({ error: 'Track not found' }); return }

    const abs = path.join(STORAGE_ROOT, track.filePath)
    if (!fs.existsSync(abs)) { res.status(404).json({ error: 'File not found on disk' }); return }

    // Increment play count
    await prisma.track.update({ where: { id: track.id }, data: { playCount: { increment: 1 } } })

    const stat = fs.statSync(abs)
    const range = req.headers.range

    if (range) {
      const [startStr, endStr] = range.replace('bytes=', '').split('-')
      const start = parseInt(startStr, 10)
      const end = endStr ? parseInt(endStr, 10) : stat.size - 1
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1,
        'Content-Type': 'audio/mpeg',
      })
      fs.createReadStream(abs, { start, end }).pipe(res)
    } else {
      res.writeHead(200, {
        'Content-Length': stat.size,
        'Content-Type': 'audio/mpeg',
        'Accept-Ranges': 'bytes',
      })
      fs.createReadStream(abs).pipe(res)
    }
  } catch {
    res.status(500).json({ error: 'Stream error' })
  }
})

/* ── POST /api/workspaces/:wsId/tracks/:trackId/separate ── */
router.post<TrackParams>('/:trackId/separate', async (req, res) => {
  const member = await assertMember(req.params.wsId, req.user!.userId)
  if (!member) { res.status(403).json({ error: 'Not a member' }); return }

  try {
    const track = await prisma.track.findFirst({
      where: { id: req.params.trackId, workspaceId: req.params.wsId },
    })
    if (!track || !track.filePath) { res.status(404).json({ error: 'Track not found' }); return }

    const abs = path.join(STORAGE_ROOT, track.filePath)
    if (!fs.existsSync(abs)) { res.status(404).json({ error: 'File not found on disk' }); return }

    const stemsDir     = path.join(STORAGE_ROOT, 'stems', track.id)
    const vocalsPath   = path.join(stemsDir, 'vocals.mp3')
    const instrPath    = path.join(stemsDir, 'no_vocals.mp3')

    // Already separated — return immediately
    if (fs.existsSync(vocalsPath) && fs.existsSync(instrPath)) {
      res.json({ vocals: true, instrumental: true }); return
    }

    fs.mkdirSync(stemsDir, { recursive: true })

    const pythonExe = process.env.PYTHON_PATH ?? 'python'

    // Run demucs: python -m demucs --two-stems=vocals -n htdemucs --out stemsDir absFile
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(pythonExe, [
        '-m', 'demucs',
        '--two-stems=vocals',
        '--mp3',
        '-n', 'htdemucs',
        '--out', stemsDir,
        abs,
      ], { stdio: ['ignore', 'pipe', 'pipe'] })
      let stderr = ''
      proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString() })
      proc.stdout?.on('data', (d: Buffer) => { logger.info('[demucs] ' + d.toString().trim()) })
      proc.on('close', code => {
        if (code === 0) { resolve() }
        else {
          logger.error('[demucs stderr]\n' + stderr)
          reject(new Error(`demucs exit code ${code}: ${stderr.slice(-300)}`))
        }
      })
      proc.on('error', err => reject(new Error(`demucs not found: ${err.message}`)))
    })

    // Demucs outputs to stemsDir/htdemucs/<basename>/vocals.wav + no_vocals.wav
    // Scan for the actual output folder in case the basename differs
    const demucsBase = path.join(stemsDir, 'htdemucs')
    const subDirs = fs.existsSync(demucsBase)
      ? fs.readdirSync(demucsBase, { withFileTypes: true }).filter(d => d.isDirectory())
      : []
    const demucsOut = subDirs.length > 0
      ? path.join(demucsBase, subDirs[0].name)
      : path.join(demucsBase, path.basename(abs, path.extname(abs)))

    const genVocals = path.join(demucsOut, 'vocals.mp3')
    const genInstr  = path.join(demucsOut, 'no_vocals.mp3')

    if (!fs.existsSync(genVocals) || !fs.existsSync(genInstr)) {
      const tree = fs.existsSync(demucsBase) ? JSON.stringify(fs.readdirSync(demucsBase)) : 'missing'
      res.status(500).json({ error: `Demucs did not produce expected output files. htdemucs dir: ${tree}` }); return
    }

    fs.renameSync(genVocals, vocalsPath)
    fs.renameSync(genInstr,  instrPath)

    res.json({ vocals: true, instrumental: true })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Separation failed'
    res.status(500).json({ error: msg })
  }
})

/* ── GET /api/workspaces/:wsId/tracks/:trackId/stems/:stemType ── */
router.get<TrackParams & { stemType: string }>('/:trackId/stems/:stemType', async (req, res) => {
  const member = await assertMember(req.params.wsId, req.user!.userId)
  if (!member) { res.status(403).json({ error: 'Not a member' }); return }

  const { trackId, stemType } = req.params
  if (!['vocals', 'instrumental'].includes(stemType)) {
    res.status(400).json({ error: 'Invalid stem type. Use vocals or instrumental' }); return
  }

  const filename = stemType === 'instrumental' ? 'no_vocals.mp3' : 'vocals.mp3'
  const abs      = path.join(STORAGE_ROOT, 'stems', trackId, filename)

  if (!fs.existsSync(abs)) {
    res.status(404).json({ error: 'Stem not found. Run separation first.' }); return
  }

  try {
    const stat  = fs.statSync(abs)
    const range = req.headers.range

    if (range) {
      const [s, e] = range.replace('bytes=', '').split('-')
      const start  = parseInt(s, 10)
      const end    = e ? parseInt(e, 10) : stat.size - 1
      res.writeHead(206, {
        'Content-Range':  `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges':  'bytes',
        'Content-Length': end - start + 1,
        'Content-Type':   'audio/mpeg',
      })
      fs.createReadStream(abs, { start, end }).pipe(res)
    } else {
      res.writeHead(200, {
        'Content-Length': stat.size,
        'Content-Type':   'audio/mpeg',
        'Accept-Ranges':  'bytes',
      })
      fs.createReadStream(abs).pipe(res)
    }
  } catch {
    res.status(500).json({ error: 'Stream error' })
  }
})

export default router
