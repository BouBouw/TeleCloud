/* ─── Ripple segment math ─────────────────────────────────────────────
 * Pure, side-effect-free helpers that turn a track's cut regions into the
 * list of kept slices ("segments"), recompacted so removed audio truly
 * disappears from both playback and the waveform (ripple delete).
 *
 * All times are in seconds. `cuts` are in SOURCE time; segments carry both
 * their source range and their recompacted timeline position.
 */
import type { CutRegion, Segment } from './types'

const EPS = 1e-6

/** Sort, clamp to [0,duration] and merge overlapping/touching cut regions. */
export function normalizeCuts(cuts: CutRegion[], duration: number): CutRegion[] {
  const clamped = cuts
    .map(c => ({ start: Math.max(0, Math.min(duration, c.start)), end: Math.max(0, Math.min(duration, c.end)) }))
    .filter(c => c.end - c.start > EPS)
    .sort((a, b) => a.start - b.start)

  const merged: CutRegion[] = []
  for (const c of clamped) {
    const last = merged[merged.length - 1]
    if (last && c.start <= last.end + EPS) {
      last.end = Math.max(last.end, c.end)
    } else {
      merged.push({ ...c })
    }
  }
  return merged
}

/** Add one cut region to an existing set and re-normalize. */
export function addCut(cuts: CutRegion[], region: CutRegion, duration: number): CutRegion[] {
  return normalizeCuts([...cuts, region], duration)
}

/** Total removed length. */
export function totalCutLength(cuts: CutRegion[]): number {
  return cuts.reduce((sum, c) => sum + Math.max(0, c.end - c.start), 0)
}

/** Duration of the track once cuts are ripple-removed. */
export function effectiveDuration(duration: number, cuts: CutRegion[]): number {
  return Math.max(0, duration - totalCutLength(normalizeCuts(cuts, duration)))
}

/**
 * Build the kept slices of [0,duration] after removing `cuts`, recompacted
 * so each segment's timelineStart is the sum of kept lengths before it.
 */
export function buildSegments(duration: number, cuts: CutRegion[]): Segment[] {
  const norm = normalizeCuts(cuts, duration)
  const segments: Segment[] = []
  let cursor = 0        // current position in source time
  let timeline = 0      // accumulated kept length

  for (const cut of norm) {
    if (cut.start - cursor > EPS) {
      const len = cut.start - cursor
      segments.push({ srcStart: cursor, srcEnd: cut.start, timelineStart: timeline })
      timeline += len
    }
    cursor = Math.max(cursor, cut.end)
  }
  if (duration - cursor > EPS) {
    segments.push({ srcStart: cursor, srcEnd: duration, timelineStart: timeline })
  }
  return segments
}

/**
 * Map a SOURCE time to its position on the recompacted track timeline.
 * Times inside a cut collapse onto that cut's left boundary.
 */
export function sourceToTimeline(src: number, cuts: CutRegion[]): number {
  let removed = 0
  for (const cut of normalizeCuts(cuts, Number.MAX_SAFE_INTEGER)) {
    if (src <= cut.start) break
    if (src >= cut.end) {
      removed += cut.end - cut.start
    } else {
      // inside the cut -> collapse to its start
      removed += src - cut.start
      break
    }
  }
  return src - removed
}

/** Map a recompacted timeline time back to SOURCE time. */
export function timelineToSource(timeline: number, cuts: CutRegion[]): number {
  let src = timeline
  for (const cut of normalizeCuts(cuts, Number.MAX_SAFE_INTEGER)) {
    if (cut.start >= src + EPS) break
    src += cut.end - cut.start
  }
  return src
}
