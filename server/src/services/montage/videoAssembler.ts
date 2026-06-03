/**
 * videoAssembler – Builds the final MP4 from timeline entries + audio.
 * Features:
 * - Per-segment encoding with video effects + fade transitions
 * - Post-process color grading per project style
 * - Subtitle overlay from transcript segments (drawtext)
 */
import { spawn } from 'child_process'
import path from 'path'
import fs from 'fs'
import { TimelineEntry, VideoEffect, SubtitleSegment, SubtitleStyle } from './types'

const FFMPEG = process.env.FFMPEG_PATH ?? 'ffmpeg'

// Per-style FFmpeg color grading filter
const STYLE_COLOR_GRADE: Record<string, string> = {
  DARK_TRAP:     'eq=contrast=1.3:brightness=-0.05:saturation=0.65,colorchannelmixer=0.4:0.5:0.1:0:0.1:0.4:0.5:0:0.1:0.3:0.6:0',
  CLEAN_MINIMAL: 'eq=contrast=1.05:brightness=0.02:saturation=1.1',
  HYPER_POP:     'eq=contrast=1.2:brightness=0.04:saturation=1.9',
  FAST_CUTS:     'eq=contrast=1.1:saturation=1.15',
  SLOW_MOTION:   'eq=contrast=1.1:brightness=-0.02:saturation=0.9',
  CINEMATIC:     'eq=contrast=1.25:brightness=-0.04:saturation=0.82,vignette=angle=PI/6',
  AMBIENT:       'eq=contrast=0.95:brightness=0.03:saturation=0.75',
  LYRIC_VIDEO:   'eq=contrast=1.1:brightness=-0.03:saturation=0.65',
  EQ_VISUALIZER: 'eq=contrast=1.05:saturation=1.05',
}

// Fade duration (seconds) per transition type
const FADE_DUR: Record<string, number> = {
  cut: 0,
  fade: 0.2,
  dip_to_black: 0.12,
}

export interface AssembleOptions {
  timeline: TimelineEntry[]
  audioPath: string
  outputPath: string
  ratio: string          // LANDSCAPE | PORTRAIT | SQUARE
  style?: string         // ProjectStyle – drives color grade
  subtitles?: SubtitleSegment[]
  subtitleStyle?: SubtitleStyle
  audioOffset?: number   // seconds to skip at the start of the audio file
  onProgress?: (pct: number) => void
}

export async function assembleVideo(opts: AssembleOptions): Promise<void> {
  const { timeline, audioPath, outputPath, ratio, style, subtitles, subtitleStyle, audioOffset } = opts
  if (timeline.length === 0) throw new Error('Empty timeline')

  const [outW, outH] = ratioToDimensions(ratio)
  const tmpDir       = path.dirname(outputPath)
  const stamp        = Date.now()
  const concatListPath = path.join(tmpDir, `concat_${stamp}.txt`)
  const segmentFiles: string[] = []

  // ── Step 1: Encode individual clip segments ───────────────────────
  for (let i = 0; i < timeline.length; i++) {
    const entry   = timeline[i]
    const segPath = path.join(tmpDir, `seg_${i}_${stamp}.ts`)
    const fadeDur = FADE_DUR[entry.transition ?? 'cut'] ?? 0
    await encodeSegment(entry, segPath, outW, outH, fadeDur)
    segmentFiles.push(segPath)
    opts.onProgress?.(Math.round((i / timeline.length) * 60))
  }

  // ── Step 2: Write concat list ─────────────────────────────────────
  const concatContent = segmentFiles.map(f => `file '${f.replace(/\\/g, '/')}'`).join('\n')
  fs.writeFileSync(concatListPath, concatContent, 'utf8')

  // ── Step 3: Build post-process vf chain ──────────────────────────
  const vfFilters: string[] = []

  const colorGrade = style ? (STYLE_COLOR_GRADE[style] ?? null) : null
  if (colorGrade) vfFilters.push(colorGrade)

  if (subtitles && subtitles.length > 0) {
    const dtFilter = buildSubtitleDrawtext(subtitles, outH, subtitleStyle)
    if (dtFilter) vfFilters.push(dtFilter)
  }

  // Use the actual encoded duration (min of outputDuration and clip.duration) to avoid
  // the last-frame-freeze bug: if a clip is shorter than outputDuration, the video track
  // ends early but -t totalDuration keeps the stream open, freezing the last frame.
  const totalDuration = timeline.reduce((s, e) => s + Math.min(e.outputDuration, e.clip.duration), 0)
  const vfArg = vfFilters.length > 0 ? ['-vf', vfFilters.join(',')] : []

  // ── Step 4: Concat + audio mix + post-process ────────────────────
  // If the audio has an offset, use atrim to seek to the right position without stream issues
  const offset = audioOffset ?? 0
  const audioMapArgs = offset > 0
    ? ['-filter_complex', `[1:a]atrim=start=${offset.toFixed(3)},asetpts=PTS-STARTPTS[a]`,
       '-map', '0:v:0', '-map', '[a]']
    : ['-map', '0:v:0', '-map', '1:a:0']

  await new Promise<void>((resolve, reject) => {
    const args = [
      '-f', 'concat', '-safe', '0', '-i', concatListPath,
      '-i', audioPath,
      ...audioMapArgs,
      '-t', String(totalDuration),
      ...vfArg,
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '22',
      '-c:a', 'aac', '-b:a', '192k',
      '-movflags', '+faststart',
      '-y', outputPath,
    ]

    const proc = spawn(FFMPEG, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    proc.stderr.on('data', (d: Buffer) => {
      stderr += d.toString()
      const m = /time=([\d:]+)/.exec(d.toString())
      if (m && opts.onProgress) {
        const t = parseTimecode(m[1])
        opts.onProgress?.(60 + Math.round((t / totalDuration) * 38))
      }
    })
    proc.on('close', code => {
      if (code === 0) resolve()
      else reject(new Error(`FFmpeg concat failed (code ${code}): ${stderr.slice(-500)}`))
    })
    proc.on('error', e => reject(new Error(`FFmpeg spawn error: ${e.message}`)))
  })

  // Cleanup temp files
  for (const f of segmentFiles) fs.unlink(f, () => {})
  fs.unlink(concatListPath, () => {})
  opts.onProgress?.(100)
}

async function encodeSegment(
  entry: TimelineEntry,
  outputPath: string,
  outW: number,
  outH: number,
  fadeDur: number,
): Promise<void> {
  const { clip, outputDuration, effects, transition } = entry
  const effect  = effects[0]
  const clipDur = Math.min(outputDuration, clip.duration)

  return new Promise<void>((resolve, reject) => {
    const vfParts: string[] = [
      `trim=start=${clip.start}:duration=${clipDur}`,
      `setpts=PTS-STARTPTS`,
      // Normalize SAR BEFORE scale — phone/camera videos often have non-1:1 sample
      // aspect ratio (e.g., PAL 16:15). Without this, the scale filter uses the wrong
      // display dimensions and the output frame has incorrect proportions → black bars.
      `setsar=1`,
    ]

    // Remove embedded black bars (letterbox / pillarbox) detected during scene analysis.
    if (clip.cropFilter) vfParts.push(clip.cropFilter)

    vfParts.push(
      // Fill the target canvas without letterboxing: scale up so both dimensions
      // are at least outW×outH, then center-crop to exact size.
      `scale=${outW}:${outH}:force_original_aspect_ratio=increase:flags=lanczos`,
      `crop=${outW}:${outH}`,
      // Re-normalize SAR after scale (scale may emit non-1:1 SAR for some sources).
      `setsar=1`,
    )

    // Pass outW/outH so zoompan uses the correct canvas size instead of a
    // hardcoded hd720, which would cause mixed-resolution concat → black bars.
    const effectFilter = buildEffectFilter(effect, clipDur, outW, outH)
    if (effectFilter) vfParts.push(effectFilter)

    // Fade-in / fade-out for soft transitions
    if (fadeDur > 0 && clipDur > fadeDur * 2) {
      if (transition === 'fade') {
        vfParts.push(`fade=type=in:st=0:d=${fadeDur}`)
        vfParts.push(`fade=type=out:st=${clipDur - fadeDur}:d=${fadeDur}`)
      } else if (transition === 'dip_to_black') {
        vfParts.push(`fade=type=in:st=0:d=${fadeDur}:color=black`)
        vfParts.push(`fade=type=out:st=${clipDur - fadeDur}:d=${fadeDur}:color=black`)
      }
    }
    // Normalize pixel format — prevents concat failures when source videos
    // have yuv422p / yuva420p / other formats that libx264 cannot directly use.
    vfParts.push(`format=yuv420p`)

    const args = [
      '-i', clip.videoPath,
      '-vf', vfParts.join(','),
      '-t', String(clipDur),
      '-an',
      // Hard-enforce the output dimensions — catches any rounding edge case from
      // scale+crop producing 1919×1080 instead of 1920×1080 on odd-dimension sources.
      '-s', `${outW}x${outH}`,
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '25',
      '-y', outputPath,
    ]

    const proc = spawn(FFMPEG, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    proc.on('close', code => {
      if (code === 0) resolve()
      else reject(new Error(`Segment encode failed (code ${code}) for ${clip.videoPath}`))
    })
    proc.on('error', e => reject(new Error(`FFmpeg spawn error: ${e.message}`)))
  })
}

function buildEffectFilter(effect: VideoEffect, duration: number, outW: number, outH: number): string | null {
  switch (effect.type) {
    case 'zoom_in': {
      const scale = 1 + effect.intensity
      // Use actual output dimensions — s=hd720 would produce 1280×720 regardless
      // of target ratio, causing mixed-size concat segments → black bars.
      return `zoompan=z='min(zoom+${effect.intensity / (duration * 25)},${scale})':d=${Math.round(duration * 25)}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${outW}x${outH}`
    }
    case 'slow_motion':
      return `setpts=${1 / effect.factor}*PTS`
    case 'speed_ramp':
      return `setpts=${effect.factor}*PTS`
    case 'color_boost':
      return `eq=saturation=${effect.saturation}:contrast=${effect.contrast}`
    case 'flash':
      return `curves=preset=color_negative:enable='between(t,0,${effect.duration})'`
    case 'dip_to_black':
      return `fade=type=out:st=${Math.max(0, duration - effect.duration)}:d=${effect.duration}:color=black`
    default:
      return null
  }
}

/** Convert a CSS hex colour (#RRGGBB) to FFmpeg's 0xRRGGBB format */
function hexToFfmpegColor(hex: string): string {
  return '0x' + hex.replace('#', '').toUpperCase()
}

/** Build a chain of drawtext filters for subtitle overlay */
function buildSubtitleDrawtext(segs: SubtitleSegment[], outH: number, style?: SubtitleStyle): string {
  if (!segs.length) return ''
  const relativeSz = style ? style.fontSize / 100 : 1
  const fontSize = Math.max(12, Math.round(outH / 30 * relativeSz))
  const boxPad   = Math.round(fontSize / 4)

  // ── Position ───────────────────────────────────────────────────────────
  let xExpr: string
  let yExpr: string
  const pos = style?.position ?? 'BOTTOM'
  if (pos === 'CUSTOM' && style?.customX != null && style?.customY != null) {
    xExpr = `w*${(style.customX / 100).toFixed(4)}-text_w/2`
    yExpr = `h*${(style.customY / 100).toFixed(4)}-text_h/2`
  } else if (pos === 'TOP') {
    xExpr = '(w-text_w)/2'
    yExpr = 'h*0.08'
  } else if (pos === 'CENTER') {
    xExpr = '(w-text_w)/2'
    yExpr = '(h-text_h)/2'
  } else {
    // BOTTOM (default)
    const marginV = Math.round(outH / 18)
    xExpr = '(w-text_w)/2'
    yExpr = `h-${marginV}-text_h`
  }

  // ── Colors ─────────────────────────────────────────────────────────────
  const fontColor = style ? hexToFfmpegColor(style.color) : '0xFFFFFF'
  const bgHex     = style ? hexToFfmpegColor(style.bgColor) : '0x000000'
  const bgAlpha   = style ? (style.bgOpacity / 100).toFixed(2) : '0.55'
  const useBox    = style ? style.bgOpacity > 0 : true

  // ── Effect extras (shadow / outline) ───────────────────────────────────
  let effectOpts = ':shadowx=1:shadowy=1:shadowcolor=0x000000@0.85'  // legibility default
  if (style?.effect === 'SHADOW' && style.effectColor) {
    effectOpts = `:shadowx=3:shadowy=3:shadowcolor=${hexToFfmpegColor(style.effectColor)}@0.92`
  } else if (style?.effect === 'OUTLINE' && style.effectColor) {
    effectOpts = `:borderw=2:bordercolor=${hexToFfmpegColor(style.effectColor)}:shadowx=0:shadowy=0`
  }
  // GLOW/NEON: not reproducible via drawtext without complex masking — keep default shadow

  const parts = segs.map(seg => {
    const text = seg.text.trim()
    if (!text) return null
    // Escape for FFmpeg filter string
    const escaped = text
      .replace(/\\/g, '\\\\')
      .replace(/'/g,  '\u2019')
      .replace(/:/g,  '\\:')
      .replace(/,/g,  '\\,')
      .replace(/\[/g, '\\[')
      .replace(/\]/g, '\\]')
      .replace(/\n/g, ' ')
    const boxPart = useBox
      ? `:box=1:boxcolor=${bgHex}@${bgAlpha}:boxborderw=${boxPad}`
      : ''
    return (
      `drawtext=fontsize=${fontSize}` +
      `:text='${escaped}'` +
      `:x=${xExpr}` +
      `:y=${yExpr}` +
      `:fontcolor=${fontColor}` +
      boxPart +
      effectOpts +
      `:enable='between(t,${seg.start},${seg.end})'`
    )
  }).filter((p): p is string => p !== null)

  return parts.join(',')
}

/** Build SRT subtitle file content (used for external reference / archiving) */
export function buildSRT(segs: SubtitleSegment[]): string {
  return segs.map((seg, i) =>
    `${i + 1}\n${formatSRTTime(seg.start)} --> ${formatSRTTime(seg.end)}\n${seg.text.trim()}\n`
  ).join('\n')
}

/**
 * Lightweight subtitle burn-in: takes an already-rendered MP4 and overlays
 * subtitle text using FFmpeg drawtext — without re-encoding the timeline or
 * re-analysing any clips.  Output is written to `outputPath`.
 *
 * Uses `-c:v libx264 -preset fast -crf 18` (near-lossless) so quality is
 * preserved.  Audio is copied directly (-c:a copy).
 * Duration: typically 15–60 s for a 1–5 min video.
 */
export async function burnSubtitlesOnVideo(opts: {
  inputPath: string
  outputPath: string
  subtitles: SubtitleSegment[]
  subtitleStyle?: SubtitleStyle
  onProgress?: (pct: number) => void
}): Promise<void> {
  const { inputPath, outputPath, subtitles, subtitleStyle, onProgress } = opts

  if (!fs.existsSync(inputPath)) throw new Error(`Input video not found: ${inputPath}`)

  // Build the drawtext vf chain using the same helper used during full assembly
  // We need outH to size the font — probe it quickly via ffprobe
  const outH = await probeVideoHeight(inputPath)
  const dtFilter = buildSubtitleDrawtext(subtitles, outH, subtitleStyle)

  const args = [
    '-i', inputPath,
    ...(dtFilter ? ['-vf', dtFilter] : []),
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '18',
    '-c:a', 'copy',
    '-movflags', '+faststart',
    '-y', outputPath,
  ]

  await new Promise<void>((resolve, reject) => {
    // Get duration for progress
    let totalDuration = 0
    const proc = spawn(FFMPEG, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    proc.stderr.on('data', (d: Buffer) => {
      const chunk = d.toString()
      stderr += chunk
      if (!totalDuration) {
        const dm = /Duration:\s*(\d+):(\d+):(\d+)/.exec(stderr)
        if (dm) totalDuration = Number(dm[1]) * 3600 + Number(dm[2]) * 60 + Number(dm[3])
      }
      if (onProgress && totalDuration) {
        const m = /time=([\d:]+)/.exec(chunk)
        if (m) onProgress(Math.round((parseTimecode(m[1]) / totalDuration) * 100))
      }
    })
    proc.on('close', code => {
      if (code === 0) resolve()
      else reject(new Error(`FFmpeg subtitle burn failed (code ${code}): ${stderr.slice(-600)}`))
    })
    proc.on('error', e => reject(new Error(`FFmpeg spawn error: ${e.message}`)))
  })
}

/** Probe the pixel height of a video file */
async function probeVideoHeight(filePath: string): Promise<number> {
  const FFPROBE = process.env.FFPROBE_PATH ?? 'ffprobe'
  return new Promise<number>((resolve) => {
    const proc = spawn(FFPROBE, [
      '-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=height',
      '-of', 'csv=s=x:p=0',
      filePath,
    ], { stdio: ['ignore', 'pipe', 'ignore'] })
    let out = ''
    proc.stdout.on('data', (d: Buffer) => (out += d.toString()))
    proc.on('close', () => resolve(Math.max(360, parseInt(out.trim(), 10) || 1080)))
    proc.on('error', () => resolve(1080))
  })
}

function formatSRTTime(seconds: number): string {
  const h  = Math.floor(seconds / 3600)
  const m  = Math.floor((seconds % 3600) / 60)
  const s  = Math.floor(seconds % 60)
  const ms = Math.round((seconds % 1) * 1000)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`
}

export function ratioToDimensions(ratio: string): [number, number] {
  switch (ratio) {
    case 'PORTRAIT': return [1080, 1920]
    case 'SQUARE':   return [1080, 1080]
    default:         return [1920, 1080]
  }
}

function parseTimecode(tc: string): number {
  const parts = tc.split(':').map(Number)
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return parts[0] ?? 0
}
