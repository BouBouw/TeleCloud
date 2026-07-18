/* ─── WAV encoding + BPM detection ──────────────────────────────────── */

/** Encode an AudioBuffer (stereo-aware) to a 16-bit PCM WAV blob. */
export function encodeWAVFromBuffer(buffer: AudioBuffer): Blob {
  const numCh = Math.min(2, buffer.numberOfChannels)
  const sr = buffer.sampleRate
  const len = buffer.length
  const data = new ArrayBuffer(44 + len * numCh * 2)
  const v = new DataView(data)
  const wr = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }
  const byteRate = sr * numCh * 2
  wr(0, 'RIFF'); v.setUint32(4, 36 + len * numCh * 2, true)
  wr(8, 'WAVE'); wr(12, 'fmt ')
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, numCh, true)
  v.setUint32(24, sr, true); v.setUint32(28, byteRate, true)
  v.setUint16(32, numCh * 2, true); v.setUint16(34, 16, true)
  wr(36, 'data'); v.setUint32(40, len * numCh * 2, true)
  const chans: Float32Array[] = []
  for (let c = 0; c < numCh; c++) chans.push(buffer.getChannelData(c))
  let o = 44
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < numCh; c++) {
      const s = Math.max(-1, Math.min(1, chans[c][i]))
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true)
      o += 2
    }
  }
  return new Blob([data], { type: 'audio/wav' })
}

/** Encode a single mono Float32 channel to WAV (used for copy/paste segments). */
export function encodeWAV(data: Float32Array, sampleRate: number): Blob {
  const buf = new ArrayBuffer(44 + data.length * 2)
  const v = new DataView(buf)
  const wr = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }
  wr(0, 'RIFF'); v.setUint32(4, 36 + data.length * 2, true)
  wr(8, 'WAVE'); wr(12, 'fmt ')
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true)
  v.setUint16(32, 2, true); v.setUint16(34, 16, true)
  wr(36, 'data'); v.setUint32(40, data.length * 2, true)
  for (let i = 0; i < data.length; i++) {
    const s = Math.max(-1, Math.min(1, data[i]))
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return new Blob([buf], { type: 'audio/wav' })
}

/** Rough BPM estimate via onset-flux autocorrelation. */
export function detectBpm(buffer: AudioBuffer): number {
  const sampleRate = buffer.sampleRate
  const raw = buffer.getChannelData(0)
  const targetSR = 11025
  const step = Math.max(1, Math.floor(sampleRate / targetSR))
  const len = Math.floor(raw.length / step)
  const ds = new Float32Array(len)
  for (let i = 0; i < len; i++) ds[i] = raw[i * step]

  const frameSize = Math.max(1, Math.floor(targetSR * 0.023))
  const hopSize = Math.max(1, Math.floor(frameSize / 4))
  const onsets: number[] = []
  let prevEnergy = 0
  for (let i = 0; i + frameSize < len; i += hopSize) {
    let e = 0
    for (let j = i; j < i + frameSize; j++) e += ds[j] * ds[j]
    e /= frameSize
    onsets.push(Math.max(0, e - prevEnergy))
    prevEnergy = e
  }
  const peak = Math.max(...onsets)
  if (peak === 0) return 120
  for (let i = 0; i < onsets.length; i++) onsets[i] /= peak

  const secPerHop = hopSize / targetSR
  const minLag = Math.max(1, Math.floor(60 / (200 * secPerHop)))
  const maxLag = Math.floor(60 / (60 * secPerHop))
  let bestLag = minLag, bestCorr = -Infinity
  for (let lag = minLag; lag <= maxLag; lag++) {
    let corr = 0
    const n = onsets.length - lag
    for (let i = 0; i < n; i++) corr += onsets[i] * onsets[i + lag]
    if (corr > bestCorr) { bestCorr = corr; bestLag = lag }
  }
  let bpm = Math.round(60 / (bestLag * secPerHop))
  while (bpm > 180) bpm = Math.round(bpm / 2)
  while (bpm < 60) bpm = Math.round(bpm * 2)
  return Math.min(300, Math.max(40, bpm))
}
