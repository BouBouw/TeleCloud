import { spawn } from 'child_process'
import { randomUUID } from 'crypto'
import { SceneClip, ScoreDetails } from './types'

const FFMPEG = process.env.FFMPEG_PATH ?? 'ffmpeg'
const FFPROBE = process.env.FFPROBE_PATH ?? 'ffprobe'

export async function extractSceneClips(
  sourceVideoId: string,
  videoPath: string,
  opts: { threshold?: number; minDuration?: number; maxDuration?: number } = {},
): Promise<SceneClip[]> {
  const { minDuration = 0.4 } = opts
  const duration = await getVideoDuration(videoPath)
  const threshold = opts.threshold ?? (duration > 300 ? 0.12 : duration < 60 ? 0.20 : 0.15)
  const maxDuration = opts.maxDuration ?? Math.min(8, Math.max(3, duration * 0.05))

  // Detect black bars once per source video (fast — probes first 60 s)
  const cropFilter = await detectCropParams(videoPath, duration)

  const sceneTimestamps = await detectSceneTimestamps(videoPath, threshold)
  const boundaries = [...sceneTimestamps, duration]
  const clips: SceneClip[] = []

  for (let i = 0; i < boundaries.length - 1; i++) {
    const start = boundaries[i]
    const end = boundaries[i + 1]
    const clipDuration = end - start
    if (clipDuration < minDuration) continue
    // Skip the first 8 s of every video — almost always title cards, logos or
    // black leader frames in music videos / scraped content.
    if (end <= 8) continue
    const safeStart = Math.max(start, 8)

    if (clipDuration > maxDuration) {
      let cursor = safeStart
      while (cursor < end - minDuration) {
        const chunkEnd = Math.min(cursor + maxDuration, end)
        clips.push({ id: randomUUID(), sourceVideoId, videoPath, start: cursor, end: chunkEnd, duration: chunkEnd - cursor, score: emptyScore(), cropFilter })
        cursor = chunkEnd
      }
    } else {
      const adjustedDuration = end - safeStart
      if (adjustedDuration < minDuration) continue
      clips.push({ id: randomUUID(), sourceVideoId, videoPath, start: safeStart, end, duration: adjustedDuration, score: emptyScore(), cropFilter })
    }
  }
  return clips
}

export async function detectSceneTimestamps(videoPath: string, threshold: number): Promise<number[]> {
  return new Promise((resolve) => {
    const proc = spawn(FFMPEG, [
      '-i', videoPath,
      '-vf', `select=gt(scene\\,${threshold}),showinfo`,
      '-vsync', 'vfr', '-f', 'null', '-',
    ], { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    proc.stderr.on('data', (d: Buffer) => (stderr += d.toString()))
    proc.on('close', () => {
      const timestamps: number[] = [0]
      const regex = /pts_time:([\d.]+)/g
      let match
      while ((match = regex.exec(stderr)) !== null) {
        const t = parseFloat(match[1])
        if (!isNaN(t) && t > 0) timestamps.push(t)
      }
      resolve(timestamps.sort((a, b) => a - b))
    })
    proc.on('error', () => resolve([0]))
  })
}

export async function getVideoDuration(videoPath: string): Promise<number> {
  return new Promise((resolve) => {
    const proc = spawn(FFPROBE, [
      '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', videoPath,
    ])
    let out = ''
    proc.stdout.on('data', (d: Buffer) => (out += d.toString()))
    proc.on('close', () => resolve(parseFloat(out.trim()) || 0))
    proc.on('error', () => resolve(0))
  })
}

/**
 * Detect embedded black bars (letterbox / pillarbox) by running FFmpeg's
 * cropdetect filter over the first 60 s of the video.
 * Returns a crop filter string like "crop=1920:816:0:132" or null when the
 * bars are negligible (< 2 % of the frame height/width).
 */
export async function detectCropParams(videoPath: string, duration: number): Promise<string | null> {
  return new Promise((resolve) => {
    const proc = spawn(FFMPEG, [
      '-i', videoPath,
      '-vf', 'cropdetect=limit=24:round=2:reset=1',
      '-t', String(Math.min(duration, 60)),
      '-skip_frame', 'noref',
      '-vsync', 'vfr',
      '-an', '-f', 'null', '-',
    ], { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    proc.stderr.on('data', (d: Buffer) => (stderr += d.toString()))
    proc.on('close', () => {
      const matches = [...stderr.matchAll(/crop=(\d+):(\d+):(\d+):(\d+)/g)]
      if (!matches.length) { resolve(null); return }
      // Take the most frequently occurring crop value (mode), skipping flicker from fades
      const freq = new Map<string, number>()
      for (const m of matches) {
        const key = `${m[1]}:${m[2]}:${m[3]}:${m[4]}`
        freq.set(key, (freq.get(key) ?? 0) + 1)
      }
      const best = [...freq.entries()].sort((a, b) => b[1] - a[1])[0][0]
      const [w, h, x, y] = best.split(':').map(Number)
      // Probe original size via the first cropdetect line that contains "w:" metadata
      const sizeMatch = /(\d+)x(\d+)/.exec(stderr)
      const origW = sizeMatch ? Number(sizeMatch[1]) : w
      const origH = sizeMatch ? Number(sizeMatch[2]) : h
      // Ignore trivial crops (bars < 2 % of dimension)
      if (Math.abs(w - origW) < origW * 0.02 && Math.abs(h - origH) < origH * 0.02) {
        resolve(null); return
      }
      resolve(`crop=${w}:${h}:${x}:${y}`)
    })
    proc.on('error', () => resolve(null))
  })
}

function emptyScore(): ScoreDetails {
  return { overall: 0, motion: 0, brightness: 0, contrast: 0, sharpness: 0, energy: 0, faceScore: 0, textPenalty: 0 }
}

export async function scoreClips(clips: SceneClip[], concurrency = 4): Promise<SceneClip[]> {
  const results: SceneClip[] = []
  const queue = [...clips]
  async function worker() {
    while (queue.length > 0) {
      const clip = queue.shift()!
      try {
        results.push(await scoreClip(clip))
      } catch {
        results.push({ ...clip, score: neutralScore() })
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker))
  return results
}

async function scoreClip(clip: SceneClip): Promise<SceneClip> {
  const [[brightness, contrast, faceScore], motion, sharpness, textScore] = await Promise.all([
    measureFrameStats(clip),
    measureMotion(clip),
    measureSharpness(clip),
    measureTextPenalty(clip),
  ])
  // Over-zoom: faceScore > 0.70 means skin fills most of the frame → no context visible
  const overZoom = Math.max(0, Math.min(1, (faceScore - 0.70) / 0.30))
  const textPenalty = Math.max(textScore, overZoom)
  // Penalise energy for text-overlaid / over-zoomed frames
  const energy = (brightness * 0.2 + contrast * 0.3 + motion * 0.3 + sharpness * 0.2) * (1 - textPenalty * 0.6)
  return {
    ...clip,
    score: {
      overall: clamp(energy, 0, 1),
      motion: clamp(motion, 0, 1),
      brightness: clamp(brightness, 0, 1),
      contrast: clamp(contrast, 0, 1),
      sharpness: clamp(sharpness, 0, 1),
      energy: clamp(energy, 0, 1),
      faceScore: clamp(faceScore, 0, 1),
      textPenalty: clamp(textPenalty, 0, 1),
    },
  }
}

/**
 * Measure brightness, contrast and skin-tone face score from a single FFmpeg pass.
 * Uses signalstats=stat=tout to get Y/U/V averages simultaneously.
 * Skin-tone detection in YCbCr 8-bit (0–255):
 *   Cb(U) ≈ 98–142 (around 120), Cr(V) ≈ 133–173 (around 153), Y = 60–230
 */
async function measureFrameStats(clip: SceneClip): Promise<[number, number, number]> {
  return new Promise((resolve) => {
    const midTime = clip.start + clip.duration / 2
    const proc = spawn(FFMPEG, [
      '-ss', String(midTime),
      '-i', clip.videoPath,
      '-t', '1',
      '-vf', 'signalstats=stat=tout',
      '-f', 'null', '-',
    ], { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    proc.stderr.on('data', (d: Buffer) => (stderr += d.toString()))
    proc.on('close', () => {
      const yavg = parseFloat((/YAVG:([0-9.]+)/i.exec(stderr) ?? [])[1] ?? '128')
      const ystd = parseFloat((/YSTD:([0-9.]+)/i.exec(stderr) ?? [])[1] ?? '40')
      const uavg = parseFloat((/UAVG:([0-9.]+)/i.exec(stderr) ?? [])[1] ?? '128')
      const vavg = parseFloat((/VAVG:([0-9.]+)/i.exec(stderr) ?? [])[1] ?? '128')

      const brightness = clamp(yavg / 255, 0, 1)
      const contrast   = clamp(Math.min(ystd, 80) / 80, 0, 1)

      // Only score skin tones when luma is in a usable range (not black or blown out)
      const yOk    = yavg >= 60 && yavg <= 230 ? 1 : 0
      const uScore = Math.max(0, 1 - Math.abs(uavg - 120) / 22) * yOk
      const vScore = Math.max(0, 1 - Math.abs(vavg - 153) / 20) * yOk
      const faceScore = (uScore + vScore) / 2

      resolve([brightness, contrast, faceScore])
    })
    proc.on('error', () => resolve([0.5, 0.5, 0]))
  })
}

/**
 * Detect burned-in text, watermarks and subtitles via Laplacian edge density
 * measured in the bottom 18 % strip of a single frame.
 *
 * Text zones have very dense, high-contrast horizontal edges (character strokes)
 * that produce a high YAVG after edge-detection — clearly above natural scene
 * textures (grass, clothing, concrete).
 *
 * Calibration (YAVG of edge-detected bottom strip):
 *   ≤ 22  → clean (natural textures)       → penalty 0
 *   22–55 → suspicious                     → penalty rising to 1
 *   ≥ 55  → definite text/watermark        → penalty 1
 *
 * Over-zoom (person fills entire frame, no background) is handled separately
 * in scoreClip() using the existing faceScore signal.
 */
async function measureTextPenalty(clip: SceneClip): Promise<number> {
  return new Promise((resolve) => {
    const midTime = clip.start + clip.duration / 2
    // For clips in the first 30 s of a video, also scan the upper half for title-card text.
    // Beyond 30 s we only scan the bottom strip (watermarks / subtitles).
    const isEarlyClip = clip.start < 30
    const vfFilter = isEarlyClip
      // Full-frame edge density for early clips (catches centered title text)
      ? 'edgedetect=low=0.08:high=0.35,signalstats'
      // Bottom 18 % strip only for regular clips
      : 'crop=iw:ih*0.18:0:ih*0.82,edgedetect=low=0.08:high=0.35,signalstats'
    const proc = spawn(FFMPEG, [
      '-ss', String(midTime),
      '-i', clip.videoPath,
      '-vframes', '1',
      '-vf', vfFilter,
      '-f', 'null', '-',
    ], { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    proc.stderr.on('data', (d: Buffer) => (stderr += d.toString()))
    proc.on('close', () => {
      const yavg = parseFloat((/YAVG:([0-9.]+)/i.exec(stderr) ?? [])[1] ?? '0')
      // For early clips the whole-frame threshold is higher (scene has more edge detail)
      const low  = isEarlyClip ? 28 : 22
      const high = isEarlyClip ? 58 : 55
      resolve(clamp((yavg - low) / (high - low), 0, 1))
    })
    proc.on('error', () => resolve(0))
  })
}

async function measureMotion(clip: SceneClip): Promise<number> {
  return new Promise((resolve) => {
    const proc = spawn(FFMPEG, ['-ss', String(clip.start), '-i', clip.videoPath, '-t', String(Math.min(clip.duration, 3)), '-vf', 'select=1,showinfo', '-vsync', 'vfr', '-f', 'null', '-'], { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    proc.stderr.on('data', (d: Buffer) => (stderr += d.toString()))
    proc.on('close', () => {
      const scores: number[] = []
      const re = /iskey:(\d)/g; let m
      while ((m = re.exec(stderr)) !== null) scores.push(parseInt(m[1], 10))
      resolve(clamp(scores.length > 0 ? (scores.filter((s) => s === 1).length / scores.length) * 2 : 0.3, 0, 1))
    })
    proc.on('error', () => resolve(0.3))
  })
}

async function measureSharpness(clip: SceneClip): Promise<number> {
  return new Promise((resolve) => {
    const midTime = clip.start + clip.duration / 2
    const proc = spawn(FFMPEG, ['-ss', String(midTime), '-i', clip.videoPath, '-vframes', '1', '-vf', 'blurdetect=high=50:low=10', '-f', 'null', '-'], { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    proc.stderr.on('data', (d: Buffer) => (stderr += d.toString()))
    proc.on('close', () => {
      const blurMatch = /blur:([0-9.]+)/i.exec(stderr)
      resolve(blurMatch ? clamp(1 - parseFloat(blurMatch[1]), 0, 1) : 0.6)
    })
    proc.on('error', () => resolve(0.6))
  })
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

function neutralScore(): ScoreDetails {
  return { overall: 0.5, motion: 0.5, brightness: 0.5, contrast: 0.5, sharpness: 0.5, energy: 0.5, faceScore: 0, textPenalty: 0 }
}
