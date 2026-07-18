import { describe, it, expect } from 'vitest'
import { applyBufferOp, cloneBuffer } from './bufferOps'

/* Minimal fake AudioContext/AudioBuffer so the pure math can be tested in node. */
function fakeCtx(): BaseAudioContext {
  return {
    createBuffer(numCh: number, length: number, sampleRate: number) {
      const chans = Array.from({ length: numCh }, () => new Float32Array(length))
      return {
        numberOfChannels: numCh, length, sampleRate, duration: length / sampleRate,
        getChannelData: (c: number) => chans[c],
        copyToChannel: (src: Float32Array, c: number) => { chans[c].set(src.subarray(0, chans[c].length)) },
      } as unknown as AudioBuffer
    },
  } as unknown as BaseAudioContext
}

const SR = 10
function buf(ctx: BaseAudioContext, data: number[]): AudioBuffer {
  const b = ctx.createBuffer(1, data.length, SR)
  b.copyToChannel(Float32Array.from(data), 0)
  return b
}

describe('applyBufferOp', () => {
  it('clones without mutating the source', () => {
    const ctx = fakeCtx()
    const src = buf(ctx, [1, 2, 3])
    const out = cloneBuffer(ctx, src)
    out.getChannelData(0)[0] = 99
    expect(src.getChannelData(0)[0]).toBe(1)
  })

  it('silences the selected sample range only', () => {
    const ctx = fakeCtx()
    const src = buf(ctx, [1, 1, 1, 1, 1, 1])
    const out = applyBufferOp(ctx, src, 'silence', 0.2, 0.5) // samples [2,5)
    expect(Array.from(out.getChannelData(0))).toEqual([1, 1, 0, 0, 0, 1])
  })

  it('reverses the selected range', () => {
    const ctx = fakeCtx()
    const src = buf(ctx, [1, 2, 3, 4])
    const out = applyBufferOp(ctx, src, 'reverse', 0, 0.4)
    expect(Array.from(out.getChannelData(0))).toEqual([4, 3, 2, 1])
  })

  it('normalizes peak to ~0.99', () => {
    const ctx = fakeCtx()
    const src = buf(ctx, [0.1, -0.25, 0.5, -0.2])
    const out = applyBufferOp(ctx, src, 'normalize', 0, 0.4)
    const peak = Math.max(...Array.from(out.getChannelData(0)).map(Math.abs))
    expect(peak).toBeCloseTo(0.99, 5)
  })

  it('applies a linear gain factor, clamped to [-1,1]', () => {
    const ctx = fakeCtx()
    const src = buf(ctx, [0.5, 0.8])
    const out = applyBufferOp(ctx, src, 'gain', 0, 0.2, 2)
    expect(out.getChannelData(0)[0]).toBeCloseTo(1, 5) // 0.5*2
    expect(out.getChannelData(0)[1]).toBeCloseTo(1, 5) // 0.8*2 clamped
  })

  it('fades in from silence to full', () => {
    const ctx = fakeCtx()
    const src = buf(ctx, [1, 1, 1, 1])
    const out = applyBufferOp(ctx, src, 'fadeIn', 0, 0.4)
    const d = out.getChannelData(0)
    expect(d[0]).toBeCloseTo(0, 5)
    expect(d[3]).toBeGreaterThan(d[0])
    expect(d[3]).toBeGreaterThan(0.9)
  })

  it('is a no-op for an empty range', () => {
    const ctx = fakeCtx()
    const src = buf(ctx, [1, 2, 3])
    const out = applyBufferOp(ctx, src, 'silence', 0.2, 0.2)
    expect(Array.from(out.getChannelData(0))).toEqual([1, 2, 3])
  })
})
