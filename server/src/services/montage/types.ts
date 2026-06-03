// Shared types for the Montage pipeline

export type ProjectStyle =
  | 'DARK_TRAP' | 'CLEAN_MINIMAL' | 'HYPER_POP' | 'FAST_CUTS'
  | 'SLOW_MOTION' | 'CINEMATIC' | 'AMBIENT' | 'LYRIC_VIDEO' | 'EQ_VISUALIZER'

export type DurationMode = 'AUTO' | 'SECONDS_15' | 'SECONDS_30' | 'SECONDS_60' | 'FULL_SONG'

export type SectionType = 'intro' | 'verse' | 'chorus' | 'drop' | 'bridge' | 'outro'

export interface ScoreDetails {
  overall: number
  motion: number
  brightness: number
  contrast: number
  sharpness: number
  energy: number
  faceScore: number
  /** [0,1] — 0 = clean frame, >0.5 = burned-in text/watermark or over-zoomed subject */
  textPenalty: number
  semanticScore?: number
}

export interface SceneClip {
  id: string
  sourceVideoId: string
  videoPath: string
  start: number
  end: number
  duration: number
  score: ScoreDetails
  /** FFmpeg crop filter string (e.g. "crop=1920:816:0:132") to remove black bars. Null = no crop needed. */
  cropFilter?: string | null
}

export interface AudioSection {
  type: SectionType
  start: number
  end: number
  energy: number
}

export interface BeatInfo {
  bpm: number
  beats: number[]
  drops: number[]
  transients: number[]
  bassHits: number[]    // sub-bass / kick peaks (30-150 Hz) → primary frame-change triggers
  sections: AudioSection[]
  duration: number
}

export type VideoEffect =
  | { type: 'zoom_in'; intensity: number }
  | { type: 'zoom_out'; intensity: number }
  | { type: 'shake'; intensity: number }
  | { type: 'flash'; duration: number }
  | { type: 'speed_ramp'; factor: number }
  | { type: 'speed_ramp_in'; fromFactor: number; toFactor: number }
  | { type: 'reverse' }
  | { type: 'slow_motion'; factor: number }
  | { type: 'color_boost'; saturation: number; contrast: number }
  | { type: 'dip_to_black'; duration: number }
  | { type: 'none' }

export type TransitionType = 'cut' | 'fade' | 'dip_to_black'

export interface SubtitleSegment {
  start: number
  end: number
  text: string
}

/**
 * Visual style settings for subtitle burn-in.
 * Saved alongside segments so re-renders reproduce the user's preview.
 */
export interface SubtitleStyle {
  color: string          // hex e.g. '#FFFFFF'
  bgColor: string        // hex e.g. '#000000'
  bgOpacity: number      // 0–100 (0 = transparent)
  position: 'TOP' | 'CENTER' | 'BOTTOM' | 'CUSTOM'
  customX?: number       // % 0–100, only when position = 'CUSTOM'
  customY?: number       // % 0–100
  fontSize: number       // relative % 40–220 (100 = normal)
  effect?: string        // 'SHADOW' | 'OUTLINE' | 'GLOW' | 'NEON' | 'NONE' etc.
  effectColor?: string   // accent hex for shadow/outline/glow/neon
}

export interface TimelineEntry {
  clip: SceneClip
  outputStart: number
  outputDuration: number
  effects: VideoEffect[]
  transition: TransitionType
}
