import { Router } from 'express'
import type { Request, Response } from 'express'
import path from 'path'
import fs from 'fs'
import https from 'https'
import http from 'http'
import cors from 'cors'
import prisma from '../lib/prisma'
import { authenticateApiKey, requireScope } from '../middleware/apiKey'
import type { ApiKeyContext } from '../middleware/apiKey'
import { ZipStream } from '../lib/zipStream'
import logger from '../lib/logger'

/**
 * Public library export API — authenticated with a user-generated API key
 * instead of the session JWT, so it can be called from scripts, cron jobs or
 * another app. Everything here is read-only.
 */
const router = Router()

// Meant to be consumed from anywhere (curl, other origins). Safe: key-based
// auth, no cookies, read-only.
router.use(cors({ origin: '*', methods: ['GET', 'HEAD', 'OPTIONS'], allowedHeaders: ['X-API-Key', 'Authorization', 'Range'] }))
router.use(authenticateApiKey, requireScope('library:read'))

const STORAGE_ROOT = path.resolve(process.env.STORAGE_PATH ?? './storage')

const AUDIO_MIME: Record<string, string> = {
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg',
  flac: 'audio/flac', m4a: 'audio/mp4', aac: 'audio/aac', opus: 'audio/opus',
}

function baseUrl(req: Request): string {
  const configured = process.env.PUBLIC_URL?.replace(/\/+$/, '')
  if (configured) return configured
  return `${req.protocol}://${req.get('host')}`
}

/** Resolves a DB-relative path and refuses anything escaping the storage root. */
function safeStoragePath(relative: string): string | null {
  const abs = path.resolve(STORAGE_ROOT, relative)
  if (abs !== STORAGE_ROOT && !abs.startsWith(STORAGE_ROOT + path.sep)) return null
  return abs
}

/**
 * Workspaces this key may read: the owner's memberships that grant library
 * read access, narrowed to the key's workspace when it is scoped to one.
 */
async function accessibleWorkspaceIds(ctx: ApiKeyContext): Promise<string[]> {
  const memberships = await prisma.workspaceMember.findMany({
    where: {
      userId: ctx.userId,
      canLibrary: true,
      libRead: true,
      ...(ctx.workspaceId ? { workspaceId: ctx.workspaceId } : {}),
    },
    select: { workspaceId: true },
  })
  return memberships.map(m => m.workspaceId)
}

type TrackRow = {
  id: string; workspaceId: string; title: string; artist: string | null
  featuring: string | null; album: string | null; duration: number | null
  fileSize: number | null; format: string; filePath: string; artworkUrl: string | null
  soundcloudUrl: string | null; playCount: number; createdAt: Date; updatedAt: Date
}

function serializeTrack(t: TrackRow, base: string) {
  const cover = t.artworkUrl
    ? (/^https?:\/\//i.test(t.artworkUrl) ? t.artworkUrl : `${base}${t.artworkUrl}`)
    : null
  return {
    id:          t.id,
    workspaceId: t.workspaceId,
    title:       t.title,
    artist:      t.artist ?? null,
    featuring:   t.featuring ?? null,
    album:       t.album ?? null,
    duration:    t.duration ?? null,
    fileSize:    t.fileSize ?? null,
    format:      t.format,
    playCount:   t.playCount,
    sourceUrl:   t.soundcloudUrl ?? null,
    createdAt:   t.createdAt.toISOString(),
    updatedAt:   t.updatedAt.toISOString(),
    coverUrl:    cover,
    /** Always-reachable, key-authenticated variants. */
    coverDownloadUrl: t.artworkUrl ? `${base}/api/export/v1/tracks/${t.id}/cover` : null,
    audioUrl:         `${base}/api/export/v1/tracks/${t.id}/audio`,
  }
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return ''
  const s = String(v)
  return /[",\r\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

const CSV_COLUMNS = [
  'id', 'workspaceId', 'title', 'artist', 'featuring', 'album', 'duration',
  'fileSize', 'format', 'playCount', 'sourceUrl', 'createdAt', 'coverUrl', 'audioUrl',
] as const

function toCsv(tracks: ReturnType<typeof serializeTrack>[]): string {
  const rows = [CSV_COLUMNS.join(',')]
  for (const t of tracks) {
    rows.push(CSV_COLUMNS.map(c => csvCell((t as Record<string, unknown>)[c])).join(','))
  }
  // BOM so Excel opens the accents correctly
  return '\uFEFF' + rows.join('\r\n') + '\r\n'
}

/** Fetches a remote cover into memory (covers are small); resolves null on any failure. */
function fetchRemote(url: string, maxBytes = 8 * 1024 * 1024, timeoutMs = 10_000): Promise<Buffer | null> {
  return new Promise(resolve => {
    let settled = false
    const done = (v: Buffer | null) => { if (!settled) { settled = true; resolve(v) } }
    try {
      const client = url.startsWith('https:') ? https : http
      const req = client.get(url, { timeout: timeoutMs }, r => {
        if (r.statusCode && r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
          r.resume()
          fetchRemote(new URL(r.headers.location, url).toString(), maxBytes, timeoutMs).then(done)
          return
        }
        if (r.statusCode !== 200) { r.resume(); done(null); return }
        const chunks: Buffer[] = []
        let size = 0
        r.on('data', c => {
          size += c.length
          if (size > maxBytes) { r.destroy(); done(null); return }
          chunks.push(c)
        })
        r.on('end', () => done(Buffer.concat(chunks)))
        r.on('error', () => done(null))
      })
      req.on('timeout', () => { req.destroy(); done(null) })
      req.on('error', () => done(null))
    } catch { done(null) }
  })
}

// ── GET /api/export/v1/me ────────────────────────────────────────────────────
router.get('/v1/me', async (req, res) => {
  try {
    const ctx = req.apiKey!
    const user = await prisma.user.findUnique({ where: { id: ctx.userId } })
    if (!user) { res.status(401).json({ error: 'Owner account no longer exists' }); return }

    const wsIds = await accessibleWorkspaceIds(ctx)
    const workspaces = await prisma.workspace.findMany({
      where: { id: { in: wsIds } },
      select: { id: true, name: true, slug: true, _count: { select: { tracks: true } } },
      orderBy: { name: 'asc' },
    })

    res.json({
      user: { id: user.id, email: user.email, displayName: user.displayName },
      key: { name: ctx.name, scopes: ctx.scopes, workspaceId: ctx.workspaceId },
      workspaces: workspaces.map(w => ({ id: w.id, name: w.name, slug: w.slug, trackCount: w._count.tracks })),
    })
  } catch (e) {
    logger.error('Export /me failed', { err: String(e) })
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ── GET /api/export/v1/workspaces ────────────────────────────────────────────
router.get('/v1/workspaces', async (req, res) => {
  try {
    const wsIds = await accessibleWorkspaceIds(req.apiKey!)
    const workspaces = await prisma.workspace.findMany({
      where: { id: { in: wsIds } },
      select: { id: true, name: true, slug: true, createdAt: true, _count: { select: { tracks: true } } },
      orderBy: { name: 'asc' },
    })
    res.json({
      workspaces: workspaces.map(w => ({
        id: w.id, name: w.name, slug: w.slug,
        trackCount: w._count.tracks, createdAt: w.createdAt.toISOString(),
      })),
    })
  } catch (e) {
    logger.error('Export /workspaces failed', { err: String(e) })
    res.status(500).json({ error: 'Internal server error' })
  }
})

/** Shared query parsing for /library and /library.zip. */
async function resolveQuery(req: Request, res: Response) {
  const ctx = req.apiKey!
  const allowed = await accessibleWorkspaceIds(ctx)
  if (allowed.length === 0) {
    res.status(403).json({ error: 'This key has access to no workspace' })
    return null
  }

  const { workspaceId, q } = req.query as Record<string, string | undefined>
  let wsIds = allowed
  if (workspaceId) {
    if (!allowed.includes(workspaceId)) {
      res.status(403).json({ error: 'This key cannot access that workspace' })
      return null
    }
    wsIds = [workspaceId]
  }

  const where = {
    workspaceId: { in: wsIds },
    ...(q ? { OR: [{ title: { contains: q, mode: 'insensitive' as const } }, { artist: { contains: q, mode: 'insensitive' as const } }] } : {}),
  }
  return { where, wsIds }
}

// ── GET /api/export/v1/library ───────────────────────────────────────────────
// ?workspaceId= &q= &limit= &offset= &format=json|csv
router.get('/v1/library', async (req, res) => {
  try {
    const resolved = await resolveQuery(req, res)
    if (!resolved) return

    const { limit, offset, format } = req.query as Record<string, string | undefined>
    const take = Math.min(Math.max(Number(limit) || 1000, 1), 10000)
    const skip = Math.max(Number(offset) || 0, 0)

    const [tracks, total] = await Promise.all([
      prisma.track.findMany({ where: resolved.where, orderBy: { createdAt: 'desc' }, take, skip }),
      prisma.track.count({ where: resolved.where }),
    ])

    const base = baseUrl(req)
    const payload = tracks.map(t => serializeTrack(t, base))

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8')
      res.setHeader('Content-Disposition', 'attachment; filename="library.csv"')
      res.send(toCsv(payload))
      return
    }

    res.json({
      total,
      count: payload.length,
      limit: take,
      offset: skip,
      hasMore: skip + payload.length < total,
      workspaceIds: resolved.wsIds,
      exportedAt: new Date().toISOString(),
      tracks: payload,
    })
  } catch (e) {
    logger.error('Export /library failed', { err: String(e) })
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ── GET /api/export/v1/tracks/:trackId ───────────────────────────────────────
router.get<{ trackId: string }>('/v1/tracks/:trackId', async (req, res) => {
  try {
    const wsIds = await accessibleWorkspaceIds(req.apiKey!)
    const track = await prisma.track.findFirst({
      where: { id: req.params.trackId, workspaceId: { in: wsIds } },
    })
    if (!track) { res.status(404).json({ error: 'Track not found' }); return }
    res.json({ track: serializeTrack(track, baseUrl(req)) })
  } catch (e) {
    logger.error('Export /tracks/:id failed', { err: String(e) })
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ── GET /api/export/v1/tracks/:trackId/audio ─────────────────────────────────
router.get<{ trackId: string }>('/v1/tracks/:trackId/audio', async (req, res) => {
  try {
    const wsIds = await accessibleWorkspaceIds(req.apiKey!)
    const track = await prisma.track.findFirst({
      where: { id: req.params.trackId, workspaceId: { in: wsIds } },
    })
    if (!track) { res.status(404).json({ error: 'Track not found' }); return }

    const abs = safeStoragePath(track.filePath)
    if (!abs || !fs.existsSync(abs)) { res.status(404).json({ error: 'Audio file not found on disk' }); return }

    const ext   = (track.format || path.extname(abs).slice(1) || 'mp3').toLowerCase()
    const mime  = AUDIO_MIME[ext] ?? 'application/octet-stream'
    const total = fs.statSync(abs).size
    const name  = `${exportFileBase(track.title, track.artist)}.${ext}`
    const disposition = `attachment; filename="${asciiFallback(name)}"; filename*=UTF-8''${encodeURIComponent(name)}`

    const range = req.headers.range
    if (range) {
      const [startStr, endStr] = range.replace(/bytes=/, '').split('-')
      const start = parseInt(startStr, 10) || 0
      const end   = endStr ? parseInt(endStr, 10) : total - 1
      if (start >= total || end >= total || start > end) {
        res.status(416).setHeader('Content-Range', `bytes */${total}`)
        res.end()
        return
      }
      res.writeHead(206, {
        'Content-Range':       `bytes ${start}-${end}/${total}`,
        'Accept-Ranges':       'bytes',
        'Content-Length':      String(end - start + 1),
        'Content-Type':        mime,
        'Content-Disposition': disposition,
      })
      fs.createReadStream(abs, { start, end }).pipe(res)
      return
    }

    res.writeHead(200, {
      'Content-Length':      String(total),
      'Content-Type':        mime,
      'Accept-Ranges':       'bytes',
      'Content-Disposition': disposition,
    })
    fs.createReadStream(abs).pipe(res)
  } catch (e) {
    logger.error('Export audio failed', { err: String(e) })
    if (!res.headersSent) res.status(500).json({ error: 'Internal server error' })
  }
})

// ── GET /api/export/v1/tracks/:trackId/cover ─────────────────────────────────
router.get<{ trackId: string }>('/v1/tracks/:trackId/cover', async (req, res) => {
  try {
    const wsIds = await accessibleWorkspaceIds(req.apiKey!)
    const track = await prisma.track.findFirst({
      where: { id: req.params.trackId, workspaceId: { in: wsIds } },
    })
    if (!track) { res.status(404).json({ error: 'Track not found' }); return }
    if (!track.artworkUrl) { res.status(404).json({ error: 'This track has no cover' }); return }

    // Remote cover (SoundCloud/YouTube CDN): proxy it so callers only ever need the key.
    if (/^https?:\/\//i.test(track.artworkUrl)) {
      const buf = await fetchRemote(track.artworkUrl)
      if (!buf) { res.status(502).json({ error: 'Could not fetch remote cover' }); return }
      res.setHeader('Content-Type', 'image/jpeg')
      res.setHeader('Content-Length', String(buf.length))
      res.end(buf)
      return
    }

    const rel = track.artworkUrl.replace(/^\/storage\//, '')
    const abs = safeStoragePath(rel)
    if (!abs || !fs.existsSync(abs)) { res.status(404).json({ error: 'Cover file not found on disk' }); return }

    const ext  = path.extname(abs).toLowerCase()
    const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg'
    res.setHeader('Content-Type', mime)
    res.setHeader('Content-Length', String(fs.statSync(abs).size))
    fs.createReadStream(abs).pipe(res)
  } catch (e) {
    logger.error('Export cover failed', { err: String(e) })
    if (!res.headersSent) res.status(500).json({ error: 'Internal server error' })
  }
})

/** "Artist - Title", trimmed and stripped of characters filesystems dislike. */
function exportFileBase(title: string, artist: string | null): string {
  const raw = artist ? `${artist} - ${title}` : title
  return raw.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120) || 'track'
}

function asciiFallback(name: string): string {
  return name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, "'")
}

// ── GET /api/export/v1/library.zip ───────────────────────────────────────────
// Full archive: manifest (json + csv), every audio file, every cover.
// ?workspaceId= &q= &limit= &includeAudio=0 &includeCovers=0
router.get('/v1/library.zip', async (req, res) => {
  const resolved = await resolveQuery(req, res)
  if (!resolved) return

  const { limit, includeAudio, includeCovers } = req.query as Record<string, string | undefined>
  const take       = Math.min(Math.max(Number(limit) || 5000, 1), 10000)
  const wantAudio  = includeAudio  !== '0' && includeAudio  !== 'false'
  const wantCovers = includeCovers !== '0' && includeCovers !== 'false'

  let tracks
  try {
    tracks = await prisma.track.findMany({ where: resolved.where, orderBy: { createdAt: 'desc' }, take })
  } catch (e) {
    logger.error('Export zip query failed', { err: String(e) })
    res.status(500).json({ error: 'Internal server error' })
    return
  }

  const base = baseUrl(req)
  const stamp = new Date().toISOString().slice(0, 10)

  res.writeHead(200, {
    'Content-Type':        'application/zip',
    'Content-Disposition': `attachment; filename="vibot-library-${stamp}.zip"`,
    'Cache-Control':       'no-store',
  })

  const zip = new ZipStream(res)
  const manifest: Array<Record<string, unknown>> = []
  let aborted = false
  res.on('close', () => { aborted = true })

  try {
    const pad = String(tracks.length).length
    for (let i = 0; i < tracks.length; i++) {
      if (aborted) return
      const t = tracks[i]
      const entry = serializeTrack(t, base) as Record<string, unknown>
      const num   = String(i + 1).padStart(pad, '0')
      const nameBase = `${num} - ${exportFileBase(t.title, t.artist)}`

      if (wantAudio) {
        const abs = safeStoragePath(t.filePath)
        if (abs && fs.existsSync(abs)) {
          const ext = (t.format || path.extname(abs).slice(1) || 'mp3').toLowerCase()
          const file = `audio/${nameBase}.${ext}`
          try {
            await zip.addFile(file, abs, t.createdAt)
            entry.file = file
          } catch (e) {
            logger.warn('Export zip: could not add audio', { trackId: t.id, err: String(e) })
          }
        } else {
          entry.fileMissing = true
        }
      }

      if (wantCovers && t.artworkUrl) {
        try {
          if (/^https?:\/\//i.test(t.artworkUrl)) {
            const buf = await fetchRemote(t.artworkUrl)
            if (buf) {
              const file = `covers/${nameBase}.jpg`
              await zip.addBuffer(file, buf, t.createdAt)
              entry.coverFile = file
            }
          } else {
            const abs = safeStoragePath(t.artworkUrl.replace(/^\/storage\//, ''))
            if (abs && fs.existsSync(abs)) {
              const ext  = (path.extname(abs) || '.jpg').toLowerCase()
              const file = `covers/${nameBase}${ext}`
              await zip.addFile(file, abs, t.createdAt)
              entry.coverFile = file
            }
          }
        } catch (e) {
          logger.warn('Export zip: could not add cover', { trackId: t.id, err: String(e) })
        }
      }

      manifest.push(entry)
    }

    if (aborted) return

    await zip.addBuffer('library.json', Buffer.from(JSON.stringify({
      exportedAt:   new Date().toISOString(),
      workspaceIds: resolved.wsIds,
      count:        manifest.length,
      tracks:       manifest,
    }, null, 2), 'utf8'))

    await zip.addBuffer('library.csv', Buffer.from(
      toCsv(manifest as unknown as ReturnType<typeof serializeTrack>[]), 'utf8',
    ))

    await zip.finalize()
    res.end()
  } catch (e) {
    logger.error('Export zip failed mid-stream', { err: String(e) })
    // Headers are already out — the only honest signal left is a broken connection,
    // which makes the client's unzip fail loudly instead of yielding a truncated archive.
    res.destroy()
  }
})

export default router
