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
/**
 * Per-buffer normalization gain, cached. Scales the waveform so the loudest
 * peak fills most of the track height — a quiet take still draws a full
 * waveform instead of a flat line ("adapts to the sound").
 */
const peakCache = new WeakMap<AudioBuffer, number>()
function normGain(buffer: AudioBuffer): number {
  let peak = peakCache.get(buffer)
  if (peak === undefined) {
    peak = 0
    const d = buffer.getChannelData(0)
    const stride = Math.max(1, Math.floor(d.length / 120000)) // sample for speed on long files
    for (let i = 0; i < d.length; i += stride) { const v = d[i] < 0 ? -d[i] : d[i]; if (v > peak) peak = v }
    peakCache.set(buffer, peak)
  }
  return peak > 1e-4 ? 0.94 / peak : 1
}

/** Mild perceptual lift so quiet passages stay visible while keeping dynamics. */
const shape = (v: number) => {
  const s = v < 0 ? -1 : 1
  const m = Math.min(1, Math.abs(v))
  return s * Math.pow(m, 0.7)
}

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
  // size the bitmap to the viewport AND pin the CSS box to the same logical
  // size, so the canvas is never stretched across the (much wider) timeline.
  canvas.width = Math.max(1, Math.round(viewW * dpr))
  canvas.height = Math.max(1, Math.round(height * dpr))
  canvas.style.width = `${viewW}px`
  canvas.style.height = `${height}px`
  const ctx = canvas.getContext('2d')!
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, viewW, height)

  const data = buffer.getChannelData(0)
  const srcSR = buffer.sampleRate
  const segs = buildSegments(buffer.duration, cuts)
  if (segs.length === 0) return
  const last = segs[segs.length - 1]
  const effDur = last.timelineStart + (last.srcEnd - last.srcStart)

  const gain = normGain(buffer)
  const mid = height / 2
  const colStep = 1 / pxPerSec // timeline seconds per screen pixel

  // center line first (waveform drawn on top)
  ctx.fillStyle = 'rgba(255,255,255,0.05)'
  ctx.fillRect(0, Math.round(mid), viewW, 1)

  ctx.fillStyle = color
  let segIdx = 0
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
    const s0 = Math.max(0, Math.floor(src0 * srcSR))
    const s1 = Math.min(data.length, Math.max(s0 + 1, Math.floor(src1 * srcSR)))
    let lo = 0, hi = 0
    for (let j = s0; j < s1; j++) { const v = data[j]; if (v < lo) lo = v; else if (v > hi) hi = v }
    // normalize + perceptual shape, then map amplitude (−1..1) to the row
    const top = shape(hi * gain)   // ≥ 0
    const bot = shape(lo * gain)   // ≤ 0
    const yTop = mid - top * mid
    const barH = Math.max(1, (top - bot) * mid)
    ctx.fillRect(x, yTop, 1, barH)
  }
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
  canvas.style.width = `${viewW}px`
  canvas.style.height = `${height}px`
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
