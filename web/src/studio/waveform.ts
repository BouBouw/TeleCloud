/* ─── Waveform + ruler rendering (viewport-virtualized) ───────────────
 * Canvases are sized to the visible viewport (not the whole timeline), so
 * zooming a long track never blows past the browser's ~32k px canvas
 * limit. Waveforms are drawn against the *recompacted* timeline: cut
 * regions simply don't exist, so a ripple cut visibly shortens the clip.
 */
import type { CutRegion } from './types'
import { buildSegments } from './segments'
import { encodeWAV } from './wav'

export { encodeWAV }

/**
 * Draw one track's waveform for the currently visible window.
 * @param offsetSec  clip start on the timeline
 * @param scrollLeft horizontal scroll of the timeline container (px)
 * @param viewW      visible width (px)
 */
export function drawWaveViewport(
  canvas: HTMLCanvasElement,
  buffer: AudioBuffer,
  cuts: CutRegion[],
  offsetSec: number,
  color: string,
  scrollLeft: number,
  pxPerSec: number,
  viewW: number,
  height: number,
) {
  const dpr = window.devicePixelRatio || 1
  canvas.width = Math.max(1, Math.round(viewW * dpr))
  canvas.height = Math.max(1, Math.round(height * dpr))
  const ctx = canvas.getContext('2d')!
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, viewW, height)

  const data = buffer.getChannelData(0)
  const srcSR = data.length / buffer.duration
  const segs = buildSegments(buffer.duration, cuts)
  if (segs.length === 0) return
  const effDur = segs[segs.length - 1].timelineStart + (segs[segs.length - 1].srcEnd - segs[segs.length - 1].srcStart)

  const mid = Math.floor(height / 2)
  ctx.fillStyle = color
  let segIdx = 0
  const colStep = 1 / pxPerSec // timeline seconds per screen pixel

  for (let x = 0; x < viewW; x++) {
    const tl = (scrollLeft + x) / pxPerSec - offsetSec
    if (tl < 0 || tl >= effDur) continue
    // advance to the segment containing tl
    while (segIdx < segs.length - 1 && tl >= segs[segIdx + 1].timelineStart) segIdx++
    while (segIdx > 0 && tl < segs[segIdx].timelineStart) segIdx--
    const seg = segs[segIdx]
    const segLen = seg.srcEnd - seg.srcStart
    const into = tl - seg.timelineStart
    const src0 = seg.srcStart + into
    const src1 = Math.min(seg.srcEnd, seg.srcStart + Math.min(segLen, into + colStep))
    const s0 = Math.floor(src0 * srcSR)
    const s1 = Math.max(s0 + 1, Math.floor(src1 * srcSR))
    let lo = 1, hi = -1
    for (let j = s0; j < s1 && j < data.length; j++) { const v = data[j]; if (v < lo) lo = v; if (v > hi) hi = v }
    if (hi < lo) continue
    const yTop = ((1 - hi) / 2) * height
    const barH = Math.max(1, ((hi - lo) / 2) * height)
    ctx.fillRect(x, yTop, 1, barH)
  }
  // center line
  ctx.fillStyle = 'rgba(255,255,255,0.06)'
  ctx.fillRect(0, mid, viewW, 1)
}

const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

/** Draw the ruler for the visible window. */
export function drawRulerViewport(
  canvas: HTMLCanvasElement,
  scrollLeft: number,
  pxPerSec: number,
  viewW: number,
  height: number,
) {
  const dpr = window.devicePixelRatio || 1
  canvas.width = Math.max(1, Math.round(viewW * dpr))
  canvas.height = Math.max(1, Math.round(height * dpr))
  const ctx = canvas.getContext('2d')!
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.fillStyle = '#1a1a1a'; ctx.fillRect(0, 0, viewW, height)

  const every = pxPerSec < 20 ? 60 : pxPerSec < 50 ? 30 : pxPerSec < 120 ? 10 : pxPerSec < 300 ? 5 : 1
  const startSec = scrollLeft / pxPerSec
  const endSec = (scrollLeft + viewW) / pxPerSec
  ctx.font = '9px monospace'
  const first = Math.floor(startSec / every) * every
  for (let t = first; t <= endSec; t += every) {
    const x = Math.round(t * pxPerSec - scrollLeft)
    ctx.fillStyle = '#333'; ctx.fillRect(x, 0, 1, height)
    ctx.fillStyle = '#777'; ctx.fillText(fmtTime(t), x + 2, height - 3)
  }
  const fine = every / 4
  if (fine >= 1) {
    const f0 = Math.floor(startSec / fine) * fine
    for (let t = f0; t <= endSec; t += fine) {
      const x = Math.round(t * pxPerSec - scrollLeft)
      ctx.fillStyle = '#252525'; ctx.fillRect(x, Math.floor(height * 0.6), 1, Math.floor(height * 0.4))
    }
  }
}

export { fmtTime }
