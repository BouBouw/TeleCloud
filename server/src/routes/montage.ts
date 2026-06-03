/**
 * Montage routes: /api/workspaces/:wsId/montage
 */
import { Router } from 'express'
import path from 'path'
import fs from 'fs'
import { exec } from 'child_process'
import { promisify } from 'util'
import multer from 'multer'

const execAsync = promisify(exec)
import { v4 as uuid } from 'uuid'
import { z } from 'zod'
import prisma from '../lib/prisma'
import { authenticate } from '../middleware/auth'
import { validate } from '../middleware/validate'
import { montageQueue } from '../services/montage/renderQueue'
import { getVideoDuration, detectSceneTimestamps } from '../services/montage/sceneProcessor'
import type { SubtitleSegment, SubtitleStyle } from '../services/montage/types'
import { downloadVideoYtdlp } from '../services/ytdlp'
import { downloadVideoViaCobalt } from '../services/cobalt'

const router = Router({ mergeParams: true })
router.use(authenticate)

const STORAGE_ROOT = path.resolve(process.env.STORAGE_PATH ?? './storage')

function montageDir(wsId: string) {
  const dir = path.join(STORAGE_ROOT, wsId, 'montage')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

// ── multer for audio uploads ──────────────────────────────────────────────────
const uploadAudio = multer({
  storage: multer.diskStorage({
    destination: (req, _f, cb) => cb(null, montageDir(req.params.wsId)),
    filename: (_req, file, cb) => cb(null, `audio_${uuid()}${path.extname(file.originalname) || '.mp3'}`),
  }),
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = ['.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac'].includes(path.extname(file.originalname).toLowerCase())
    cb(null, ok)
  },
})

// ── multer for video uploads ──────────────────────────────────────────────────
const uploadVideo = multer({
  storage: multer.diskStorage({
    destination: (req, _f, cb) => cb(null, montageDir(req.params.wsId)),
    filename: (_req, file, cb) => cb(null, `video_${uuid()}${path.extname(file.originalname) || '.mp4'}`),
  }),
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = ['.mp4', '.mov', '.mkv', '.webm', '.avi'].includes(path.extname(file.originalname).toLowerCase())
    cb(null, ok)
  },
})

// ── Helpers ───────────────────────────────────────────────────────────────────
async function requireMember(wsId: string, userId: string) {
  const member = await prisma.workspaceMember.findFirst({ where: { workspaceId: wsId, userId } })
  if (!member) throw Object.assign(new Error('Not a member'), { status: 403 })
}

// ── Schemas ────────────────────────────────────────────────────────────────────
const createProjectSchema = z.object({
  title: z.string().min(1).max(120),
  style: z.enum(['DARK_TRAP', 'CLEAN_MINIMAL', 'HYPER_POP', 'FAST_CUTS', 'SLOW_MOTION', 'CINEMATIC', 'AMBIENT', 'LYRIC_VIDEO', 'EQ_VISUALIZER']).default('DARK_TRAP'),
  durationMode: z.enum(['AUTO', 'SECONDS_15', 'SECONDS_30', 'SECONDS_60', 'FULL_SONG']).default('AUTO'),
  ratio: z.enum(['LANDSCAPE', 'PORTRAIT', 'SQUARE']).default('LANDSCAPE'),
})

// ── GET /api/workspaces/:wsId/montage ── list projects ────────────────────────
router.get('/', async (req, res) => {
  try {
    await requireMember(req.params.wsId, req.user!.userId)
    const projects = await prisma.montageProject.findMany({
      where: { workspaceId: req.params.wsId },
      include: { sourceVideos: true, renderJob: true },
      orderBy: { createdAt: 'desc' },
    })
    res.json({ projects })
  } catch (e: any) {
    res.status(e.status ?? 500).json({ error: e.message })
  }
})

// ── POST /api/workspaces/:wsId/montage ── create project ─────────────────────
router.post('/', validate(createProjectSchema), async (req, res) => {
  try {
    await requireMember(req.params.wsId, req.user!.userId)
    const { title, style, durationMode, ratio } = req.body
    const project = await prisma.montageProject.create({
      data: { id: uuid(), workspaceId: req.params.wsId, title, style, durationMode, ratio },
      include: { sourceVideos: true, renderJob: true },
    })
    res.status(201).json({ project })
  } catch (e: any) {
    res.status(e.status ?? 500).json({ error: e.message })
  }
})

// ── GET /api/workspaces/:wsId/montage/:id ── get project ─────────────────────
router.get('/:id', async (req, res) => {
  try {
    await requireMember(req.params.wsId, req.user!.userId)
    const project = await prisma.montageProject.findFirst({
      where: { id: req.params.id, workspaceId: req.params.wsId },
      include: { sourceVideos: true, renderJob: true },
    })
    if (!project) { res.status(404).json({ error: 'Project not found' }); return }
    res.json({ project })
  } catch (e: any) {
    res.status(e.status ?? 500).json({ error: e.message })
  }
})

// ── DELETE /api/workspaces/:wsId/montage/:id ── delete project ────────────────
router.delete('/:id', async (req, res) => {
  try {
    await requireMember(req.params.wsId, req.user!.userId)
    const project = await prisma.montageProject.findFirst({
      where: { id: req.params.id, workspaceId: req.params.wsId },
    })
    if (!project) { res.status(404).json({ error: 'Project not found' }); return }
    await prisma.montageProject.delete({ where: { id: req.params.id } })
    // Clean up output file
    if (project.outputPath) {
      const absPath = path.join(STORAGE_ROOT, project.outputPath)
      fs.unlink(absPath, () => {})
    }
    res.json({ ok: true })
  } catch (e: any) {
    res.status(e.status ?? 500).json({ error: e.message })
  }
})

// ── POST /api/workspaces/:wsId/montage/:id/audio ── upload audio ──────────────
router.post('/:id/audio', uploadAudio.single('audio'), async (req, res) => {
  try {
    await requireMember(req.params.wsId, req.user!.userId)
    if (!req.file) { res.status(400).json({ error: 'No audio file' }); return }

    const relPath = path.join(req.params.wsId, 'montage', req.file.filename)
    const absPath = req.file.path

    // Quick duration probe
    let duration: number | null = null
    try {
      const { spawn } = await import('child_process')
      const FFPROBE = process.env.FFPROBE_PATH ?? 'ffprobe'
      duration = await new Promise<number>((resolve) => {
        const proc = spawn(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', absPath])
        let out = ''
        proc.stdout.on('data', (d: Buffer) => (out += d.toString()))
        proc.on('close', () => resolve(parseFloat(out.trim()) || 0))
        proc.on('error', () => resolve(0))
      })
    } catch { /* ignore */ }

    const project = await prisma.montageProject.update({
      where: { id: req.params.id },
      data: { audioPath: relPath, audioDuration: duration },
      include: { sourceVideos: true, renderJob: true },
    })
    res.json({ project })
  } catch (e: any) {
    res.status(e.status ?? 500).json({ error: e.message })
  }
})

// ── POST /api/workspaces/:wsId/montage/:id/audio-from-track ── use library track ──
router.post('/:id/audio-from-track', async (req, res) => {
  const { trackId } = req.body
  if (!trackId || typeof trackId !== 'string') { res.status(400).json({ error: 'trackId required' }); return }
  try {
    await requireMember(req.params.wsId, req.user!.userId)
    const project = await prisma.montageProject.findFirst({ where: { id: req.params.id, workspaceId: req.params.wsId } })
    if (!project) { res.status(404).json({ error: 'Project not found' }); return }
    const track = await prisma.track.findFirst({ where: { id: trackId, workspaceId: req.params.wsId } })
    if (!track) { res.status(404).json({ error: 'Track not found' }); return }

    // Reuse duration from track record if available, otherwise probe
    let duration: number | null = track.duration ?? null
    if (!duration) {
      try {
        const absPath = path.join(STORAGE_ROOT, track.filePath)
        const { spawn } = await import('child_process')
        const FFPROBE = process.env.FFPROBE_PATH ?? 'ffprobe'
        duration = await new Promise<number>((resolve) => {
          const proc = spawn(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', absPath])
          let out = ''
          proc.stdout.on('data', (d: Buffer) => (out += d.toString()))
          proc.on('close', () => resolve(parseFloat(out.trim()) || 0))
          proc.on('error', () => resolve(0))
        })
      } catch { /* ignore */ }
    }

    const updated = await prisma.montageProject.update({
      where: { id: req.params.id },
      data: { audioPath: track.filePath, audioDuration: duration },
      include: { sourceVideos: true, renderJob: true },
    })
    res.json({ project: updated })
  } catch (e: any) {
    res.status(e.status ?? 500).json({ error: e.message })
  }
})

// ── POST /api/workspaces/:wsId/montage/:id/video-url ── add video from URL ─────
router.post('/:id/video-url', async (req, res) => {
  const { url } = req.body
  if (!url || typeof url !== 'string') { res.status(400).json({ error: 'url required' }); return }

  try {
    await requireMember(req.params.wsId, req.user!.userId)
    const project = await prisma.montageProject.findFirst({ where: { id: req.params.id, workspaceId: req.params.wsId } })
    if (!project) { res.status(404).json({ error: 'Project not found' }); return }

    // Create source video entry first
    const sv = await prisma.montageSourceVideo.create({
      data: { id: uuid(), projectId: req.params.id, type: 'URL', source: url },
    })
    res.json({ sourceVideo: sv, downloading: true })

    // Download in background — try cobalt first (fast, no re-encode), fall back to yt-dlp
    const dir = montageDir(req.params.wsId)
    const filename = `video_${sv.id}.mp4`
    const destPath = path.join(dir, filename)
    const relPath  = path.join(req.params.wsId, 'montage', filename)

    try {
      let finalPath = destPath
      try {
        // Primary: cobalt.tools — fastest, no ffmpeg re-encoding
        await downloadVideoViaCobalt(url, destPath)
      } catch (cobaltErr) {
        console.warn(`[montage] cobalt failed (${(cobaltErr as Error).message}), falling back to yt-dlp…`)
        // Fallback: yt-dlp (remux-only, no recode)
        // Pass sv.id as uniquePrefix so repeated downloads of the same URL
        // produce distinct filenames — prevents false "no new files" errors.
        const produced = await downloadVideoYtdlp(url, dir, sv.id)
        finalPath = produced[0]
      }
      const duration = await getVideoDuration(finalPath)
      const finalRel = path.relative(STORAGE_ROOT, finalPath)
      await prisma.montageSourceVideo.update({
        where: { id: sv.id },
        data: { localPath: finalRel, duration },
      })
    } catch (err) {
      await prisma.montageSourceVideo.update({ where: { id: sv.id }, data: { source: `ERROR: ${(err as Error).message}` } })
    }
  } catch (e: any) {
    res.status(e.status ?? 500).json({ error: e.message })
  }
})

// ── POST /api/workspaces/:wsId/montage/:id/video-upload ── upload video file ───
router.post('/:id/video-upload', uploadVideo.single('video'), async (req, res) => {
  try {
    await requireMember(req.params.wsId, req.user!.userId)
    if (!req.file) { res.status(400).json({ error: 'No video file' }); return }

    const relPath = path.join(req.params.wsId, 'montage', req.file.filename)
    const duration = await getVideoDuration(req.file.path)

    const sv = await prisma.montageSourceVideo.create({
      data: {
        id: uuid(),
        projectId: req.params.id,
        type: 'UPLOAD',
        source: req.file.originalname,
        localPath: relPath,
        duration,
      },
    })
    res.status(201).json({ sourceVideo: sv })
  } catch (e: any) {
    res.status(e.status ?? 500).json({ error: e.message })
  }
})

// ── POST /api/workspaces/:wsId/montage/:id/video-from-gallery ── use gallery video ─
router.post('/:id/video-from-gallery', async (req, res) => {
  const { videoFileId } = req.body
  if (!videoFileId || typeof videoFileId !== 'string') { res.status(400).json({ error: 'videoFileId required' }); return }
  try {
    await requireMember(req.params.wsId, req.user!.userId)
    const project = await prisma.montageProject.findFirst({ where: { id: req.params.id, workspaceId: req.params.wsId } })
    if (!project) { res.status(404).json({ error: 'Project not found' }); return }
    const videoFile = await prisma.videoFile.findFirst({ where: { id: videoFileId, workspaceId: req.params.wsId } })
    if (!videoFile) { res.status(404).json({ error: 'Video not found' }); return }
    const sv = await prisma.montageSourceVideo.create({
      data: {
        id: uuid(),
        projectId: req.params.id,
        type: 'GALLERY',
        source: videoFile.title,
        localPath: videoFile.filePath,
        duration: videoFile.duration ?? null,
      },
    })
    res.json({ sourceVideo: sv })
  } catch (e: any) {
    res.status(e.status ?? 500).json({ error: e.message })
  }
})

// ── POST /api/workspaces/:wsId/montage/:id/videos/:svId/duplicate ── duplicate ─
router.post('/:id/videos/:svId/duplicate', async (req, res) => {
  try {
    await requireMember(req.params.wsId, req.user!.userId)
    const sv = await prisma.montageSourceVideo.findFirst({
      where: { id: req.params.svId, projectId: req.params.id },
    })
    if (!sv) { res.status(404).json({ error: 'Source video not found' }); return }
    const dupe = await prisma.montageSourceVideo.create({
      data: {
        projectId: sv.projectId,
        type:      sv.type,
        source:    sv.source,
        localPath: sv.localPath,
        duration:  sv.duration,
      },
    })
    res.json({ sourceVideo: dupe })
  } catch (e: any) {
    res.status(e.status ?? 500).json({ error: e.message })
  }
})

// ── DELETE /api/workspaces/:wsId/montage/:id/videos/:svId ── remove video ──────
router.delete('/:id/videos/:svId', async (req, res) => {
  try {
    await requireMember(req.params.wsId, req.user!.userId)
    const sv = await prisma.montageSourceVideo.findFirst({
      where: { id: req.params.svId, projectId: req.params.id },
    })
    if (!sv) { res.status(404).json({ error: 'Source video not found' }); return }
    await prisma.montageSourceVideo.delete({ where: { id: req.params.svId } })
    if (sv.localPath) fs.unlink(path.join(STORAGE_ROOT, sv.localPath), () => {})
    res.json({ ok: true })
  } catch (e: any) {
    res.status(e.status ?? 500).json({ error: e.message })
  }
})

// ── POST /api/workspaces/:wsId/montage/:id/generate ── start render ───────────
router.post('/:id/generate', async (req, res) => {
  try {
    await requireMember(req.params.wsId, req.user!.userId)
    const project = await prisma.montageProject.findFirst({
      where: { id: req.params.id, workspaceId: req.params.wsId },
      include: { sourceVideos: true },
    })
    if (!project) { res.status(404).json({ error: 'Project not found' }); return }
    if (!project.audioPath) { res.status(422).json({ error: 'Upload audio first' }); return }
    if (!project.sourceVideos.some((sv) => sv.localPath)) { res.status(422).json({ error: 'Add at least one source video with a local file' }); return }

    const job = await montageQueue.enqueue(req.params.id)
    res.json({ job })
  } catch (e: any) {
    res.status(e.status ?? 500).json({ error: e.message })
  }
})

// ── GET /api/workspaces/:wsId/montage/:id/status ── job status ────────────────
router.get('/:id/status', async (req, res) => {
  try {
    await requireMember(req.params.wsId, req.user!.userId)
    const job = await prisma.montageRenderJob.findFirst({
      where: { projectId: req.params.id },
    })
    const project = await prisma.montageProject.findFirst({
      where: { id: req.params.id, workspaceId: req.params.wsId },
      select: { status: true, outputPath: true },
    })
    res.json({ job, status: project?.status, outputPath: project?.outputPath })
  } catch (e: any) {
    res.status(e.status ?? 500).json({ error: e.message })
  }
})

// ── GET /api/workspaces/:wsId/montage/:id/download ── stream MP4 ──────────────
router.get('/:id/download', async (req, res) => {
  try {
    await requireMember(req.params.wsId, req.user!.userId)
    const project = await prisma.montageProject.findFirst({
      where: { id: req.params.id, workspaceId: req.params.wsId },
      select: { outputPath: true, title: true },
    })
    if (!project?.outputPath) { res.status(404).json({ error: 'No output available' }); return }

    const absPath = path.join(STORAGE_ROOT, project.outputPath)
    if (!fs.existsSync(absPath)) { res.status(404).json({ error: 'Output file not found' }); return }

    const filename = `${project.title.replace(/[^a-z0-9]/gi, '_')}_montage.mp4`
    res.setHeader('Content-Type', 'video/mp4')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    fs.createReadStream(absPath).pipe(res)
  } catch (e: any) {
    res.status(e.status ?? 500).json({ error: e.message })
  }
})

// ── GET /api/workspaces/:wsId/montage/:id/stream ── inline player stream ──────
// Uses res.sendFile which automatically handles HTTP Range requests (Accept-Ranges,
// 206 Partial Content) required by HTML5 <video> for seeking to work.
router.get('/:id/stream', async (req, res) => {
  try {
    await requireMember(req.params.wsId, req.user!.userId)
    const project = await prisma.montageProject.findFirst({
      where: { id: req.params.id, workspaceId: req.params.wsId },
      select: { outputPath: true },
    })
    if (!project?.outputPath) { res.status(404).json({ error: 'No output available' }); return }

    const absPath = path.join(STORAGE_ROOT, project.outputPath)
    if (!fs.existsSync(absPath)) { res.status(404).json({ error: 'Output file not found' }); return }

    // sendFile handles Accept-Ranges, Content-Length, and 206 Partial Content automatically
    res.sendFile(absPath)
  } catch (e: any) {
    res.status(e.status ?? 500).json({ error: e.message })
  }
})

router.patch('/:id', async (req, res) => {
  try {
    await requireMember(req.params.wsId, req.user!.userId)
    const { title, style, durationMode, ratio } = req.body
    const project = await prisma.montageProject.update({
      where: { id: req.params.id },
      data: {
        ...(title && { title }),
        ...(style && { style }),
        ...(durationMode && { durationMode }),
        ...(ratio && { ratio }),
      },
      include: { sourceVideos: true, renderJob: true },
    })
    res.json({ project })
  } catch (e: any) {
    res.status(e.status ?? 500).json({ error: e.message })
  }
})

/* ── Single clip thumbnail (first frame) ─────────────────────────── */
router.get('/:id/clip-thumb/:videoId', async (req, res) => {
  try {
    await requireMember(req.params.wsId, req.user!.userId)
    const sv = await prisma.montageSourceVideo.findFirst({
      where: { id: req.params.videoId, project: { id: req.params.id, workspaceId: req.params.wsId } },
      select: { localPath: true },
    })
    if (!sv?.localPath) { res.status(404).json({ error: 'Vidéo introuvable' }); return }
    const videoAbs = path.join(STORAGE_ROOT, sv.localPath)
    if (!fs.existsSync(videoAbs)) { res.status(404).json({ error: 'Fichier introuvable' }); return }

    const thumbDir = path.join(STORAGE_ROOT, 'workspaces', req.params.wsId, 'montage', req.params.id, 'thumbs')
    await fs.promises.mkdir(thumbDir, { recursive: true })
    const thumbPath = path.join(thumbDir, `${req.params.videoId}.jpg`)

    if (!fs.existsSync(thumbPath)) {
      await execAsync(
        `ffmpeg -ss 0.5 -i "${videoAbs}" -vframes 1 -vf "scale=160:-1" -q:v 3 "${thumbPath}" -y`,
        { timeout: 10000 },
      )
    }
    if (!fs.existsSync(thumbPath)) { res.status(404).json({ error: 'Miniature introuvable' }); return }
    res.setHeader('Content-Type', 'image/jpeg')
    res.setHeader('Cache-Control', 'public, max-age=86400')
    fs.createReadStream(thumbPath).pipe(res)
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

/* ── Scene frames — extract JPEG thumbnails at scene cuts ─────────── */
router.get('/:id/frames', async (req, res) => {
  try {
    await requireMember(req.params.wsId, req.user!.userId)
    const project = await prisma.montageProject.findFirst({
      where: { id: req.params.id, workspaceId: req.params.wsId },
      select: { sourceVideos: { select: { id: true, localPath: true, duration: true } } },
    })
    if (!project) { res.status(404).json({ error: 'Projet introuvable' }); return }

    const framesDir = path.join(STORAGE_ROOT, 'workspaces', req.params.wsId, 'montage', req.params.id, 'frames')
    await fs.promises.mkdir(framesDir, { recursive: true })

    const tokenParam = typeof req.query.token === 'string' ? `?token=${encodeURIComponent(req.query.token)}` : ''
    const frames: Array<{ id: string; videoId: string; time: number; url: string }> = []

    for (const sv of project.sourceVideos) {
      if (!sv.localPath) continue
      const videoAbs = path.join(STORAGE_ROOT, sv.localPath)
      if (!fs.existsSync(videoAbs)) continue

      const dur = sv.duration ?? await getVideoDuration(videoAbs)
      const threshold = dur > 300 ? 0.12 : dur < 60 ? 0.20 : 0.15
      let timestamps = await detectSceneTimestamps(videoAbs, threshold)
      // If very few scene cuts, supplement with regular intervals
      if (timestamps.length <= 2) {
        const step = Math.max(2, Math.floor(dur / 10))
        timestamps = Array.from({ length: Math.ceil(dur / step) }, (_, i) => i * step)
      }
      const deduped = [...new Set(timestamps.map(t => +t.toFixed(2)))].slice(0, 50)

      for (const t of deduped) {
        const frameId = `${sv.id}_${t.toFixed(2)}`
        const framePath = path.join(framesDir, `${frameId}.jpg`)

        if (!fs.existsSync(framePath)) {
          try {
            await execAsync(
              `ffmpeg -ss ${t.toFixed(3)} -i "${videoAbs}" -vframes 1 -vf "scale=200:-1" -q:v 3 "${framePath}" -y`,
              { timeout: 12000 },
            )
          } catch { continue }
        }
        if (!fs.existsSync(framePath)) continue
        frames.push({
          id: frameId, videoId: sv.id, time: t,
          url: `/api/workspaces/${req.params.wsId}/montage/${req.params.id}/frames/${frameId}.jpg${tokenParam}`,
        })
      }
    }
    res.json({ frames })
  } catch (e: any) {
    res.status(e.status ?? 500).json({ error: e.message })
  }
})

/* ── Serve a frame JPEG ───────────────────────────────────────────── */
router.get('/:id/frames/:frameFile', async (req, res) => {
  try {
    await requireMember(req.params.wsId, req.user!.userId)
    const framesDir = path.resolve(STORAGE_ROOT, 'workspaces', req.params.wsId, 'montage', req.params.id, 'frames')
    const framePath = path.resolve(framesDir, req.params.frameFile)
    // Prevent path traversal
    if (!framePath.startsWith(framesDir + path.sep)) { res.status(403).json({ error: 'Forbidden' }); return }
    if (!fs.existsSync(framePath)) { res.status(404).json({ error: 'Frame introuvable' }); return }
    res.setHeader('Content-Type', 'image/jpeg')
    res.setHeader('Cache-Control', 'public, max-age=86400')
    fs.createReadStream(framePath).pipe(res)
  } catch (e: any) {
    res.status(e.status ?? 500).json({ error: e.message })
  }
})

/* ── Transcribe audio (local Whisper via faster-whisper) ─────────── */
router.post('/:id/transcribe', async (req, res) => {
  try {
    await requireMember(req.params.wsId, req.user!.userId)
    const project = await prisma.montageProject.findFirst({
      where: { id: req.params.id, workspaceId: req.params.wsId },
      select: { audioPath: true, beatData: true, durationMode: true },
    })
    if (!project?.audioPath) {
      res.status(400).json({ error: 'Aucun fichier audio associé à ce projet.' }); return
    }
    const audioAbs = path.join(STORAGE_ROOT, project.audioPath)
    if (!fs.existsSync(audioAbs)) {
      res.status(404).json({ error: 'Fichier audio introuvable sur le disque.' }); return
    }

    // Locate Python executable (prefer project venv → system PATH)
    const scriptPath = path.join(__dirname, '..', '..', 'scripts', 'transcribe_audio.py')
    const venvPyWin   = path.join(__dirname, '..', '..', '..', '.venv', 'Scripts', 'python.exe')
    const venvPyLinux = path.join(__dirname, '..', '..', '..', '.venv', 'bin', 'python')
    const pyCmd = process.env.PYTHON_BIN ??
      (fs.existsSync(venvPyWin)   ? venvPyWin   :
       fs.existsSync(venvPyLinux) ? venvPyLinux  : 'python')

    // Pass language + model from request body (or fall back to env defaults)
    const { language, model } = req.body ?? {}
    const env: NodeJS.ProcessEnv = { ...process.env }
    if (language && /^[a-z]{2}$/.test(language)) env.WHISPER_LANGUAGE = language
    if (model    && /^(tiny|base|small|medium|large)/.test(model))  env.WHISPER_MODEL = model

    // Read audio offset and duration from saved beat data so we transcribe
    // only the exact segment used in the video (timestamps then match the timeline)
    const beatData: { audioOffset?: number; duration?: number } | null =
      project.beatData ? JSON.parse(project.beatData) : null
    const audioOffset   = beatData?.audioOffset ?? 0
    const audioDuration = beatData?.duration     ?? 0
    const extraArgs: string[] = []
    if (audioOffset > 0)   extraArgs.push('--start-time', String(audioOffset))
    if (audioDuration > 0) extraArgs.push('--duration',   String(Math.ceil(audioDuration)))

    const cmdArgs = extraArgs.length ? ` ${extraArgs.join(' ')}` : ''
    const { stdout, stderr } = await execAsync(
      `"${pyCmd}" "${scriptPath}" "${audioAbs}"${cmdArgs}`,
      { maxBuffer: 10 * 1024 * 1024, timeout: 600_000, env },
    )

    // faster-whisper writes progress to stderr — only fail on real errors
    if (stderr) {
      const errLines = stderr.split('\n').filter(l =>
        l.toLowerCase().includes('error') || l.includes('Traceback') || l.includes('ModuleNotFoundError'),
      )
      if (errLines.length) { res.status(500).json({ error: errLines[0] }); return }
    }

    const parsed = JSON.parse(stdout.trim())
    if (parsed.error) { res.status(500).json({ error: parsed.error }); return }
    res.json({ segments: parsed.segments ?? parsed, language: parsed.language })
  } catch (e: any) {
    res.status(e.status ?? 500).json({ error: e.message })
  }
})

// ── GET /api/workspaces/:wsId/montage/:id/audio ── stream audio file ──────────
router.get('/:id/audio', async (req, res) => {
  try {
    await requireMember(req.params.wsId, req.user!.userId)
    const project = await prisma.montageProject.findFirst({
      where: { id: req.params.id, workspaceId: req.params.wsId },
      select: { audioPath: true },
    })
    if (!project?.audioPath) { res.status(404).json({ error: 'No audio available' }); return }
    const absPath = path.join(STORAGE_ROOT, project.audioPath)
    if (!fs.existsSync(absPath)) { res.status(404).json({ error: 'Audio file not found' }); return }
    const mimeMap: Record<string, string> = {
      '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
      '.flac': 'audio/flac', '.m4a': 'audio/mp4', '.aac': 'audio/aac',
    }
    const ext = path.extname(project.audioPath).toLowerCase()
    res.setHeader('Content-Type', mimeMap[ext] ?? 'audio/mpeg')
    fs.createReadStream(absPath).pipe(res)
  } catch (e: any) {
    res.status(e.status ?? 500).json({ error: e.message })
  }
})

// ── GET /api/workspaces/:wsId/montage/:id/posts ── list social posts ──────────
router.get('/:id/posts', async (req, res) => {
  try {
    await requireMember(req.params.wsId, req.user!.userId)
    const posts = await prisma.socialPost.findMany({
      where: { projectId: req.params.id, workspaceId: req.params.wsId },
      orderBy: { createdAt: 'desc' },
    })
    res.json({ posts })
  } catch (e: any) {
    res.status(e.status ?? 500).json({ error: e.message })
  }
})

// ── POST /api/workspaces/:wsId/montage/:id/publish ── publish or schedule ─────
const SOCIAL_PLATFORMS = ['TIKTOK', 'INSTAGRAM', 'YOUTUBE', 'TWITTER', 'FACEBOOK', 'SNAPCHAT', 'LINKEDIN', 'PINTEREST'] as const
const publishSchema = z.object({
  accountId:   z.string().min(1),                       // explicit account ID (supports multiple per platform)
  platform:    z.enum(SOCIAL_PLATFORMS),
  caption:     z.string().max(2200).optional(),
  hashtags:    z.string().max(500).optional(),
  scheduledAt: z.string().datetime().optional(),
})

router.post('/:id/publish', validate(publishSchema), async (req, res) => {
  try {
    await requireMember(req.params.wsId, req.user!.userId)
    const project = await prisma.montageProject.findFirst({
      where: { id: req.params.id, workspaceId: req.params.wsId },
      select: { id: true, status: true },
    })
    if (!project) { res.status(404).json({ error: 'Project not found' }); return }
    if (project.status !== 'COMPLETED') {
      res.status(400).json({ error: 'Le montage doit être terminé (COMPLETED) avant la publication.' }); return
    }
    const { accountId, platform, caption, hashtags, scheduledAt } = req.body
    // Verify account belongs to this workspace
    const account = await prisma.socialAccount.findFirst({
      where: { id: accountId, workspaceId: req.params.wsId, platform },
    })
    if (!account) {
      res.status(400).json({ error: `Compte introuvable ou non autorisé.` }); return
    }
    const post = await prisma.socialPost.create({
      data: {
        id: uuid(),
        workspaceId: req.params.wsId,
        projectId:   req.params.id,
        accountId:   account.id,
        platform,
        caption:     caption ?? null,
        hashtags:    hashtags ?? null,
        scheduledAt: scheduledAt ? new Date(scheduledAt) : new Date(),
        status: 'PENDING',
      },
    })
    res.status(201).json({ post })
  } catch (e: any) {
    res.status(e.status ?? 500).json({ error: e.message })
  }
})

// ── DELETE /api/workspaces/:wsId/montage/:id/posts/:postId ── cancel post ─────
router.delete('/:id/posts/:postId', async (req, res) => {
  try {
    await requireMember(req.params.wsId, req.user!.userId)
    await prisma.socialPost.updateMany({
      where: {
        id:          req.params.postId,
        projectId:   req.params.id,
        workspaceId: req.params.wsId,
        status:      'PENDING',
      },
      data: { status: 'CANCELLED' },
    })
    res.json({ ok: true })
  } catch (e: any) {
    res.status(e.status ?? 500).json({ error: e.message })
  }
})

// ── POST /api/workspaces/:wsId/montage/:id/videos/reorder ── reorder clips ────
router.post('/:id/videos/reorder', async (req, res) => {
  try {
    await requireMember(req.params.wsId, req.user!.userId)
    const { order } = req.body
    if (!Array.isArray(order)) { res.status(400).json({ error: 'order must be an array of IDs' }); return }
    // Order is currently tracked client-side; server acknowledges it
    res.json({ ok: true, order })
  } catch (e: any) {
    res.status(e.status ?? 500).json({ error: e.message })
  }
})

// ── GET  /api/workspaces/:wsId/montage/:id/clips ─────────────────────────────
router.get('/:id/clips', async (req, res) => {
  try {
    await requireMember(req.params.wsId, req.user!.userId)
    const clips = await prisma.montageClip.findMany({
      where: { projectId: req.params.id },
      orderBy: { position: 'asc' },
    })
    res.json({ clips })
  } catch (e: any) {
    res.status(e.status ?? 500).json({ error: e.message })
  }
})

// ── PATCH /api/workspaces/:wsId/montage/:id/clips ────────────────────────────
router.patch('/:id/clips', async (req, res) => {
  try {
    await requireMember(req.params.wsId, req.user!.userId)
    const { clips } = req.body as { clips: Array<{ id: string; position?: number; transition?: string }> }
    if (!Array.isArray(clips)) { res.status(400).json({ error: 'clips must be an array' }); return }
    await prisma.$transaction(
      clips.map(c =>
        prisma.montageClip.update({
          where: { id: c.id },
          data: {
            ...(c.position  !== undefined && { position:   c.position }),
            ...(c.transition !== undefined && { transition: c.transition }),
          },
        }),
      ),
    )
    res.json({ ok: true })
  } catch (e: any) {
    res.status(e.status ?? 500).json({ error: e.message })
  }
})

// ── DELETE /api/workspaces/:wsId/montage/:id/clips/:clipId ───────────────────
router.delete('/:id/clips/:clipId', async (req, res) => {
  try {
    await requireMember(req.params.wsId, req.user!.userId)
    await prisma.montageClip.delete({ where: { id: req.params.clipId } })
    res.json({ ok: true })
  } catch (e: any) {
    res.status(e.status ?? 500).json({ error: e.message })
  }
})

// ── GET  /api/workspaces/:wsId/montage/:id/beat-data ─────────────────────────
router.get('/:id/beat-data', async (req, res) => {
  try {
    await requireMember(req.params.wsId, req.user!.userId)
    const project = await prisma.montageProject.findFirst({
      where: { id: req.params.id, workspaceId: req.params.wsId },
      select: { beatData: true },
    })
    if (!project) { res.status(404).json({ error: 'Project not found' }); return }
    res.json({ beatData: project.beatData ? JSON.parse(project.beatData) : null })
  } catch (e: any) {
    res.status(e.status ?? 500).json({ error: e.message })
  }
})

// ── PATCH /api/workspaces/:wsId/montage/:id/subtitles ────────────────────────
// Saves transcript segments (from /transcribe) as the subtitle data for next render
router.patch('/:id/subtitles', async (req, res) => {
  try {
    await requireMember(req.params.wsId, req.user!.userId)
    const { segments, style } = req.body as {
      segments: Array<{ start: number; end: number; text: string }>
      style?: unknown
    }
    if (!Array.isArray(segments)) { res.status(400).json({ error: 'segments must be an array' }); return }
    // Store as {segments, style} so the assembler can reproduce the user's visual settings
    await prisma.montageProject.update({
      where: { id: req.params.id },
      data: { subtitleData: JSON.stringify({ segments, style: style ?? null }) },
    })
    res.json({ ok: true })
  } catch (e: any) {
    res.status(e.status ?? 500).json({ error: e.message })
  }
})

// ── POST /api/workspaces/:wsId/montage/:id/burn-subtitles ─────────────────────
// Burn subtitles onto the already-rendered video WITHOUT re-running the full pipeline.
// Takes the existing outputPath, applies drawtext filters, writes a new file, and
// updates outputPath in DB.  Typically 15–60 s vs 5+ min for a full re-render.
router.post('/:id/burn-subtitles', async (req, res) => {
  try {
    await requireMember(req.params.wsId, req.user!.userId)
    const project = await prisma.montageProject.findFirst({
      where: { id: req.params.id, workspaceId: req.params.wsId },
      select: { id: true, workspaceId: true, outputPath: true, subtitleData: true, status: true },
    })
    if (!project) { res.status(404).json({ error: 'Project not found' }); return }
    if (project.status !== 'COMPLETED') { res.status(400).json({ error: 'Primary render not completed' }); return }
    if (!project.outputPath) { res.status(400).json({ error: 'No rendered video found' }); return }

    const { burnSubtitlesOnVideo } = await import('../services/montage/videoAssembler')

    let segments: SubtitleSegment[] = []
    let style: SubtitleStyle | undefined
    if (project.subtitleData) {
      const p: SubtitleSegment[] | { segments: SubtitleSegment[]; style?: SubtitleStyle } = JSON.parse(project.subtitleData)
      if (Array.isArray(p)) { segments = p } else { segments = p.segments; style = p.style ?? undefined }
    }
    if (!segments.length) { res.status(400).json({ error: 'No subtitle segments saved' }); return }

    const inputAbs   = path.join(STORAGE_ROOT, project.outputPath)
    const stamp      = Date.now()
    const outputDir  = path.dirname(inputAbs)
    const outputName = `${project.id}_sub_${stamp}.mp4`
    const outputAbs  = path.join(outputDir, outputName)
    const outputRel  = path.join(project.workspaceId, 'montage', outputName)

    // Mark as processing so the UI can show a spinner
    await prisma.montageProject.update({ where: { id: project.id }, data: { status: 'PROCESSING' } })

    // Run in background so the HTTP response returns immediately
    ;(async () => {
      try {
        await burnSubtitlesOnVideo({ inputPath: inputAbs, outputPath: outputAbs, subtitles: segments, subtitleStyle: style })
        await prisma.montageProject.update({
          where: { id: project.id },
          data: { outputPath: outputRel, status: 'COMPLETED' },
        })
        // Clean up previous output after successfully writing new one
        if (inputAbs !== outputAbs && fs.existsSync(inputAbs)) fs.unlink(inputAbs, () => {})
      } catch (err: any) {
        await prisma.montageProject.update({ where: { id: project.id }, data: { status: 'FAILED' } })
        console.error('[burn-subtitles] error:', err.message)
      }
    })().catch(() => {})

    res.json({ ok: true })
  } catch (e: any) {
    res.status(e.status ?? 500).json({ error: e.message })
  }
})

// ── POST /api/workspaces/:wsId/montage/:id/generate-multi ────────────────────
// Generate PORTRAIT and/or SQUARE variants of the completed montage
router.post('/:id/generate-multi', async (req, res) => {
  try {
    await requireMember(req.params.wsId, req.user!.userId)
    const project = await prisma.montageProject.findFirst({
      where: { id: req.params.id, workspaceId: req.params.wsId },
      include: { clips: { take: 1 } },
    })
    if (!project) { res.status(404).json({ error: 'Project not found' }); return }
    if (project.status !== 'COMPLETED') {
      res.status(400).json({ error: 'Primary render not completed yet' }); return
    }
    if (project.clips.length === 0) {
      res.status(400).json({ error: 'No clips available – run primary generation first' }); return
    }

    // Import engine lazily to avoid circular refs
    const { runMontageEngineRatio } = await import('../services/montage/engine')

    // Kick off both alternative renders in background
    const ratios: Array<'PORTRAIT' | 'SQUARE'> = ['PORTRAIT', 'SQUARE']
    for (const ratio of ratios) {
      const skip = ratio === 'PORTRAIT' ? project.outputPortraitPath : project.outputSquarePath
      if (skip) continue  // already rendered
      void runMontageEngineRatio(
        project.id,
        ratio,
        async () => { /* fire-and-forget */ },
      )
    }

    res.json({ ok: true, message: 'Multi-format generation started' })
  } catch (e: any) {
    res.status(e.status ?? 500).json({ error: e.message })
  }
})

// ── GET  /api/workspaces/:wsId/montage/:id/download?ratio=PORTRAIT ───────────
// Returns the correct output file for LANDSCAPE|PORTRAIT|SQUARE
router.get('/:id/download-format', async (req, res) => {
  try {
    await requireMember(req.params.wsId, req.user!.userId)
    const ratio   = (req.query.ratio as string ?? 'LANDSCAPE').toUpperCase()
    const project = await prisma.montageProject.findFirst({
      where: { id: req.params.id, workspaceId: req.params.wsId },
    })
    if (!project) { res.status(404).json({ error: 'Project not found' }); return }

    let relPath: string | null = null
    if (ratio === 'PORTRAIT')  relPath = project.outputPortraitPath
    else if (ratio === 'SQUARE') relPath = project.outputSquarePath
    else relPath = project.outputPath

    if (!relPath) { res.status(404).json({ error: `${ratio} version not yet rendered` }); return }

    const absPath = path.join(STORAGE_ROOT, relPath)
    if (!fs.existsSync(absPath)) { res.status(404).json({ error: 'Output file not found on disk' }); return }

    const filename = `montage_${project.title.replace(/[^a-zA-Z0-9]/g, '_')}_${ratio.toLowerCase()}.mp4`
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    res.setHeader('Content-Type', 'video/mp4')
    fs.createReadStream(absPath).pipe(res)
  } catch (e: any) {
    res.status(e.status ?? 500).json({ error: e.message })
  }
})

export default router

