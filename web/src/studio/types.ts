/* ─── Studio domain types ────────────────────────────────────────────
 * Unified track model for the Web-Audio studio engine.
 * There is no longer a hard split between "main", "stem" and "extra" on
 * the audio side — every track is scheduled through the same graph. The
 * `kind` field only carries provenance (for the UI / stem separation).
 */

export type TrackKind = 'main' | 'stem' | 'extra'
export type StemKind = 'vocals' | 'instrumental'

/** A region of a track that has been cut out, expressed in SOURCE time (s). */
export interface CutRegion {
  start: number
  end: number
}

/** A kept slice of a track after ripple-removing its cuts. */
export interface Segment {
  /** Start in the source buffer (s). */
  srcStart: number
  /** End in the source buffer (s). */
  srcEnd: number
  /** Start on the track-local timeline after ripple recompaction (s). */
  timelineStart: number
}

/**
 * A time selection inside a track, expressed in RECOMPACTED timeline-local
 * seconds (i.e. what the user sees on the shortened waveform). Converted to
 * source time only when a cut is applied.
 */
export interface Selection {
  start: number
  end: number
}

export interface Track {
  id: string
  name: string
  color: string
  kind: TrackKind
  /** Which stem this is, when kind === 'stem'. */
  stem?: StemKind
  /** Library track id this was loaded from, if any. */
  trackId?: string
  /** Decoded audio. Null until decoding finishes. */
  buffer: AudioBuffer | null
  /** Object URL for temporary file-based tracks, to revoke on removal. */
  objectUrl?: string
  /** Position of the clip on the global timeline (s). */
  offset: number
  /** Linear gain, 0..1.2. */
  gain: number
  /** Stereo pan, -1 (L) .. 1 (R). */
  pan: number
  muted: boolean
  solo: boolean
  /** Cut regions in SOURCE time, kept sorted & normalized. */
  cuts: CutRegion[]
  /** Active selection in SOURCE time, or null. */
  selection: Selection | null
}

export type Tool = 'select' | 'move'
