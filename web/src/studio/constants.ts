/* ─── Studio constants & effect/EQ param shapes ─────────────────────── */

export interface EQBand { label: string; freq: number; gain: number }

export interface EffectParams {
  reverb:     { enabled: boolean; wet: number; decay: number }
  delay:      { enabled: boolean; time: number; feedback: number; wet: number }
  compressor: { enabled: boolean; threshold: number; ratio: number; attack: number; release: number }
  distortion: { enabled: boolean; amount: number; wet: number }
  chorus:     { enabled: boolean; rate: number; depth: number; wet: number }
}

export const DEFAULT_EQ: EQBand[] = [
  { label: 'Sub',     freq: 60,    gain: 0 },
  { label: 'Bass',    freq: 200,   gain: 0 },
  { label: 'Low-Mid', freq: 800,   gain: 0 },
  { label: 'Mid',     freq: 2500,  gain: 0 },
  { label: 'Hi-Mid',  freq: 6000,  gain: 0 },
  { label: 'Air',     freq: 14000, gain: 0 },
]

export const EQ_PRESETS: Record<string, number[]> = {
  'Manual':     [0, 0, 0, 0, 0, 0],
  'Bass Boost': [6, 4, 0, -1, -1, 0],
  'Vocal':      [-3, -2, 1, 4, 3, -1],
  'Hip-Hop':    [5, 4, -1, -2, 0, 1],
  'Pop':        [-2, -1, 3, 3, 1, -2],
  'Rock':       [4, 2, -1, 2, 3, 1],
}

export const DEFAULT_FX: EffectParams = {
  reverb:     { enabled: false, wet: 0.4,  decay: 2.5 },
  delay:      { enabled: false, time: 0.35, feedback: 0.4, wet: 0.4 },
  compressor: { enabled: false, threshold: -24, ratio: 4, attack: 3, release: 250 },
  distortion: { enabled: false, amount: 50, wet: 0.6 },
  chorus:     { enabled: false, rate: 1.5,  depth: 0.3, wet: 0.4 },
}

export const EXTRA_COLORS = ['#e67e22', '#e91e63', '#00bcd4', '#8bc34a', '#ff5722', '#673ab7']

export const STEM_META: Record<string, { name: string; color: string }> = {
  instrumental: { name: 'Musique', color: '#2eb872' },
  vocals:       { name: 'Voix',    color: '#9b59e2' },
}

export const MAIN_COLOR = '#4f8ef7'

/** Base pixels-per-second at zoom 1. */
export const BASE_PX_PER_SEC = 80
export const TRACK_HEIGHT = 80
export const RULER_HEIGHT = 28
