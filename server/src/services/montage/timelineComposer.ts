import {
  BeatInfo, SceneClip, TimelineEntry, VideoEffect, TransitionType,
  ProjectStyle, DurationMode, SectionType, AudioSection,
} from './types'

export { resolveTargetDuration }

interface StyleConfig {
  beatsPerCut: Record<SectionType, number>
  motionWeight: number
  brightnessWeight: number
  sharpnessWeight: number
  faceWeight: number
  preferredEffects: (beat: number, section: SectionType) => VideoEffect
  transition: TransitionType
  /**
   * Minimum clip duration (seconds) for this style.
   * Applied as the floor for all cuts; prevents machine-gun cuts on rapid beats.
   * High-energy sections (drop/chorus) use this value directly.
   * Other sections get minCutDuration × 1.4 for breathing room.
   */
  minCutDuration: number
}

const NO_FLASH_CUTS = new Set(['AMBIENT', 'SLOW_MOTION', 'CINEMATIC', 'CLEAN_MINIMAL', 'LYRIC_VIDEO', 'EQ_VISUALIZER'])

const STYLE_CONFIGS: Record<ProjectStyle, StyleConfig> = {
  DARK_TRAP: {
    beatsPerCut: { intro: 4, verse: 2, chorus: 1, drop: 0.5, bridge: 2, outro: 4 },
    motionWeight: 0.3, brightnessWeight: 0.15, sharpnessWeight: 0.25, faceWeight: 0.3,
    transition: 'cut',
    minCutDuration: 0.33,  // fast trap cuts but each frame must register
    preferredEffects: (_b, s) => s === 'drop' ? { type: 'speed_ramp', factor: 0.25 } : s === 'chorus' ? { type: 'zoom_in', intensity: 0.05 } : { type: 'none' },
  },
  CLEAN_MINIMAL: {
    beatsPerCut: { intro: 8, verse: 4, chorus: 4, drop: 2, bridge: 4, outro: 8 },
    motionWeight: 0.15, brightnessWeight: 0.3, sharpnessWeight: 0.15, faceWeight: 0.4,
    transition: 'fade',
    minCutDuration: 0.70,
    preferredEffects: () => ({ type: 'none' }),
  },
  HYPER_POP: {
    beatsPerCut: { intro: 2, verse: 1, chorus: 0.5, drop: 0.5, bridge: 1, outro: 2 },
    motionWeight: 0.4, brightnessWeight: 0.15, sharpnessWeight: 0.1, faceWeight: 0.35,
    transition: 'cut',
    minCutDuration: 0.22,  // intentionally very fast, but still one full frame
    preferredEffects: (_b, s) => s === 'drop' ? { type: 'flash', duration: 0.05 } : s === 'chorus' ? { type: 'color_boost', saturation: 1.8, contrast: 1.2 } : { type: 'zoom_in', intensity: 0.03 },
  },
  FAST_CUTS: {
    beatsPerCut: { intro: 2, verse: 0.5, chorus: 0.5, drop: 0.25, bridge: 0.5, outro: 2 },
    motionWeight: 0.4, brightnessWeight: 0.1, sharpnessWeight: 0.2, faceWeight: 0.3,
    transition: 'cut',
    minCutDuration: 0.20,  // maximum speed; below this cuts are invisible
    preferredEffects: () => ({ type: 'none' }),
  },
  SLOW_MOTION: {
    beatsPerCut: { intro: 8, verse: 8, chorus: 4, drop: 4, bridge: 8, outro: 8 },
    motionWeight: 0.2, brightnessWeight: 0.25, sharpnessWeight: 0.15, faceWeight: 0.4,
    transition: 'fade',
    minCutDuration: 1.20,
    preferredEffects: (_b, s) => s === 'chorus' ? { type: 'slow_motion', factor: 0.5 } : { type: 'slow_motion', factor: 0.75 },
  },
  CINEMATIC: {
    beatsPerCut: { intro: 8, verse: 4, chorus: 2, drop: 2, bridge: 4, outro: 8 },
    motionWeight: 0.15, brightnessWeight: 0.25, sharpnessWeight: 0.25, faceWeight: 0.35,
    transition: 'fade',
    minCutDuration: 0.55,
    preferredEffects: (_b, s) => s === 'chorus' ? { type: 'zoom_in', intensity: 0.04 } : s === 'drop' ? { type: 'dip_to_black', duration: 0.1 } : { type: 'none' },
  },
  AMBIENT: {
    beatsPerCut: { intro: 16, verse: 8, chorus: 4, drop: 4, bridge: 8, outro: 16 },
    motionWeight: 0.05, brightnessWeight: 0.4, sharpnessWeight: 0.35, faceWeight: 0,
    transition: 'fade',
    minCutDuration: 1.50,
    preferredEffects: () => ({ type: 'zoom_in', intensity: 0.008 }),
  },
  LYRIC_VIDEO: {
    beatsPerCut: { intro: 8, verse: 8, chorus: 8, drop: 8, bridge: 8, outro: 8 },
    motionWeight: 0.1, brightnessWeight: 0.3, sharpnessWeight: 0.3, faceWeight: 0,
    transition: 'fade',
    minCutDuration: 1.00,
    preferredEffects: () => ({ type: 'none' }),
  },
  EQ_VISUALIZER: {
    beatsPerCut: { intro: 8, verse: 8, chorus: 8, drop: 8, bridge: 8, outro: 8 },
    motionWeight: 0.1, brightnessWeight: 0.3, sharpnessWeight: 0.3, faceWeight: 0,
    transition: 'cut',
    minCutDuration: 0.80,
    preferredEffects: () => ({ type: 'none' }),
  },
}

function resolveTargetDuration(mode: DurationMode, audioDuration: number): number {
  // Never request more video than there is audio — prevents the last N seconds
  // of a montage being blank/frozen when the audio is shorter than the chosen preset.
  switch (mode) {
    case 'SECONDS_15': return Math.min(15, audioDuration)
    case 'SECONDS_30': return Math.min(30, audioDuration)
    case 'SECONDS_60': return Math.min(60, audioDuration)
    case 'FULL_SONG': return audioDuration
    default:
      if (audioDuration <= 20) return audioDuration
      if (audioDuration <= 45) return Math.min(30, audioDuration)
      if (audioDuration <= 75) return Math.min(60, audioDuration)
      return Math.min(audioDuration, 90)
  }
}

export function composeTimeline(
  clips: SceneClip[],
  beatInfo: BeatInfo,
  style: ProjectStyle,
  durationMode: DurationMode,
  audioOffset = 0,
): TimelineEntry[] {
  if (clips.length === 0) return []

  const sc = STYLE_CONFIGS[style]
  // Shift beat/section times to be 0-based relative to audioOffset
  const bi = audioOffset > 0 ? shiftBeatInfo(beatInfo, audioOffset) : beatInfo
  const targetDuration = resolveTargetDuration(durationMode, bi.duration)
  const cutPoints = buildCutPoints(bi, sc, targetDuration, style)

  const filtered = clips.filter(
    (c) => c.score.sharpness >= 0.12
         && c.score.brightness >= 0.05
         && c.score.brightness <= 0.95
         && (c.score.textPenalty ?? 0) < 0.70,  // pre-filter frames dominated by text or over-zoom
  )
  const usable = filtered.length >= Math.min(3, clips.length) ? filtered : clips
  const ranked = rankClips(usable, sc)
  // Cap at 3 reuses per clip — beyond that scenes look like a loop even to casual viewers.
  // The +1 was removed because it let a 5-clip pool each repeat 11 times (50 cuts / 5 clips + 1).
  const maxUses = Math.min(3, Math.max(1, Math.ceil(cutPoints.length / Math.max(ranked.length, 1))))

  const recentSourceIds: string[] = []
  // Track the last 12 clip IDs directly — prevents the same clip appearing within
  // 12 cuts of its previous use, regardless of source video or start-time proximity.
  const recentClipIds: string[] = []
  let lastClipId = ''
  let lastBrightness = 0.5
  const usedCounts = new Map<string, number>()
  let poolIndex = 0
  const timeline: TimelineEntry[] = []

  // Section-based source grouping: stay on the same source video within an audio
  // section (verse, chorus, etc.) and only switch source at section boundaries.
  // This prevents rapid interleaving of visually incompatible source videos.
  const uniqueSources = [...new Set(ranked.map(c => c.sourceVideoId))]
  let sectionSourceId: string | null = uniqueSources[0] ?? null
  let lastSectionType: string = ''
  let sectionSourceIndex = 0 // cycles through sources across sections

  for (let i = 0; i < cutPoints.length - 1; i++) {
    const outputStart = cutPoints[i]
    const outputDuration = Math.min(cutPoints[i + 1], targetDuration) - outputStart
    // Skip segments shorter than 100ms — they create invisible flicker, not energy.
    if (outputDuration < 0.1 || outputStart >= targetDuration) break

    const sectionInfo = getSectionAt(bi.sections, outputStart)

    // Rotate preferred source at every section boundary (intro→verse, verse→chorus…)
    if (sectionInfo.type !== lastSectionType) {
      lastSectionType = sectionInfo.type
      // For drops/choruses: rotate to the next source to show variety on the highlight
      // For outros: stay on last source for continuity
      if (sectionInfo.type !== 'outro' && uniqueSources.length > 1) {
        sectionSourceIndex = (sectionSourceIndex + 1) % uniqueSources.length
        sectionSourceId = uniqueSources[sectionSourceIndex]
      }
    }

    const clip = pickClip(
      ranked, recentSourceIds, recentClipIds, lastClipId, usedCounts,
      maxUses, outputDuration, poolIndex,
      sectionInfo.energy, sectionInfo.type, lastBrightness,
      sectionSourceId,
    )
    if (!clip) break

    // Update the section preferred source to match the actually-picked clip
    sectionSourceId = clip.sourceVideoId

    lastClipId = clip.id
    lastBrightness = clip.score.brightness
    recentSourceIds.push(clip.sourceVideoId)
    if (recentSourceIds.length > 6) recentSourceIds.shift()
    recentClipIds.push(clip.id)
    if (recentClipIds.length > 12) recentClipIds.shift()
    usedCounts.set(clip.id, (usedCounts.get(clip.id) ?? 0) + 1)
    poolIndex = (poolIndex + 1) % ranked.length

    timeline.push({ clip, outputStart, outputDuration, effects: [sc.preferredEffects(outputStart, sectionInfo.type)], transition: sc.transition })
  }
  return timeline
}

function buildCutPoints(beatInfo: BeatInfo, sc: StyleConfig, targetDuration: number, style: string): number[] {
  const points = new Set<number>([0])

  for (const section of beatInfo.sections) {
    if (section.start >= targetDuration) break
    const sectionEnd = Math.min(section.end, targetDuration)
    const bpc = sc.beatsPerCut[section.type] ?? 2
    const sectionBeats = beatInfo.beats.filter((b) => b >= section.start && b < sectionEnd)
    const step = Math.max(1, Math.round(bpc))
    for (let i = 0; i < sectionBeats.length; i += step) points.add(sectionBeats[i])
  }

  // Bass hits = primary frame-change triggers — with per-style cooldown to prevent
  // machine-gun cuts when the sub-bass is dense (e.g. every 8th note at 150 BPM).
  let lastBassHit = -Infinity
  for (const bassHit of (beatInfo.bassHits ?? [])) {
    if (bassHit < targetDuration && bassHit - lastBassHit >= sc.minCutDuration) {
      points.add(Math.round(bassHit * 1000) / 1000)
      lastBassHit = bassHit
    }
  }

  for (const drop of beatInfo.drops) {
    if (drop < targetDuration) points.add(drop)
  }

  if (!NO_FLASH_CUTS.has(style)) {
    for (const section of beatInfo.sections) {
      if (section.type !== 'drop' && section.type !== 'chorus') continue
      if (section.start >= targetDuration) break
      const sectionEnd = Math.min(section.end, targetDuration)
      const step = section.type === 'drop' ? 1 : 2
      const sectionTransients = beatInfo.transients.filter((t) => t >= section.start && t < sectionEnd)
      for (let i = 0; i < sectionTransients.length; i += step) points.add(Math.round(sectionTransients[i] * 1000) / 1000)
    }
  }

  const sorted0 = Array.from(points).sort((a, b) => a - b)
  const maxCovered = sorted0[sorted0.length - 1] ?? 0
  if (maxCovered < targetDuration - 0.5 && beatInfo.bpm > 0) {
    const beatInterval = (60 / beatInfo.bpm) * 2
    for (let t = maxCovered + beatInterval; t < targetDuration; t += beatInterval) points.add(Math.round(t * 1000) / 1000)
  }

  const sorted = Array.from(points).sort((a, b) => a - b)
  const filtered: number[] = []
  let last = -Infinity
  for (const p of sorted) {
    const section = beatInfo.sections.find((s) => p >= s.start && p < s.end)
    // High-energy sections: allow cuts as fast as the style minimum.
    // All other sections: add a 40 % breathing buffer so each clip is perceptible.
    const isHighEnergy = section?.type === 'drop' || section?.type === 'chorus'
    const minGap = isHighEnergy ? sc.minCutDuration : sc.minCutDuration * 1.4
    if (p - last >= minGap) { filtered.push(p); last = p }
  }
  filtered.push(targetDuration)
  return filtered
}

function rankClips(clips: SceneClip[], sc: StyleConfig): SceneClip[] {
  return [...clips].sort((a, b) => {
    const score = (c: SceneClip) => c.score.motion * sc.motionWeight + c.score.brightness * sc.brightnessWeight + c.score.sharpness * sc.sharpnessWeight + c.score.faceScore * sc.faceWeight
    // Deterministic sort — jitter caused different clip pools every render, making
    // the montage look chaotic and unpredictable on repeated generation.
    return score(b) - score(a)
  })
}

function getSectionAt(sections: AudioSection[], time: number): AudioSection {
  return sections.find((s) => time >= s.start && time < s.end) ?? { type: 'verse', start: 0, end: Infinity, energy: 0.5 }
}

function pickClip(
  ranked: SceneClip[],
  recentSourceIds: string[],
  recentClipIds: string[],
  lastClipId: string,
  usedCounts: Map<string, number>,
  maxUses: number,
  requiredDuration: number,
  preferredIndex: number,
  sectionEnergy: number,
  section: SectionType,
  lastBrightness: number,
  preferredSourceId: string | null = null,
): SceneClip | null {
  const uniqueSourceCount = new Set(ranked.map((c) => c.sourceVideoId)).size
  // Wider window — avoids the same source appearing in back-to-back cuts,
  // which makes the montage look like a single repeated clip loop.
  const windowSize = Math.min(6, uniqueSourceCount)

  // Direct clip-ID recency check — more reliable than temporal proximity.
  const isRecentClip = (c: SceneClip) => recentClipIds.includes(c.id)
  // Tighter brightness-jump guard so jarring light→dark / dark→light switches
  // don't visually break the flow between consecutive clips.
  const isChromaBroken = (c: SceneClip) =>
    section !== 'drop' && Math.abs(c.score.brightness - lastBrightness) > 0.30

  let candidates: SceneClip[]
  if (section === 'chorus') candidates = [...ranked].sort((a, b) => b.score.faceScore - a.score.faceScore)
  else if (section === 'drop' || sectionEnergy >= 0.75) candidates = [...ranked].sort((a, b) => b.score.motion - a.score.motion)
  else if (section === 'intro' || section === 'outro') candidates = [...ranked].sort((a, b) => a.score.motion - b.score.motion)
  else candidates = ranked

  // 3 passes:
  //   pass 0 — preferred source, all quality filters
  //   pass 1 — any source, all quality filters (including brightness + text guards)
  //   pass 2 — any source, relax brightness guard and soften text threshold
  for (let pass = 0; pass < 3; pass++) {
    for (let offset = 0; offset < candidates.length; offset++) {
      const clip = candidates[(preferredIndex + offset) % candidates.length]
      const sourceOk = pass === 0
        ? (preferredSourceId === null || clip.sourceVideoId === preferredSourceId)
        : !recentSourceIds.slice(-windowSize).includes(clip.sourceVideoId)
      // passes 0-1: reject frames with heavy text overlays or over-zoom (textPenalty ≥ 0.55)
      // pass 2 (last resort): only reject extreme cases (≥ 0.80)
      const textOk = (clip.score.textPenalty ?? 0) < (pass < 2 ? 0.55 : 0.80)
      if (
        clip.id !== lastClipId &&
        sourceOk &&
        !isRecentClip(clip) &&
        textOk &&
        (pass >= 2 || !isChromaBroken(clip)) &&
        (usedCounts.get(clip.id) ?? 0) < maxUses &&
        clip.duration >= requiredDuration * 0.5
      ) return clip
    }
  }
  return ranked[preferredIndex % ranked.length] ?? null
}

/**
 * Shift all beat/section timestamps by -offset so they are 0-based
 * relative to the chosen audio start position.
 */
function shiftBeatInfo(bi: BeatInfo, offset: number): BeatInfo {
  const newDur = bi.duration - offset
  return {
    bpm:       bi.bpm,
    duration:  newDur,
    beats:     bi.beats.filter(b => b >= offset).map(b => b - offset),
    drops:     bi.drops.filter(d => d >= offset).map(d => d - offset),
    transients:bi.transients.filter(t => t >= offset).map(t => t - offset),
    bassHits:  (bi.bassHits ?? []).filter(b => b >= offset).map(b => b - offset),
    sections:  bi.sections
      .filter(s => s.end > offset)
      .map(s => ({
        ...s,
        start: Math.max(0, s.start - offset),
        end:   s.end - offset,
      })),
  }
}
