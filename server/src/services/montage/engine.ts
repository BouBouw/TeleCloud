/**
 * Montage Render Engine – orchestrates the full pipeline:
 * 1. Audio analysis (BPM, beats, sections)
 * 2. Scene detection + scoring for each source video
 * 3. Timeline composition (beat-sync + style)
 * 4. FFmpeg assembly (with color grading + transitions + subtitles)
 */
import path from 'path'
import fs from 'fs'
import { randomUUID } from 'crypto'
import prisma from '../../lib/prisma'
import { analyseAudio, findBestAudioSegment } from './audioAnalyzer'
import { extractSceneClips, scoreClips } from './sceneProcessor'
import { composeTimeline, resolveTargetDuration } from './timelineComposer'
import { assembleVideo } from './videoAssembler'
import { ProjectStyle, DurationMode, SubtitleSegment, SubtitleStyle } from './types'

const STORAGE_ROOT = path.resolve(process.env.STORAGE_PATH ?? './storage')

type LogFn = (step: string, pct: number, msg: string) => Promise<void>

export async function runMontageEngine(projectId: string, log: LogFn): Promise<string> {
  const project = await prisma.montageProject.findUniqueOrThrow({
    where: { id: projectId },
    include: { sourceVideos: true },
  })

  if (!project.audioPath) throw new Error('No audio file attached to project')
  if (project.sourceVideos.length === 0) throw new Error('No source videos attached to project')

  const audioAbsPath = path.join(STORAGE_ROOT, project.audioPath)
  if (!fs.existsSync(audioAbsPath)) throw new Error(`Audio file not found: ${project.audioPath}`)

  // ── Step 1: Audio analysis ──────────────────────────────────────────────
  await log('ANALYSING_AUDIO', 5, 'Analysing audio…')
  const beatInfo = await analyseAudio(audioAbsPath)
  await log('ANALYSING_AUDIO', 10, `BPM: ${beatInfo.bpm}, ${beatInfo.beats.length} beats, ${beatInfo.sections.length} sections`)

  // Find the best audio segment window (skip for FULL_SONG — use the whole track)
  const durationMode = project.durationMode as DurationMode
  const targetDuration = resolveTargetDuration(durationMode, beatInfo.duration)
  const audioOffset = durationMode !== 'FULL_SONG'
    ? findBestAudioSegment(beatInfo, targetDuration)
    : 0

  if (audioOffset > 0) {
    await log('ANALYSING_AUDIO', 12, `Best segment starts at ${audioOffset.toFixed(1)}s`)
  }

  // Persist beat data + computed offset
  await prisma.montageProject.update({
    where: { id: projectId },
    data: {
      audioDuration: beatInfo.duration,
      beatData: JSON.stringify({ ...beatInfo, audioOffset }),
    },
  })

  // ── Step 2: Scene detection + scoring ───────────────────────────────────
  await log('DETECTING_SCENES', 15, `Processing ${project.sourceVideos.length} video(s)…`)
  let allClips: ReturnType<typeof extractSceneClips> extends Promise<infer T> ? T : never = []

  for (let i = 0; i < project.sourceVideos.length; i++) {
    const sv = project.sourceVideos[i]
    if (!sv.localPath) continue
    const videoAbsPath = path.join(STORAGE_ROOT, sv.localPath)
    if (!fs.existsSync(videoAbsPath)) continue

    await log('DETECTING_SCENES', 15 + Math.round((i / project.sourceVideos.length) * 15), `Scene detection: ${path.basename(sv.localPath)}`)
    const clips = await extractSceneClips(sv.id, videoAbsPath)
    allClips = [...allClips, ...clips]
  }

  if (allClips.length === 0) throw new Error('No clips extracted from source videos')

  await log('SCORING_CLIPS', 30, `Scoring ${allClips.length} clips…`)
  const scoredClips = await scoreClips(allClips)

  // ── Step 3: Timeline composition ────────────────────────────────────────
  await log('COMPOSING_TIMELINE', 50, `Composing timeline (style: ${project.style})…`)
  const timeline = composeTimeline(
    scoredClips,
    beatInfo,
    project.style as ProjectStyle,
    project.durationMode as DurationMode,
    audioOffset,
  )
  await log('COMPOSING_TIMELINE', 55, `Timeline: ${timeline.length} clips, ${timeline.reduce((s, e) => s + e.outputDuration, 0).toFixed(1)}s`)

  // Save generated timeline clips to DB (delete previous run first)
  await prisma.montageClip.deleteMany({ where: { projectId } })
  await prisma.montageClip.createMany({
    data: timeline.map((entry, i) => ({
      id:             randomUUID(),
      projectId,
      sourceVideoId:  entry.clip.sourceVideoId,
      position:       i,
      clipStart:      entry.clip.start,
      clipEnd:        entry.clip.start + entry.clip.duration,
      outputStart:    entry.outputStart,
      outputDuration: entry.outputDuration,
      effects:        JSON.stringify(entry.effects),
      transition:     entry.transition ?? 'cut',
      scoreMotion:    entry.clip.score.motion,
      scoreBrightness:entry.clip.score.brightness,
      scoreSharpness: entry.clip.score.sharpness,
      scoreOverall:   entry.clip.score.overall,
    })),
  })

  // ── Step 4: Assembly ─────────────────────────────────────────────────────
  const outputDir      = path.join(STORAGE_ROOT, project.workspaceId, 'montage')
  fs.mkdirSync(outputDir, { recursive: true })
  const outputFilename = `${projectId}_output.mp4`
  const outputAbsPath  = path.join(outputDir, outputFilename)
  const outputRelPath  = path.join(project.workspaceId, 'montage', outputFilename)

  // Load subtitles from DB — supports both legacy array format and {segments, style} object
  let subtitles: SubtitleSegment[] | undefined
  let subtitleStyle: SubtitleStyle | undefined
  if (project.subtitleData) {
    const parsed: SubtitleSegment[] | { segments: SubtitleSegment[]; style?: SubtitleStyle } = JSON.parse(project.subtitleData)
    if (Array.isArray(parsed)) {
      subtitles = parsed
    } else {
      subtitles     = parsed.segments
      subtitleStyle = parsed.style
    }
  }

  await log('ASSEMBLING', 55, 'Assembling video with FFmpeg…')
  await assembleVideo({
    timeline,
    audioPath: audioAbsPath,
    outputPath: outputAbsPath,
    ratio:     project.ratio,
    style:     project.style,
    subtitles,
    subtitleStyle,
    audioOffset,
    onProgress: (pct) => {
      void log('ASSEMBLING', 55 + Math.round(pct * 0.44), `Encoding… ${pct}%`)
    },
  })

  // ── Update project with output path ─────────────────────────────────────
  await prisma.montageProject.update({
    where: { id: projectId },
    data: { outputPath: outputRelPath, status: 'COMPLETED' },
  })

  await log('COMPLETED', 100, `Done → ${outputRelPath}`)
  return outputRelPath
}

/** Generate the same project for a different aspect ratio (multi-format export) */
export async function runMontageEngineRatio(
  projectId: string,
  ratio: 'PORTRAIT' | 'SQUARE',
  log: LogFn,
): Promise<string> {
  const project = await prisma.montageProject.findUniqueOrThrow({
    where: { id: projectId },
    include: { clips: { orderBy: { position: 'asc' } }, sourceVideos: true },
  })

  if (!project.audioPath) throw new Error('No audio file')

  const audioAbsPath = path.join(STORAGE_ROOT, project.audioPath)
  const outputDir    = path.join(STORAGE_ROOT, project.workspaceId, 'montage')
  fs.mkdirSync(outputDir, { recursive: true })

  const suffix      = ratio === 'PORTRAIT' ? 'portrait' : 'square'
  const filename    = `${projectId}_output_${suffix}.mp4`
  const outputAbs   = path.join(outputDir, filename)
  const outputRel   = path.join(project.workspaceId, 'montage', filename)

  // Re-use existing clips (already scored) – rebuild TimelineEntry[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svMap = new Map(project.sourceVideos.map((sv: any) => [sv.id, sv]))

  // Build timeline from saved clips
  const beatInfo: { audioOffset?: number } | null = project.beatData ? JSON.parse(project.beatData) : null
  if (!beatInfo) throw new Error('No beat data saved – run primary generation first')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const timeline = project.clips.map((clip: any) => {
    const sv = svMap.get(clip.sourceVideoId) as { localPath?: string } | undefined
    const relPath = sv?.localPath ?? ''
    return {
      clip: {
        id:            clip.id,
        sourceVideoId: clip.sourceVideoId,
        videoPath:     path.join(STORAGE_ROOT, relPath),
        start:         clip.clipStart,
        end:           clip.clipEnd,
        duration:      clip.clipEnd - clip.clipStart,
        score: {
          motion:      clip.scoreMotion,
          brightness:  clip.scoreBrightness,
          sharpness:   clip.scoreSharpness,
          overall:     clip.scoreOverall,
          contrast:    0,
          energy:      0,
          faceScore:   0,
          textPenalty: 0,
        },
      },
      outputStart:    clip.outputStart,
      outputDuration: clip.outputDuration,
      effects:        JSON.parse(clip.effects),
      transition:     clip.transition as 'cut' | 'fade' | 'dip_to_black',
    }
  })

  const subtitles2: SubtitleSegment[] | undefined = project.subtitleData
    ? (() => {
        const p: SubtitleSegment[] | { segments: SubtitleSegment[]; style?: SubtitleStyle } = JSON.parse(project.subtitleData)
        return Array.isArray(p) ? p : p.segments
      })()
    : undefined
  const subtitleStyle2: SubtitleStyle | undefined = project.subtitleData && !Array.isArray(JSON.parse(project.subtitleData))
    ? (JSON.parse(project.subtitleData) as { segments: SubtitleSegment[]; style?: SubtitleStyle }).style
    : undefined

  await log('ASSEMBLING', 10, `Generating ${ratio} version…`)
  await assembleVideo({
    timeline,
    audioPath: audioAbsPath,
    outputPath: outputAbs,
    ratio,
    style:     project.style,
    subtitles: subtitles2,
    subtitleStyle: subtitleStyle2,
    audioOffset: beatInfo.audioOffset ?? 0,
    onProgress: pct => { void log('ASSEMBLING', 10 + Math.round(pct * 0.9), `${ratio} ${pct}%`) },
  })

  const field = ratio === 'PORTRAIT' ? 'outputPortraitPath' : 'outputSquarePath'
  await prisma.montageProject.update({
    where: { id: projectId },
    data: { [field]: outputRel },
  })

  await log('COMPLETED', 100, `Done → ${outputRel}`)
  return outputRel
}

