/**
 * Tunnel API routes
 *
 * Two authentication modes:
 *  1. x-tunnel-secret header  → for the local tunnel CLI (heartbeat, job claim, complete, fail)
 *  2. Bearer JWT              → for the frontend (job status polling)
 *
 * Required env vars:
 *   TUNNEL_SECRET   — shared secret between server and local tunnel CLI
 *   STORAGE_PATH    — where to store uploaded files (same as rest of server)
 */

import { Router, Request, Response, NextFunction } from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { v4 as uuid } from 'uuid'
import prisma from '../lib/prisma'
import { authenticate } from '../middleware/auth'
import * as queue from '../services/tunnelQueue'
import * as notifs from '../services/notifications'
import logger from '../lib/logger'
import { getVideoDuration } from '../services/montage/sceneProcessor'

const router = Router()
const STORAGE_ROOT = path.resolve(process.env.STORAGE_PATH ?? './storage')

// ── Tunnel secret middleware ───────────────────────────────────────────────────

function requireTunnelSecret(req: Request, res: Response, next: NextFunction): void {
  const secret = process.env.TUNNEL_SECRET
  if (!secret) {
    res.status(503).json({ error: 'Tunnel not configured on this server (TUNNEL_SECRET missing)' })
    return
  }
  if (req.headers['x-tunnel-secret'] !== secret) {
    res.status(401).json({ error: 'Invalid tunnel secret' })
    return
  }
  next()
}

// ── File upload (tunnel → VPS) ────────────────────────────────────────────────

const tunnelUpload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      const job = queue.getJob(req.params.id)
      if (!job) { cb(new Error('Job not found'), ''); return }
      let dir: string
      if (job.outputFormat === 'MONTAGE') {
        dir = path.join(STORAGE_ROOT, job.wsId, 'montage')
      } else if (job.outputFormat === 'MP4') {
        dir = path.join(STORAGE_ROOT, 'videos', job.wsId)
      } else {
        dir = path.join(STORAGE_ROOT, job.wsId)
      }
      fs.mkdirSync(dir, { recursive: true })
      cb(null, dir)
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname) || '.mp4'
      cb(null, `${uuid()}${ext}`)
    },
  }),
  limits: { fileSize: 4 * 1024 * 1024 * 1024 }, // 4 GB
})

// ── Tunnel control endpoints (secret auth) ─────────────────────────────────────

/** POST /api/tunnel/heartbeat — tunnel announces it's alive */
router.post('/heartbeat', requireTunnelSecret, (_req, res) => {
  queue.setHeartbeat()
  res.json({ ok: true, ts: Date.now() })
})

/** GET /api/tunnel/jobs/next — claim the next pending job */
router.get('/jobs/next', requireTunnelSecret, (_req, res) => {
  const job = queue.claimNextJob()
  if (!job) { res.json({ job: null }); return }
  res.json({
    job: {
      id:           job.id,
      url:          job.url,
      outputFormat: job.outputFormat,
      meta:         job.meta,
    },
  })
})

/** POST /api/tunnel/jobs/:id/complete — tunnel uploads the finished file */
router.post(
  '/jobs/:id/complete',
  requireTunnelSecret,
  tunnelUpload.single('file'),
  async (req, res) => {
    const job = queue.getJob(req.params.id)
    if (!job) { res.status(404).json({ error: 'Job not found' }); return }
    if (!req.file) { res.status(400).json({ error: 'No file uploaded' }); return }

    try {
      const filePath = path.relative(STORAGE_ROOT, req.file.path)
      const fileSize = req.file.size
      const socialId = `youtube:${job.meta.ytId}`

      // ── MONTAGE job: update MontageSourceVideo ──────────────────────────────
      if (job.outputFormat === 'MONTAGE' && job.svId) {
        try {
          const duration = await getVideoDuration(req.file.path)
          await prisma.montageSourceVideo.update({
            where: { id: job.svId },
            data: { localPath: filePath, duration: duration ?? null },
          })
          queue.markDone(job.id, { localPath: filePath, title: job.meta.title })
          notifs.push(job.wsId, 'track:added', 'Vidéo montage importée',
            `« ${job.meta.title} » est prête pour le montage.`, '/studio')
          res.json({ ok: true, svId: job.svId })
        } catch (err) {
          logger.error('Tunnel montage complete error', { err: String(err) })
          try { fs.unlinkSync(req.file.path) } catch { /* ignore */ }
          await prisma.montageSourceVideo.update({ where: { id: job.svId }, data: { source: `ERROR: ${String(err)}` } }).catch(() => {})
          queue.markFailed(job.id, String(err))
          res.status(500).json({ error: String(err) })
        }
        return
      }

      if (job.outputFormat === 'MP4') {
        const video = await prisma.videoFile.create({
          data: {
            id:           uuid(),
            workspaceId:  job.wsId,
            title:        job.meta.title,
            artist:       job.meta.uploader ?? 'Unknown',
            platform:     'youtube',
            sourceUrl:    job.url,
            thumbnailUrl: job.meta.thumbnail,
            duration:     job.meta.duration ? Math.floor(job.meta.duration) : null,
            filePath,
            fileSize:     fileSize || null,
            socialId:     `${socialId}:0`,
          },
        })
        queue.markDone(job.id, { videoId: video.id, title: job.meta.title })
        notifs.push(job.wsId, 'track:added', 'YouTube vidéo importée',
          `« ${job.meta.title} » a été ajoutée à la galerie.`, '/gallery')
        res.json({ ok: true, videoId: video.id })
      } else {
        const track = await prisma.track.create({
          data: {
            id:           uuid(),
            workspaceId:  job.wsId,
            title:        job.meta.title,
            artist:       job.meta.uploader ?? 'Unknown',
            artworkUrl:   job.meta.thumbnail,
            duration:     job.meta.duration ? Math.floor(job.meta.duration) : null,
            soundcloudId: socialId,
            soundcloudUrl: job.meta.webpage_url,
            filePath,
            fileSize:     fileSize || null,
            format:       'mp3',
          },
        })
        queue.markDone(job.id, { trackId: track.id, title: job.meta.title })
        notifs.push(job.wsId, 'track:added', 'YouTube audio importé',
          `« ${job.meta.title} » a été ajouté à la bibliothèque.`, '/library')
        res.json({ ok: true, trackId: track.id })
      }
    } catch (err) {
      logger.error('Tunnel complete error', { err: String(err) })
      // Clean up the uploaded file on error
      try { fs.unlinkSync(req.file.path) } catch { /* ignore */ }
      queue.markFailed(job.id, String(err))
      res.status(500).json({ error: String(err) })
    }
  }
)

/** POST /api/tunnel/jobs/:id/fail — tunnel reports download failure */
router.post('/jobs/:id/fail', requireTunnelSecret, (req, res) => {
  const { error } = req.body as { error?: string }
  queue.markFailed(req.params.id, error ?? 'Unknown tunnel error')
  res.json({ ok: true })
})

// ── Status endpoint (JWT auth — for frontend polling) ─────────────────────────

/** GET /api/tunnel/jobs/:id — frontend polls job status */
router.get('/jobs/:id', authenticate, (req, res) => {
  const job = queue.getJob(req.params.id)
  if (!job) { res.status(404).json({ error: 'Job not found or expired' }); return }
  // Only the job owner (or workspace member check is implicit via userId stored in job)
  res.json({ job: queue.jobSummary(job) })
})

/** GET /api/tunnel/status — is the tunnel connected? */
router.get('/status', authenticate, (_req, res) => {
  res.json({
    active: queue.isTunnelActive(),
    lastSeenMs: queue.getTunnelAge(),
  })
})

export default router
