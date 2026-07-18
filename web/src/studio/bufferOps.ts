/* ─── Destructive, length-preserving buffer operations ────────────────
 * Pure(ish) helpers that produce a NEW AudioBuffer with an edit applied
 * over a SOURCE-time range. Because every op preserves the buffer length,
 * a track's existing ripple `cuts` (which reference source samples) stay
 * valid after the edit — we only ever swap the buffer, never resize it.
 */

export type BufferOp = 'silence' | 'fadeIn' | 'fadeOut' | 'reverse' | 'normalize' | 'gain'

/** Deep-clone an AudioBuffer onto the given context. */
export function cloneBuffer(ctx: BaseAudioContext, buf: AudioBuffer): AudioBuffer {
  const out = ctx.createBuffer(buf.numberOfChannels, buf.length, buf.sampleRate)
  for (let c = 0; c < buf.numberOfChannels; c++) out.copyToChannel(buf.getChannelData(c).slice(), c)
  return out
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/**
 * Apply a length-preserving edit over the source range [srcStart, srcEnd] (s)
 * and return a fresh buffer. `amount` is used by 'gain' (linear factor).
 * Normalize scans a single peak across all channels so the stereo image is
 * preserved; every other op is applied channel-independently.
 */
export function applyBufferOp(
  ctx: BaseAudioContext,
  buf: AudioBuffer,
  op: BufferOp,
  srcStart: number,
  srcEnd: number,
  amount = 1,
): AudioBuffer {
  const out = cloneBuffer(ctx, buf)
  const sr = buf.sampleRate
  const s0 = clamp(Math.floor(srcStart * sr), 0, buf.length)
  const s1 = clamp(Math.ceil(srcEnd * sr), 0, buf.length)
  const n = s1 - s0
  if (n <= 0) return out

  if (op === 'normalize') {
    let peak = 0
    for (let c = 0; c < out.numberOfChannels; c++) {
      const d = out.getChannelData(c)
      for (let i = s0; i < s1; i++) { const v = Math.abs(d[i]); if (v > peak) peak = v }
    }
    if (peak > 1e-6) {
      const g = 0.99 / peak
      for (let c = 0; c < out.numberOfChannels; c++) {
        const d = out.getChannelData(c)
        for (let i = s0; i < s1; i++) d[i] *= g
      }
    }
    return out
  }

  for (let c = 0; c < out.numberOfChannels; c++) {
    const d = out.getChannelData(c)
    switch (op) {
      case 'silence':
        for (let i = s0; i < s1; i++) d[i] = 0
        break
      case 'gain':
        for (let i = s0; i < s1; i++) d[i] = clamp(d[i] * amount, -1, 1)
        break
      case 'fadeIn':
        // equal-power fade for a smoother, more natural ramp
        for (let i = s0; i < s1; i++) d[i] *= Math.sin((Math.PI / 2) * ((i - s0) / n))
        break
      case 'fadeOut':
        for (let i = s0; i < s1; i++) d[i] *= Math.cos((Math.PI / 2) * ((i - s0) / n))
        break
      case 'reverse':
        for (let i = 0; i < (n >> 1); i++) {
          const a = s0 + i, b = s1 - 1 - i
          const tmp = d[a]; d[a] = d[b]; d[b] = tmp
        }
        break
    }
  }
  return out
}
