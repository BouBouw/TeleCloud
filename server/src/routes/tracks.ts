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
import { getYtdlpMeta, getYouTubeOembedMeta, downloadAudioYtdlp, downloadVideoYtdlp, downloadSnapchatStories, detectPlatform } from '../services/ytdlp'
import { getInvidiousMeta, downloadAudioViaInvidious, downloadVideoViaInvidious, downloadAudioViaCobalt, downloadVideoViaCobalt } from '../services/invidious'
import * as tunnelQueue from '../services/tunnelQueue'
import * as instagramService from '../services/instagram'
import * as notifs from '../services/notifications'
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

/** Extract Instagram shortcode from a post/reel URL */
function extractCode(url: string): string | null {
  const m = url.match(/instagram\.com\/(?:p|reel|tv)\/([\w-]+)/)
  return m?.[1] ?? null
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
      include: { _count: { select: { telegramMessages: true } } },
    })
    const total = await prisma.track.count({ where: { workspaceId: req.params.wsId } })
    res.json({
      tracks: tracks.map(({ _count, ...t }) => ({ ...t, sent: _count.telegramMessages > 0 })),
      total,
    })
  } catch {
    res.status(500).json({ error: 'Internal server error' })
  }
})

/* ── GET /api/workspaces/:wsId/tracks/recent-artworks ── */
router.get<WsParams>('/recent-artworks', async (req, res) => {
  const member = await assertMember(req.params.wsId, req.user!.userId)
  if (!member) { res.status(403).json({ error: 'Not a member' }); return }
  try {
    const rows = await prisma.track.findMany({
      where: { workspaceId: req.params.wsId, artworkUrl: { not: null } },
      orderBy: { updatedAt: 'desc' },
      select: { artworkUrl: true },
      take: 30,
    })
    const seen = new Set<string>()
    const urls: string[] = []
    for (const row of rows) {
      if (row.artworkUrl && !seen.has(row.artworkUrl)) {
        seen.add(row.artworkUrl)
        urls.push(row.artworkUrl)
        if (urls.length >= 3) break
      }
    }
    res.json({ artworkUrls: urls })
  } catch {
    res.status(500).json({ error: 'Internal server error' })
  }
})

/* ── POST /api/workspaces/:wsId/tracks/import ── copy tracks from another workspace ── */
router.post<WsParams>('/import', async (req, res) => {
  const member = await assertMember(req.params.wsId, req.user!.userId)
  if (!member) { res.status(403).json({ error: 'Not a member' }); return }

  const { fromWorkspaceId, trackIds } = req.body as { fromWorkspaceId?: string; trackIds?: string[] }
  if (!fromWorkspaceId || !Array.isArray(trackIds) || !trackIds.length) {
    res.status(400).json({ error: 'fromWorkspaceId and trackIds are required' }); return
  }
  // User must be member of the source workspace too
  const srcMember = await assertMember(fromWorkspaceId, req.user!.userId)
  if (!srcMember) { res.status(403).json({ error: 'Not a member of source workspace' }); return }

  const destDir = ensureWorkspaceDir(req.params.wsId)
  const imported: object[] = []

  for (const trackId of trackIds) {
    const src = await prisma.track.findFirst({ where: { id: trackId, workspaceId: fromWorkspaceId } })
    if (!src) continue

    // Copy audio file if it exists locally
    let newFilePath: string | null = null
    let newFileSize: number | null = null
    if (src.filePath) {
      const srcAbs = path.join(STORAGE_ROOT, src.filePath)
      if (fs.existsSync(srcAbs)) {
        const ext  = path.extname(srcAbs) || '.mp3'
        const dest = path.join(destDir, `${uuid()}${ext}`)
        fs.copyFileSync(srcAbs, dest)
        newFilePath = path.relative(STORAGE_ROOT, dest)
        newFileSize = src.fileSize ?? null
      }
    }

    const track = await prisma.track.create({
      data: {
        id:          uuid(),
        workspaceId: req.params.wsId,
        title:       src.title,
        artist:      src.artist,
        featuring:   src.featuring,
        album:       src.album,
        artworkUrl:  src.artworkUrl,
        duration:    src.duration,
        soundcloudId: src.soundcloudId,
        filePath:    newFilePath,
        fileSize:    newFileSize,
      },
    })
    imported.push(track)
  }

  res.json({ imported, count: imported.length })
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
    notifs.push(req.params.wsId, 'track:added', 'Fichier importé', `« ${track.title} » a été ajouté à la bibliothèque.`, '/library')
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
  if (!soundcloudUrl?.match(/soundcloud\.com/i)) {
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
    notifs.push(req.params.wsId, 'track:added', 'SoundCloud téléchargé', `« ${track.title} » a été ajouté à la bibliothèque.`, '/library')
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
    const platform = detectPlatform(url)!

    // ── Instagram: try CF Worker relay first, fall back to yt-dlp+cookies ──
    if (platform === 'instagram' && instagramService.isConfigured()) {
      try {
        const igMeta   = await instagramService.getInstagramMeta(url)
        const socialId = `instagram:${extractCode(url) ?? url}`

        if (outputFormat === 'MP4') {
          const existing = await prisma.videoFile.findFirst({ where: { workspaceId: req.params.wsId, socialId } })
          if (existing) { res.json({ video: existing, alreadyExists: true }); return }

          const destDir  = path.join(STORAGE_ROOT, 'videos', req.params.wsId)
          const produced = await instagramService.downloadInstagramVideo(url, destDir, uuid())
          const filePath = path.relative(STORAGE_ROOT, produced)
          const video    = await prisma.videoFile.create({
            data: {
              id: uuid(), workspaceId: req.params.wsId,
              title: igMeta.title || 'Instagram video',
              artist: igMeta.uploader ?? extractUsernameFromUrl(url) ?? 'Unknown',
              platform, sourceUrl: url, thumbnailUrl: igMeta.thumbnail,
              duration: igMeta.duration ? Math.floor(igMeta.duration) : null,
              filePath, fileSize: fs.statSync(produced).size || null, socialId,
            },
          })
          res.status(201).json({ video, count: 1 }); return
        } else {
          const existing = await prisma.track.findFirst({ where: { workspaceId: req.params.wsId, soundcloudId: socialId } })
          if (existing) { res.json({ track: existing, alreadyExists: true }); return }

          const destDir = ensureWorkspaceDir(req.params.wsId)
          const mp3Path = path.join(destDir, `${uuid()}.mp3`)
          let filePath = '', fileSize = 0
          try {
            await instagramService.downloadInstagramAudio(url, mp3Path)
            filePath = path.relative(STORAGE_ROOT, mp3Path)
            fileSize = fs.statSync(mp3Path).size
          } catch (e) { logger.warn('Instagram CF audio download failed', { err: String(e) }) }

          const track = await prisma.track.create({
            data: {
              id: uuid(), workspaceId: req.params.wsId,
              title: igMeta.title || 'Instagram audio',
              artist: igMeta.uploader ?? extractUsernameFromUrl(url) ?? 'Unknown',
              artworkUrl: igMeta.thumbnail,
              duration: igMeta.duration ? Math.floor(igMeta.duration) : null,
              soundcloudId: socialId, soundcloudUrl: url,
              filePath: filePath || '', fileSize: fileSize || null, format: 'mp3',
            },
          })
          notifs.push(req.params.wsId, 'track:added', 'Instagram téléchargé', `« ${track.title} » a été ajouté à la bibliothèque.`, '/library')
          res.status(201).json({ track }); return
        }
      } catch (igErr) {
        logger.warn('Instagram CF Worker failed, falling back to yt-dlp', { err: String(igErr) })
        // fall through to yt-dlp path below
      }
    }

    // For YouTube: try Invidious/Piped (proxied) → oEmbed → stub so download can proceed
    // For other platforms: yt-dlp (handles TikTok, Instagram, etc.)
    let meta: Awaited<ReturnType<typeof getYtdlpMeta>> | null = null
    if (platform === 'youtube') {
      try {
        const inv = await getInvidiousMeta(url)
        meta = { id: inv.id, title: inv.title, uploader: inv.uploader, thumbnail: inv.thumbnail, duration: inv.duration, webpage_url: inv.webpage_url, extractor: 'youtube' }
      } catch { /* fall through to oEmbed */ }
      if (!meta) {
        try { meta = await getYouTubeOembedMeta(url) } catch { /* fall through to stub */ }
      }
      if (!meta) {
        // All metadata sources failed — create stub so the download can still proceed
        // (Invidious/Cobalt download chain doesn't need pre-fetched metadata)
        const videoId = url.match(/(?:v=|youtu\.be\/|\/shorts\/|\/embed\/)([A-Za-z0-9_-]{11})/)?.[1] ?? 'unknown'
        meta = { id: videoId, title: 'Vidéo YouTube', webpage_url: `https://www.youtube.com/watch?v=${videoId}`, extractor: 'youtube' }
      }
    } else {
      meta = await getYtdlpMeta(url)
    }
    const socialId = `${platform}:${meta.id}`

    // ── Tunnel shortcut: if the local tunnel is connected, delegate YouTube downloads to it ──
    // The tunnel runs on the user's machine with real browser cookies → bypasses bot-check.
    if (platform === 'youtube' && tunnelQueue.isTunnelActive()) {
      const job = tunnelQueue.createJob(
        req.params.wsId,
        req.user!.userId,
        url,
        outputFormat,
        { ytId: meta.id, title: meta.title, uploader: meta.uploader, thumbnail: meta.thumbnail, duration: meta.duration, webpage_url: meta.webpage_url },
      )
      res.status(202).json({ status: 'queued', jobId: job.id, meta: { title: meta.title, thumbnail: meta.thumbnail } })
      return
    }

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
          producedFiles = await downloadSnapchatStories(url, destDir)
        } else if (platform === 'youtube') {
          // Chain: Invidious/Piped → cobalt → yt-dlp (each proxies via external servers)
          const destFile = path.join(destDir, `${uuid()}.mp4`)
          fs.mkdirSync(destDir, { recursive: true })
          let ytDone = false
          try {
            await downloadVideoViaInvidious(url, destFile)
            producedFiles = [destFile]
            ytDone = true
          } catch (e1) {
            logger.warn('Invidious/Piped MP4 failed, trying cobalt', { err: String(e1) })
          }
          if (!ytDone) {
            try {
              await downloadVideoViaCobalt(url, destFile)
              producedFiles = [destFile]
              ytDone = true
            } catch (e2) {
              logger.warn('Cobalt MP4 failed, falling back to yt-dlp', { err: String(e2) })
            }
          }
          if (!ytDone) {
            producedFiles = await downloadVideoYtdlp(url, destDir)
          }
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
      notifs.push(req.params.wsId, 'track:added',
        `${platform.charAt(0).toUpperCase() + platform.slice(1)} vidéo ajoutée`,
        `${videos.length} vidéo${videos.length > 1 ? 's' : ''} « ${baseTitle} » importée${videos.length > 1 ? 's' : ''}.`,
        '/gallery'
      )
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
        const mp3Path = path.join(destDir, `${filename}.mp3`)
        if (platform === 'youtube') {
          // Chain: Invidious/Piped → cobalt → yt-dlp
          let audioDone = false
          try {
            await downloadAudioViaInvidious(url, mp3Path)
            audioDone = true
          } catch (ea1) {
            logger.warn('Invidious/Piped MP3 failed, trying cobalt', { err: String(ea1) })
          }
          if (!audioDone) {
            try {
              await downloadAudioViaCobalt(url, mp3Path)
              audioDone = true
            } catch (ea2) {
              logger.warn('Cobalt MP3 failed, falling back to yt-dlp', { err: String(ea2) })
            }
          }
          if (!audioDone) {
            await downloadAudioYtdlp(url, mp3Path)
          }
        } else {
          await downloadAudioYtdlp(url, mp3Path)
        }
        filePath = path.relative(STORAGE_ROOT, mp3Path)
        fileSize = fs.statSync(mp3Path).size
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
      notifs.push(req.params.wsId, 'track:added',
        `${platform.charAt(0).toUpperCase() + platform.slice(1)} téléchargé`,
        `« ${track.title} » a été ajouté à la bibliothèque.`,
        '/library'
      )
      res.status(201).json({ track })
    }
  } catch (err) {
    logger.error('Scrape social error', { err: String(err) })
    notifs.push(req.params.wsId, 'track:error', 'Téléchargement échoué', String(err).replace('Error: ', '').slice(0, 100))
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
  if (!url?.match(/soundcloud\.com/i)) {
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
    const platform = detectPlatform(url)!
    // For YouTube: Invidious/Piped → oEmbed → stub (never call yt-dlp for YouTube metadata — it bot-checks)
    let meta: Awaited<ReturnType<typeof getYtdlpMeta>> | null = null
    if (platform === 'youtube') {
      try {
        const inv = await getInvidiousMeta(url)
        meta = { id: inv.id, title: inv.title, uploader: inv.uploader, thumbnail: inv.thumbnail, duration: inv.duration, webpage_url: inv.webpage_url, uploader_id: undefined, extractor: 'youtube' }
      } catch {
        meta = await getYouTubeOembedMeta(url)
      }
      if (!meta) {
        const videoId = url.match(/(?:v=|youtu\.be\/|\/shorts\/|\/embed\/)([A-Za-z0-9_-]{11})/)?.[1] ?? 'unknown'
        meta = { id: videoId, title: 'Vidéo YouTube', webpage_url: `https://www.youtube.com/watch?v=${videoId}`, uploader_id: undefined, extractor: 'youtube' }
      }
    } else {
      meta = await getYtdlpMeta(url)
    }
    res.json({
      result: {
        id: meta.id,
        title: meta.title,
        artist: meta.uploader ?? meta.uploader_id ?? extractUsernameFromUrl(url) ?? 'Unknown',
        artworkUrl: meta.thumbnail,
        duration: meta.duration ? Math.floor(meta.duration) : undefined,
        permalink_url: meta.webpage_url,
        platform,
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

  const { trackIds, botId, message: extraMessage, groupFiles } = req.body as {
    trackIds?: string[]; botId?: string; message?: string; groupFiles?: boolean
  }
  if (!Array.isArray(trackIds) || !trackIds.length || !botId) {
    res.status(400).json({ error: 'trackIds (array) and botId are required' }); return
  }

  // Allow bots from any workspace the user has access to (cross-workspace send)
  const bot = await prisma.bot.findFirst({ where: { id: botId } })
  if (!bot) { res.status(404).json({ error: 'Bot not found' }); return }
  if (bot.workspaceId !== req.params.wsId) {
    const botWsMember = await prisma.workspaceMember.findFirst({
      where: { workspaceId: bot.workspaceId, userId: req.user!.userId },
    })
    if (!botWsMember) { res.status(403).json({ error: 'No access to bot workspace' }); return }
    if (botWsMember.role !== 'owner' && !botWsMember.libSend) {
      res.status(403).json({ error: 'No send permission in bot workspace' }); return
    }
  }

  const results: { trackId: string; ok: boolean; error?: string }[] = []

  // ── Group files as Telegram media album ─────────────────────────────────
  if (groupFiles && trackIds.length > 1) {
    const chatId = /^-?\d+$/.test(bot.channelId)
      ? bot.channelId
      : bot.channelId.startsWith('@') ? bot.channelId : `@${bot.channelId}`
    const mediaGroup: object[] = []
    const fileBuffers: { trackId: string; buffer: Buffer; mimeType: string; filename: string }[] = []

    for (const trackId of trackIds) {
      const track = await prisma.track.findFirst({ where: { id: trackId, workspaceId: req.params.wsId } })
      if (!track) { results.push({ trackId, ok: false, error: 'Track not found' }); continue }
      const abs = track.filePath ? path.join(STORAGE_ROOT, track.filePath) : ''
      if (!abs || !fs.existsSync(abs)) { results.push({ trackId, ok: false, error: 'Fichier introuvable' }); continue }
      const ext = path.extname(track.filePath).toLowerCase()
      const mimeMap: Record<string, string> = { '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.flac': 'audio/flac', '.m4a': 'audio/mp4' }
      const artistLine = track.artist ? `Artiste(s) - ${track.artist}${track.featuring ? ` Ft. ${track.featuring}` : ''}` : null
      const caption = [artistLine, `Titre - ${track.title}`, extraMessage?.trim() || null].filter(Boolean).join('\n')
      fileBuffers.push({ trackId, buffer: fs.readFileSync(abs), mimeType: mimeMap[ext] ?? 'audio/mpeg', filename: `${track.title ?? 'track'}${ext}` })
      mediaGroup.push({
        type: 'audio',
        media: `attach://file_${fileBuffers.length - 1}`,
        title: track.title ?? undefined,
        performer: track.artist ?? undefined,
        duration: track.duration ? Math.round(track.duration) : undefined,
        caption,
      })
    }

    if (mediaGroup.length > 0) {
      const formData = new FormData()
      formData.append('chat_id', chatId)
      formData.append('media', JSON.stringify(mediaGroup))
      fileBuffers.forEach((f, idx) => {
        formData.append(`file_${idx}`, new Blob([f.buffer], { type: f.mimeType }), f.filename)
      })
      try {
        const tgRes = await fetch(`https://api.telegram.org/bot${bot.telegramToken}/sendMediaGroup`, { method: 'POST', body: formData })
        const data = await tgRes.json() as { ok: boolean; description?: string }
        if (data.ok) {
          fileBuffers.forEach(f => results.push({ trackId: f.trackId, ok: true }))
        } else {
          fileBuffers.forEach(f => results.push({ trackId: f.trackId, ok: false, error: data.description ?? 'Telegram error' }))
        }
      } catch (err) {
        fileBuffers.forEach(f => results.push({ trackId: f.trackId, ok: false, error: String(err) }))
      }
    }

    const allOk = results.every(r => r.ok)
    res.status(allOk ? 200 : 207).json({ results })
    return
  }

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
      // Only real SoundCloud IDs (numeric) can be re-downloaded
      const isSCId = track.soundcloudId && /^\d+$/.test(track.soundcloudId)
      if (!isSCId) {
        results.push({ trackId, ok: false, error: 'Fichier audio introuvable sur le serveur' })
        continue
      }
      try {
        const destDir = ensureWorkspaceDir(req.params.wsId)
        const filename = `${uuid()}.mp3`
        const result = await downloadSCTrackById(track.soundcloudId!, destDir, filename)
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
      const caption = [artistLine, titleLine, extraMessage?.trim() || null].filter(Boolean).join('\n')

      const formData = new FormData()
      // Normalize channelId: numeric IDs stay as-is, usernames need @ prefix
      const chatId = /^-?\d+$/.test(bot.channelId)
        ? bot.channelId
        : bot.channelId.startsWith('@') ? bot.channelId : `@${bot.channelId}`
      formData.append('chat_id', chatId)
      formData.append('audio', new Blob([fileBuffer], { type: mimeType }), `${track.title ?? 'track'}${ext}`)
      if (track.title)    formData.append('title',     track.title)
      if (track.artist)   formData.append('performer', track.artist)
      if (track.duration) formData.append('duration',  String(Math.round(track.duration)))
      formData.append('caption', caption)
      // Attach cover art — Telegram requires JPEG ≤320×320 ≤200KB.
      // Resize/convert with FFmpeg to guarantee compliance.
      if (track.artworkUrl) {
        try {
          let rawBuf: Buffer | null = null
          if (track.artworkUrl.startsWith('/storage/')) {
            const thumbAbs = path.join(STORAGE_ROOT, track.artworkUrl.replace('/storage/', ''))
            if (fs.existsSync(thumbAbs)) rawBuf = fs.readFileSync(thumbAbs)
          } else if (/^https?:\/\//i.test(track.artworkUrl)) {
            const r = await fetch(track.artworkUrl, { signal: AbortSignal.timeout(8000) })
            if (r.ok) rawBuf = Buffer.from(await r.arrayBuffer())
          }
          if (rawBuf) {
            // Convert + resize to JPEG 320×320 via FFmpeg pipe
            const thumbBuf = await new Promise<Buffer>((res, rej) => {
              const chunks: Buffer[] = []
              const proc = spawn('ffmpeg', [
                '-i', 'pipe:0',
                '-vf', 'scale=320:320:force_original_aspect_ratio=decrease,pad=320:320:(ow-iw)/2:(oh-ih)/2:color=black',
                '-frames:v', '1', '-q:v', '4',
                '-f', 'mjpeg', 'pipe:1',
              ], { stdio: ['pipe', 'pipe', 'ignore'] })
              proc.stdout.on('data', (d: Buffer) => chunks.push(d))
              proc.on('close', code => code === 0 ? res(Buffer.concat(chunks)) : rej(new Error(`ffmpeg thumb code ${code}`)))
              proc.on('error', rej)
              proc.stdin.end(rawBuf)
            })
            if (thumbBuf.length <= 200 * 1024) {
              formData.append('thumbnail', new Blob([thumbBuf], { type: 'image/jpeg' }), 'cover.jpg')
            }
          }
        } catch { /* cover is non-critical */ }
      }

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

        // Auto-react to the posted message if a reaction emoji is configured on the bot
        if (bot.reaction && data.result?.message_id) {
          fetch(`https://api.telegram.org/bot${bot.telegramToken}/setMessageReaction`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id:    chatId,
              message_id: data.result.message_id,
              reaction:   [{ type: 'emoji', emoji: bot.reaction }],
              is_big:     false,
            }),
          }).catch(() => {}) // non-critical, fire-and-forget
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

/* ── POST /api/workspaces/:wsId/tracks/sync-telegram ─────────────────────────
   Fetches audio files from a Telegram channel/chat via getHistory and imports
   any that aren't already in the library.

   Body: { botId: string }
   Strategy:
     1. Load the bot record to get telegramToken + channelId
     2. Call Telegram getUpdates (with allowed_updates=["channel_post","message"])
        OR use getChat + forwardMessages trick — we use the simpler approach:
        iterate messages via getHistory (Bot API doesn't expose full history,
        so we use the last 100 updates filtered by audio/document/voice).
     3. For each audio not yet in library (dedup by file_unique_id stored as soundcloudId):
        a. getFile → download from Telegram CDN → save to storage
        b. create Track record
   Returns: { imported: number; skipped: number; tracks: Track[] }
───────────────────────────────────────────────────────────────────────────── */
router.post<WsParams>('/sync-telegram', async (req, res) => {
  const member = await assertMember(req.params.wsId, req.user!.userId)
  if (!member) { res.status(403).json({ error: 'Not a member' }); return }

  const { botId } = req.body as { botId?: string }
  if (!botId) { res.status(400).json({ error: 'botId requis' }); return }

  const bot = await prisma.bot.findFirst({
    where: { id: botId, workspaceId: req.params.wsId },
  })
  if (!bot) { res.status(404).json({ error: 'Bot introuvable' }); return }

  const TG = `https://api.telegram.org/bot${bot.telegramToken}`
  const TG_FILE = `https://api.telegram.org/file/bot${bot.telegramToken}`
  const destDir = ensureWorkspaceDir(req.params.wsId)

  type TgAudio = {
    file_id: string; file_unique_id: string; file_name?: string
    title?: string; performer?: string; duration?: number; file_size?: number
    mime_type?: string; thumb?: { file_id: string }
  }
  type TgMessage = {
    message_id: number
    audio?: TgAudio
    document?: TgAudio & { file_name: string; mime_type: string }
    voice?: TgAudio
    caption?: string
  }
  type TgUpdate = { update_id: number; message?: TgMessage; channel_post?: TgMessage }

  // Helper: download a Telegram file to a local path
  async function downloadTgFile(fileId: string, destPath: string): Promise<number> {
    const gfRes = await fetch(`${TG}/getFile?file_id=${encodeURIComponent(fileId)}`)
    const gfJson = await gfRes.json() as { ok: boolean; result?: { file_path: string; file_size?: number } }
    if (!gfJson.ok || !gfJson.result?.file_path) throw new Error('getFile failed')
    const fileUrl = `${TG_FILE}/${gfJson.result.file_path}`
    const dlRes = await fetch(fileUrl)
    if (!dlRes.ok) throw new Error(`Download failed: ${dlRes.status}`)
    const buf = Buffer.from(await dlRes.arrayBuffer())
    fs.writeFileSync(destPath, buf)
    return buf.length
  }

  // Fetch last 100 updates from Telegram
  let updates: TgUpdate[] = []
  try {
    const resp = await fetch(`${TG}/getUpdates?limit=100&timeout=0&allowed_updates=["message","channel_post"]`)
    const json = await resp.json() as { ok: boolean; result?: TgUpdate[] }
    if (json.ok) updates = json.result ?? []
  } catch (e) {
    logger.warn('Telegram getUpdates failed', { err: String(e) })
    res.status(502).json({ error: 'Impossible de contacter Telegram. Vérifiez le token du bot.' }); return
  }

  // Also try to get messages from the channel directly (exportChatInviteLink / forwardMessages not needed)
  // We collect all audio-like objects from updates
  const audioItems: Array<{ audio: TgAudio; caption?: string }> = []
  for (const upd of updates) {
    const msg = upd.channel_post ?? upd.message
    if (!msg) continue
    // Audio
    if (msg.audio) audioItems.push({ audio: msg.audio, caption: msg.caption })
    // Voice note
    if (msg.voice) audioItems.push({ audio: msg.voice })
    // Document with audio mime type
    if (msg.document && (
      msg.document.mime_type?.startsWith('audio/') ||
      /\.(mp3|wav|ogg|flac|m4a|aac)$/i.test(msg.document.file_name ?? '')
    )) audioItems.push({ audio: msg.document, caption: msg.caption })
  }

  // Deduplicate by file_unique_id and skip already imported
  const imported: typeof import('../lib/prisma').default extends infer P
    ? Awaited<ReturnType<typeof prisma.track.findFirst>>[]
    : never = [] as Awaited<ReturnType<typeof prisma.track.findFirst>>[]
  let skipped = 0

  for (const { audio, caption } of audioItems) {
    const telegramKey = `telegram:${audio.file_unique_id}`

    // Already in library with file present → skip
    const existing = await prisma.track.findFirst({
      where: { workspaceId: req.params.wsId, soundcloudId: telegramKey },
    })
    if (existing) {
      const absPath = existing.filePath ? path.join(STORAGE_ROOT, existing.filePath) : ''
      const fileMissing = !absPath || !fs.existsSync(absPath)
      if (!fileMissing) { skipped++; continue }
      // File missing → re-download and update record
      const mimeToExtR: Record<string, string> = {
        'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/wav': 'wav',
        'audio/flac': 'flac', 'audio/x-m4a': 'm4a', 'audio/mp4': 'm4a', 'audio/aac': 'm4a',
      }
      const extR = audio.mime_type ? (mimeToExtR[audio.mime_type] ?? 'mp3')
        : path.extname(audio.file_name ?? '').replace('.', '') || 'mp3'
      const destPathR = path.join(destDir, `${uuid()}.${extR}`)
      try {
        const sizeR = await downloadTgFile(audio.file_id, destPathR)
        await prisma.track.update({
          where: { id: existing.id },
          data: { filePath: path.relative(STORAGE_ROOT, destPathR), fileSize: sizeR },
        })
      } catch (e) {
        logger.warn('Re-download of missing file failed', { err: String(e) })
      }
      skipped++; continue
    }

    // Check for duplicate by file size + duration (catches tracks that were sent to Telegram
    // from the library then synced back — they have a different soundcloudId but same content)
    if (audio.file_size && audio.duration) {
      const duplicate = await prisma.track.findFirst({
        where: {
          workspaceId: req.params.wsId,
          fileSize: audio.file_size,
          duration: audio.duration,
        },
      })
      if (duplicate) { skipped++; continue }
    }

    // Check for duplicate by title + duration (catches re-encoded files where fileSize differs)
    // Normalize: lowercase, strip special chars and common suffixes
    const normTitle = (s?: string | null) =>
      (s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '').slice(0, 60)
    if (audio.title && audio.duration) {
      const nt = normTitle(audio.title)
      const na = normTitle(audio.performer)
      const candidates = await prisma.track.findMany({
        where: { workspaceId: req.params.wsId, duration: { gte: audio.duration - 2, lte: audio.duration + 2 } },
        select: { id: true, title: true, artist: true },
      })
      const dup = candidates.find(c =>
        normTitle(c.title) === nt && (na === '' || normTitle(c.artist) === na || normTitle(c.artist) === '')
      )
      if (dup) { skipped++; continue }
    }

    // Determine extension and title
    const mimeToExt: Record<string, string> = {
      'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/wav': 'wav',
      'audio/flac': 'flac', 'audio/x-m4a': 'm4a', 'audio/mp4': 'm4a', 'audio/aac': 'm4a',
    }
    const ext = audio.mime_type ? (mimeToExt[audio.mime_type] ?? 'mp3')
      : path.extname(audio.file_name ?? '').replace('.', '') || 'mp3'
    const filename = `${uuid()}.${ext}`
    const destPath = path.join(destDir, filename)

    // Skip files > 50 MB (Telegram limit is 20 MB for bots anyway)
    if (audio.file_size && audio.file_size > 50 * 1024 * 1024) { skipped++; continue }

    let fileSize = audio.file_size ?? 0
    try {
      fileSize = await downloadTgFile(audio.file_id, destPath)
    } catch (e) {
      logger.warn('Telegram file download failed', { fileId: audio.file_id, err: String(e) })
      skipped++; continue
    }

    // Artwork: try to download thumb
    let artworkUrl: string | undefined
    if (audio.thumb?.file_id) {
      try {
        const thumbPath = path.join(STORAGE_ROOT, '_artwork', `${uuid()}.jpg`)
        fs.mkdirSync(path.dirname(thumbPath), { recursive: true })
        await downloadTgFile(audio.thumb.file_id, thumbPath)
        artworkUrl = `/storage/_artwork/${path.basename(thumbPath)}`
      } catch { /* ignore */ }
    }

    // Title / artist from metadata or caption
    const rawTitle = audio.title ?? audio.file_name ?? caption ?? 'Telegram audio'
    const title    = rawTitle.replace(/\.[a-z0-9]{2,5}$/i, '').trim() || 'Telegram audio'
    const artist   = audio.performer ?? 'Telegram'

    const track = await prisma.track.create({
      data: {
        id: uuid(), workspaceId: req.params.wsId,
        title, artist, artworkUrl,
        duration: audio.duration ?? null,
        fileSize: fileSize || null,
        format: ext,
        filePath: path.relative(STORAGE_ROOT, destPath),
        soundcloudId: telegramKey,  // reuse dedup field
      },
    })
    notifs.push(req.params.wsId, 'track:added', 'Telegram importé', `« ${title} » importé depuis Telegram.`, '/library')
    imported.push(track)
  }

  res.json({ imported: imported.length, skipped, tracks: imported })
})

/* ── GET /api/workspaces/:wsId/tracks/sync-telegram-full ─────────────────────
   SSE stream — iterates the ENTIRE Telegram channel history via Telethon MTProto.
   No Bot API 100-message limit. Requires TELEGRAM_API_ID + TELEGRAM_API_HASH in .env.
   Auth: ?token= query param (EventSource can't set headers).
   Query: botId=xxx
   Events: start | progress | warning | done | error
────────────────────────────────────────────────────────────────────────────── */
router.get<WsParams>('/sync-telegram-full', async (req, res) => {
  const member = await assertMember(req.params.wsId, req.user!.userId)
  if (!member) { res.status(403).json({ error: 'Not a member' }); return }

  const { botId } = req.query as { botId?: string }
  if (!botId) { res.status(400).json({ error: 'botId requis' }); return }

  const bot = await prisma.bot.findFirst({
    where: { id: botId, workspaceId: req.params.wsId },
  })
  if (!bot) { res.status(404).json({ error: 'Bot introuvable' }); return }

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()

  const send = (data: object) => {
    try { res.write(`data: ${JSON.stringify(data)}\n\n`) } catch { /* disconnected */ }
  }

  const scriptPath = path.join(process.cwd(), 'scripts', 'telegram_full_sync.py')
  const pythonBin  = process.env.PYTHON_BIN ?? 'python3'

  if (!fs.existsSync(scriptPath)) {
    send({ status: 'error', error: `Script introuvable : ${scriptPath}` })
    res.end(); return
  }

  const proc = spawn(pythonBin, [
    scriptPath,
    bot.telegramToken,
    bot.channelId,
    ensureWorkspaceDir(req.params.wsId),
    STORAGE_ROOT,
  ], {
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let buffer  = ''
  let imported = 0
  let skipped  = 0

  proc.stdout.on('data', async (chunk: Buffer) => {
    buffer += chunk.toString()
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const obj = JSON.parse(line) as {
          status: string
          count?: number
          title?: string
          total?: number
          error?: string
          result?: {
            fileUniqueId: string; filePath: string; title: string; artist: string
            duration?: number; fileSize?: number; alreadyExists: boolean
          }
        }

        if (obj.status === 'start') {
          send({ status: 'start', total: obj.total })

        } else if (obj.status === 'progress' && obj.result) {
          const r = obj.result
          const telegramKey = `telegram:${r.fileUniqueId}`

          if (r.alreadyExists) {
            skipped++
          } else {
            const exists = await prisma.track.findFirst({
              where: { workspaceId: req.params.wsId, soundcloudId: telegramKey },
            })
            // Check by fileSize+duration
            const duplicate = !exists && r.fileSize && r.duration
              ? await prisma.track.findFirst({
                  where: { workspaceId: req.params.wsId, fileSize: r.fileSize, duration: r.duration },
                })
              : null
            // Check by title+duration (catches re-encoded files with different fileSize)
            const normTitle = (s?: string | null) =>
              (s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '').slice(0, 60)
            let titleDup = null
            if (!exists && !duplicate && r.title && r.duration) {
              const nt = normTitle(r.title)
              const na = normTitle(r.artist)
              const candidates = await prisma.track.findMany({
                where: { workspaceId: req.params.wsId, duration: { gte: r.duration - 2, lte: r.duration + 2 } },
                select: { id: true, title: true, artist: true },
              })
              titleDup = candidates.find(c =>
                normTitle(c.title) === nt && (na === '' || normTitle(c.artist) === na || normTitle(c.artist) === '')
              ) ?? null
            }
            if (duplicate || titleDup) {
              skipped++
            } else if (!exists) {
              try {
                await prisma.track.create({
                  data: {
                    id: uuid(),
                    workspaceId: req.params.wsId,
                    title:    r.title,
                    artist:   r.artist,
                    duration: r.duration ?? null,
                    fileSize: r.fileSize ?? null,
                    format:   path.extname(r.filePath).replace('.', '') || 'mp3',
                    filePath: r.filePath,
                    soundcloudId: telegramKey,
                  },
                })
                imported++
                notifs.push(req.params.wsId, 'track:added', 'Telegram importé', `« ${r.title} » importé.`, '/library')
              } catch { skipped++ }
            } else {
              // File was re-downloaded (was missing) — update filePath in DB
              if (exists.filePath !== r.filePath || !exists.filePath) {
                await prisma.track.update({
                  where: { id: exists.id },
                  data: { filePath: r.filePath, fileSize: r.fileSize ?? exists.fileSize },
                }).catch(() => {})
                imported++
              } else {
                skipped++
              }
            }
          }
          send({ status: 'progress', count: obj.count, title: obj.title, imported, skipped })

        } else if (obj.status === 'done') {
          send({ status: 'done', imported, skipped })
          res.end()

        } else if (obj.status === 'error') {
          send({ status: 'error', error: obj.error })
          res.end()

        } else if (obj.status === 'warning') {
          send({ status: 'warning', title: obj.title, error: obj.error })
        }
      } catch { /* non-JSON line from Python (warnings etc.) — ignore */ }
    }
  })

  proc.stderr.on('data', (chunk: Buffer) => {
    logger.warn('[TgFullSync stderr]', { msg: chunk.toString().slice(0, 300) })
  })

  proc.on('close', (code) => {
    if (code !== 0) send({ status: 'error', error: `Le processus s'est terminé avec le code ${code}` })
    res.end()
  })

  // Kill python if client disconnects
  req.on('close', () => { try { proc.kill('SIGTERM') } catch { /* ignore */ } })
})

export default router
