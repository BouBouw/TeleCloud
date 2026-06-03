import { Router } from 'express'
import path from 'path'
import fs from 'fs'
import { spawn } from 'child_process'
import prisma from '../lib/prisma'
import { authenticate } from '../middleware/auth'
import logger from '../lib/logger'

const router = Router({ mergeParams: true })
router.use(authenticate)

interface WsParams { wsId: string; [key: string]: string }
interface VideoParams extends WsParams { videoId: string }

const STORAGE_ROOT = path.resolve(process.env.STORAGE_PATH ?? './storage')
const FFMPEG = process.env.FFMPEG_BIN ?? 'ffmpeg'

async function assertMember(wsId: string, userId: string) {
  return prisma.workspaceMember.findFirst({ where: { workspaceId: wsId, userId } })
}

// ── GET /api/workspaces/:wsId/gallery ──────────────────────────────────────
router.get<WsParams>('/', async (req, res) => {
  const member = await assertMember(req.params.wsId, req.user!.userId)
  if (!member) { res.status(403).json({ error: 'Not a member' }); return }

  const videos = await prisma.videoFile.findMany({
    where: { workspaceId: req.params.wsId },
    orderBy: { createdAt: 'desc' },
  })
  res.json({ videos })
})

// ── DELETE /api/workspaces/:wsId/gallery/:videoId ──────────────────────────
router.delete<VideoParams>('/:videoId', async (req, res) => {
  const member = await assertMember(req.params.wsId, req.user!.userId)
  if (!member) { res.status(403).json({ error: 'Not a member' }); return }

  const video = await prisma.videoFile.findFirst({
    where: { id: req.params.videoId, workspaceId: req.params.wsId },
  })
  if (!video) { res.status(404).json({ error: 'Video not found' }); return }

  // Delete file from disk
  if (video.filePath) {
    const abs = path.join(STORAGE_ROOT, video.filePath)
    if (fs.existsSync(abs)) {
      try { fs.unlinkSync(abs) } catch (e) { logger.warn('Could not delete video file', { err: String(e) }) }
    }
  }

  await prisma.videoFile.delete({ where: { id: video.id } })
  res.json({ ok: true })
})

// ── GET /api/workspaces/:wsId/gallery/:videoId/download ───────────────────
router.get<VideoParams>('/:videoId/download', async (req, res) => {
  const member = await assertMember(req.params.wsId, req.user!.userId)
  if (!member) { res.status(403).json({ error: 'Not a member' }); return }

  const video = await prisma.videoFile.findFirst({
    where: { id: req.params.videoId, workspaceId: req.params.wsId },
  })
  if (!video) { res.status(404).json({ error: 'Video not found' }); return }

  const abs = path.join(STORAGE_ROOT, video.filePath)
  if (!fs.existsSync(abs)) { res.status(404).json({ error: 'File not found on disk' }); return }

  const safeName = video.title.replace(/[^\w\s\-_.]/g, '').trim().slice(0, 120) || 'video'
  const stat = fs.statSync(abs)
  const total = stat.size
  const range = req.headers.range

  if (range) {
    const [startStr, endStr] = range.replace(/bytes=/, '').split('-')
    const start = parseInt(startStr, 10)
    const end   = endStr ? parseInt(endStr, 10) : total - 1
    res.writeHead(206, {
      'Content-Range':       `bytes ${start}-${end}/${total}`,
      'Accept-Ranges':       'bytes',
      'Content-Length':      String(end - start + 1),
      'Content-Type':        'video/mp4',
      'Content-Disposition': `attachment; filename="${safeName}.mp4"`,
    })
    fs.createReadStream(abs, { start, end }).pipe(res)
  } else {
    res.writeHead(200, {
      'Content-Length':      String(total),
      'Content-Type':        'video/mp4',
      'Accept-Ranges':       'bytes',
      'Content-Disposition': `attachment; filename="${safeName}.mp4"`,
    })
    fs.createReadStream(abs).pipe(res)
  }
})

// ── GET /api/workspaces/:wsId/gallery/:videoId/stream ─────────────────────
router.get<VideoParams>('/:videoId/stream', async (req, res) => {
  const member = await assertMember(req.params.wsId, req.user!.userId)
  if (!member) { res.status(403).json({ error: 'Not a member' }); return }

  const video = await prisma.videoFile.findFirst({
    where: { id: req.params.videoId, workspaceId: req.params.wsId },
  })
  if (!video) { res.status(404).json({ error: 'Video not found' }); return }

  const abs = path.join(STORAGE_ROOT, video.filePath)
  if (!fs.existsSync(abs)) { res.status(404).json({ error: 'File not found on disk' }); return }

  const stat = fs.statSync(abs)
  const total = stat.size
  const range = req.headers.range

  if (range) {
    const [startStr, endStr] = range.replace(/bytes=/, '').split('-')
    const start = parseInt(startStr, 10)
    const end   = endStr ? parseInt(endStr, 10) : total - 1
    res.writeHead(206, {
      'Content-Range':  `bytes ${start}-${end}/${total}`,
      'Accept-Ranges':  'bytes',
      'Content-Length': String(end - start + 1),
      'Content-Type':   'video/mp4',
    })
    fs.createReadStream(abs, { start, end }).pipe(res)
  } else {
    res.writeHead(200, {
      'Content-Length': String(total),
      'Content-Type':   'video/mp4',
      'Accept-Ranges':  'bytes',
    })
    fs.createReadStream(abs).pipe(res)
  }
})

// ── GET /api/workspaces/:wsId/gallery/:videoId/thumbnail ─────────────────
// Extracts a frame from the video at ~10% duration using FFmpeg.
// Result is cached as a .thumb.jpg next to the video file on first request.
router.get<VideoParams>('/:videoId/thumbnail', async (req, res) => {
  const member = await assertMember(req.params.wsId, req.user!.userId)
  if (!member) { res.status(403).json({ error: 'Not a member' }); return }

  const video = await prisma.videoFile.findFirst({
    where: { id: req.params.videoId, workspaceId: req.params.wsId },
  })
  if (!video) { res.status(404).end(); return }

  const videoAbs = path.join(STORAGE_ROOT, video.filePath)
  if (!fs.existsSync(videoAbs)) { res.status(404).end(); return }

  // Cache thumb alongside the video: same path but .thumb.jpg extension
  const thumbAbs = videoAbs.replace(/\.[^.]+$/, '.thumb.jpg')

  const sendThumb = () => {
    res.setHeader('Content-Type', 'image/jpeg')
    res.setHeader('Cache-Control', 'public, max-age=86400')
    fs.createReadStream(thumbAbs).pipe(res)
  }

  if (fs.existsSync(thumbAbs)) { sendThumb(); return }

  // Generate with FFmpeg: seek to 10% into the video, extract one frame, scale to 480px wide
  const seekSec = Math.max(1, Math.floor((video.duration ?? 10) * 0.1))
  const proc = spawn(FFMPEG, [
    '-ss', String(seekSec),
    '-i', videoAbs,
    '-vframes', '1',
    '-vf', 'scale=480:-1',
    '-q:v', '3',
    '-y', thumbAbs,
  ], { stdio: ['ignore', 'ignore', 'pipe'] })

  proc.on('close', (code) => {
    if (code === 0 && fs.existsSync(thumbAbs)) {
      sendThumb()
    } else {
      logger.warn('Thumbnail generation failed', { videoId: video.id, code })
      res.status(500).end()
    }
  })
  proc.on('error', (err) => {
    logger.warn('FFmpeg spawn error for thumbnail', { err: String(err) })
    res.status(500).end()
  })
})

export default router
