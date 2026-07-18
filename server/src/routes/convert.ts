import { Router } from 'express'
import path from 'path'
import fs from 'fs'
import { spawn } from 'child_process'
import multer from 'multer'
import { v4 as uuid } from 'uuid'
import prisma from '../lib/prisma'
import { authenticate } from '../middleware/auth'

const router = Router({ mergeParams: true })
router.use(authenticate)

const STORAGE_ROOT = path.resolve(process.env.STORAGE_PATH ?? './storage')

const AUDIO_FORMATS = ['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac', 'opus']
const VIDEO_FORMATS = ['mp4', 'mov', 'avi', 'mkv', 'webm']
const IMAGE_FORMATS = ['png', 'jpg', 'jpeg', 'webp', 'bmp']
const ALL_FORMATS   = [...AUDIO_FORMATS, ...VIDEO_FORMATS, ...IMAGE_FORMATS, 'gif']

function getCategory(ext: string): 'audio' | 'video' | 'image' | null {
  if (AUDIO_FORMATS.includes(ext)) return 'audio'
  if (VIDEO_FORMATS.includes(ext) || ext === 'gif') return 'video'
  if (IMAGE_FORMATS.includes(ext)) return 'image'
  return null
}

interface WsParams  { wsId: string; [key: string]: string }
interface JobParams extends WsParams { jobId: string }

async function assertMember(workspaceId: string, userId: string) {
  return prisma.workspaceMember.findFirst({ where: { workspaceId, userId } })
}

// ── Multer: store uploads in _tmp ─────────────────────────────────────────────
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      const dir = path.join(STORAGE_ROOT, '_tmp')
      fs.mkdirSync(dir, { recursive: true })
      cb(null, dir)
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || '.bin'
      cb(null, `${uuid()}${ext}`)
    },
  }),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB
})

// ── ffmpeg argument builder ────────────────────────────────────────────────────
function buildFfmpegArgs(inputPath: string, outputPath: string, inExt: string, outExt: string): string[] {
  const inCat  = getCategory(inExt)
  const args: string[] = ['-i', inputPath, '-y']

  if (AUDIO_FORMATS.includes(outExt)) {
    if (inCat === 'video') args.push('-vn')
    if      (outExt === 'mp3')  args.push('-acodec', 'libmp3lame', '-q:a', '2')
    else if (outExt === 'wav')  args.push('-acodec', 'pcm_s16le')
    else if (outExt === 'flac') args.push('-acodec', 'flac')
    else if (outExt === 'ogg')  args.push('-acodec', 'libvorbis', '-q:a', '6')
    else if (outExt === 'm4a')  args.push('-acodec', 'aac', '-b:a', '192k', '-movflags', '+faststart')
    else if (outExt === 'aac')  args.push('-acodec', 'aac', '-b:a', '192k')
    else if (outExt === 'opus') args.push('-acodec', 'libopus', '-b:a', '128k')
  } else if (outExt === 'gif') {
    args.push('-vf', 'fps=10,scale=480:-1:flags=lanczos', '-loop', '0')
  } else if (VIDEO_FORMATS.includes(outExt)) {
    if (outExt === 'mp4') {
      args.push('-c:v', 'libx264', '-preset', 'fast', '-crf', '23')
      if (inCat !== 'image') args.push('-c:a', 'aac', '-b:a', '192k')
      args.push('-movflags', '+faststart')
    } else if (outExt === 'webm') {
      args.push('-c:v', 'libvpx-vp9', '-crf', '30', '-b:v', '0', '-c:a', 'libopus')
    } else {
      args.push('-c:v', 'libx264', '-preset', 'fast')
      if (inCat !== 'image') args.push('-c:a', 'aac')
    }
  } else if (IMAGE_FORMATS.includes(outExt)) {
    if (inCat === 'video') args.push('-vframes', '1')
    if (outExt === 'jpg' || outExt === 'jpeg') args.push('-q:v', '2')
    else if (outExt === 'webp') args.push('-q:v', '80')
  }

  args.push(outputPath)
  return args
}

/* ── POST /api/workspaces/:wsId/convert ─────────────────────────────────────── */
router.post<WsParams>('/', upload.single('file'), async (req, res) => {
  const member = await assertMember(req.params.wsId, req.user!.userId)
  if (!member) { res.status(403).json({ error: 'Not a member' }); return }
  if (!req.file) { res.status(400).json({ error: 'No file provided' }); return }

  const { outputFormat } = req.body as { outputFormat?: string }
  if (!outputFormat) { res.status(400).json({ error: 'outputFormat required' }); return }

  const outExt   = outputFormat.toLowerCase().replace('.', '')
  const inExt    = path.extname(req.file.originalname).slice(1).toLowerCase()
  const inputName = req.file.originalname
  const inputPath = req.file.path

  if (!ALL_FORMATS.includes(outExt)) {
    fs.unlink(inputPath, () => {})
    res.status(400).json({ error: `Format non supporté: ${outExt}` }); return
  }

  const jobId = uuid()
  const job = await prisma.conversionJob.create({
    data: { id: jobId, workspaceId: req.params.wsId, inputName, inputFormat: inExt, outputFormat: outExt, status: 'processing' },
  })

  // Run conversion asynchronously — return 202 immediately
  ;(async () => {
    const convertDir    = path.join(STORAGE_ROOT, '_converted')
    const outputFilename = `${jobId}.${outExt}`
    const outputPath    = path.join(convertDir, outputFilename)

    try {
      fs.mkdirSync(convertDir, { recursive: true })
      const args = buildFfmpegArgs(inputPath, outputPath, inExt, outExt)

      await new Promise<void>((resolve, reject) => {
        const proc = spawn('ffmpeg', args)
        let stderr = ''
        proc.stderr.on('data', (d: Buffer) => { stderr += d.toString() })
        proc.on('close', code => {
          if (code === 0) resolve()
          else reject(new Error(stderr.slice(-600)))
        })
      })

      const stat = fs.statSync(outputPath)
      await prisma.conversionJob.update({
        where: { id: jobId },
        data: { status: 'done', outputPath: `_converted/${outputFilename}`, fileSize: stat.size },
      })
    } catch (err) {
      await prisma.conversionJob.update({
        where: { id: jobId },
        data: { status: 'error', errorMsg: String(err).slice(0, 500) },
      })
    } finally {
      fs.unlink(inputPath, () => {})
    }
  })()

  res.status(202).json({ job })
})

/* ── GET /api/workspaces/:wsId/convert — history ─────────────────────────────── */
router.get<WsParams>('/', async (req, res) => {
  const member = await assertMember(req.params.wsId, req.user!.userId)
  if (!member) { res.status(403).json({ error: 'Not a member' }); return }
  try {
    const jobs = await prisma.conversionJob.findMany({
      where: { workspaceId: req.params.wsId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
    res.json({ jobs })
  } catch {
    res.status(500).json({ error: 'Internal server error' })
  }
})

/* ── GET /api/workspaces/:wsId/convert/:jobId — poll status ─────────────────── */
router.get<JobParams>('/:jobId', async (req, res) => {
  const member = await assertMember(req.params.wsId, req.user!.userId)
  if (!member) { res.status(403).json({ error: 'Not a member' }); return }
  try {
    const job = await prisma.conversionJob.findFirst({ where: { id: req.params.jobId, workspaceId: req.params.wsId } })
    if (!job) { res.status(404).json({ error: 'Not found' }); return }
    res.json({ job })
  } catch {
    res.status(500).json({ error: 'Internal server error' })
  }
})

/* ── GET /api/workspaces/:wsId/convert/:jobId/download ───────────────────────── */
router.get<JobParams>('/:jobId/download', async (req, res) => {
  const member = await assertMember(req.params.wsId, req.user!.userId)
  if (!member) { res.status(403).json({ error: 'Not a member' }); return }

  const job = await prisma.conversionJob.findFirst({
    where: { id: req.params.jobId, workspaceId: req.params.wsId, status: 'done' },
  })
  if (!job?.outputPath) { res.status(404).json({ error: 'Not found' }); return }

  const absPath = path.join(STORAGE_ROOT, job.outputPath)
  if (!fs.existsSync(absPath)) { res.status(404).json({ error: 'File not found on disk' }); return }

  const outName = `${path.parse(job.inputName).name}.${job.outputFormat}`
  res.download(absPath, outName)
})

/* ── DELETE /api/workspaces/:wsId/convert/:jobId ─────────────────────────────── */
router.delete<JobParams>('/:jobId', async (req, res) => {
  const member = await assertMember(req.params.wsId, req.user!.userId)
  if (!member) { res.status(403).json({ error: 'Not a member' }); return }

  const job = await prisma.conversionJob.findFirst({ where: { id: req.params.jobId, workspaceId: req.params.wsId } })
  if (!job) { res.status(404).json({ error: 'Not found' }); return }

  if (job.outputPath) {
    const absPath = path.join(STORAGE_ROOT, job.outputPath)
    if (fs.existsSync(absPath)) fs.unlinkSync(absPath)
  }

  await prisma.conversionJob.delete({ where: { id: job.id } })
  res.json({ message: 'Deleted' })
})

export default router
