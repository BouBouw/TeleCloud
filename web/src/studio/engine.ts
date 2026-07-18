/* ─── StudioEngine ────────────────────────────────────────────────────
 * A single-AudioContext playback engine. Every track is scheduled as a
 * set of AudioBufferSourceNodes on one clock (ctx.currentTime), each
 * routed through its own gain + stereo-panner into a shared master chain
 * (EQ + effects). This is what makes cuts truly silent (only kept
 * segments are scheduled), kills the "doubling" (no looping elements) and
 * removes drift (sample-accurate scheduling, no timeupdate resync).
 */
import type { EQBand, EffectParams } from './constants'
import type { Track } from './types'
import { buildSegments, effectiveDuration } from './segments'

const SCHEDULE_LOOKAHEAD = 0.06 // s of headroom before the first note

/* ── Audio helpers ── */
function createImpulseResponse(ctx: BaseAudioContext, duration: number, decay: number): AudioBuffer {
  const length = Math.max(1, Math.ceil(ctx.sampleRate * duration))
  const buf = ctx.createBuffer(2, length, ctx.sampleRate)
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch)
    for (let i = 0; i < length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay)
  }
  return buf
}
function makeDistortionCurve(amount: number): Float32Array {
  const n = 512, curve = new Float32Array(n), k = Math.max(amount, 1)
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1
    curve[i] = ((Math.PI + k) * x) / (Math.PI + k * Math.abs(x))
  }
  return curve
}

/* ── Master chain (shared by live + offline render) ── */
interface MasterNodes {
  input: GainNode
  eq: BiquadFilterNode[]
  distWS: WaveShaperNode; distDry: GainNode; distWet: GainNode
  comp: DynamicsCompressorNode
  reverbN: ConvolverNode; reverbDry: GainNode; reverbWet: GainNode
  delayN: DelayNode; delayFeed: GainNode; delayDry: GainNode; delayWet: GainNode
  chorusDelay: DelayNode; chorusLFO: OscillatorNode; chorusDepth: GainNode; chorusDry: GainNode; chorusWet: GainNode
  masterGain: GainNode
}

function buildMasterChain(ctx: BaseAudioContext, eqFreqs: number[]): { nodes: MasterNodes; output: AudioNode } {
  const input = ctx.createGain()

  // distortion (dry/wet)
  const distWS = ctx.createWaveShaper()
  const distDry = ctx.createGain(); distDry.gain.value = 1
  const distWet = ctx.createGain(); distWet.gain.value = 0
  const distOut = ctx.createGain()
  input.connect(distDry); input.connect(distWS)
  distDry.connect(distOut); distWS.connect(distWet); distWet.connect(distOut)

  // compressor (transparent by default)
  const comp = ctx.createDynamicsCompressor(); comp.threshold.value = 0; comp.ratio.value = 1
  distOut.connect(comp)

  // EQ
  let chain: AudioNode = comp
  const eq = eqFreqs.map(f => {
    const bf = ctx.createBiquadFilter(); bf.type = 'peaking'; bf.frequency.value = f; bf.Q.value = 1; bf.gain.value = 0
    chain.connect(bf); chain = bf
    return bf
  })

  // reverb (dry/wet)
  const reverbN = ctx.createConvolver(); reverbN.buffer = createImpulseResponse(ctx, 2.5, 2)
  const reverbDry = ctx.createGain(); reverbDry.gain.value = 1
  const reverbWet = ctx.createGain(); reverbWet.gain.value = 0
  const reverbOut = ctx.createGain()
  chain.connect(reverbDry); chain.connect(reverbN)
  reverbDry.connect(reverbOut); reverbN.connect(reverbWet); reverbWet.connect(reverbOut)

  // delay (dry/wet + feedback)
  const delayN = ctx.createDelay(5); delayN.delayTime.value = 0.35
  const delayFeed = ctx.createGain(); delayFeed.gain.value = 0
  const delayDry = ctx.createGain(); delayDry.gain.value = 1
  const delayWet = ctx.createGain(); delayWet.gain.value = 0
  const delayOut = ctx.createGain()
  delayN.connect(delayFeed); delayFeed.connect(delayN)
  reverbOut.connect(delayDry); reverbOut.connect(delayN)
  delayDry.connect(delayOut); delayN.connect(delayWet); delayWet.connect(delayOut)

  // chorus (dry/wet via modulated delay)
  const chorusDelay = ctx.createDelay(0.1); chorusDelay.delayTime.value = 0.025
  const chorusLFO = ctx.createOscillator(); chorusLFO.frequency.value = 1.5
  const chorusDepth = ctx.createGain(); chorusDepth.gain.value = 0.003
  chorusLFO.connect(chorusDepth); chorusDepth.connect(chorusDelay.delayTime); chorusLFO.start()
  const chorusDry = ctx.createGain(); chorusDry.gain.value = 1
  const chorusWet = ctx.createGain(); chorusWet.gain.value = 0
  const chorusOut = ctx.createGain()
  delayOut.connect(chorusDry); delayOut.connect(chorusDelay)
  chorusDry.connect(chorusOut); chorusDelay.connect(chorusWet); chorusWet.connect(chorusOut)

  const masterGain = ctx.createGain(); masterGain.gain.value = 0.9
  chorusOut.connect(masterGain)

  return {
    nodes: { input, eq, distWS, distDry, distWet, comp, reverbN, reverbDry, reverbWet, delayN, delayFeed, delayDry, delayWet, chorusDelay, chorusLFO, chorusDepth, chorusDry, chorusWet, masterGain },
    output: masterGain,
  }
}

function applyEQToChain(eq: BiquadFilterNode[], bands: EQBand[]) {
  bands.forEach((b, i) => { if (eq[i]) eq[i].gain.value = b.gain })
}

function applyEffectsToChain(ctx: BaseAudioContext, m: MasterNodes, fx: EffectParams) {
  m.reverbDry.gain.value = fx.reverb.enabled ? 1 - fx.reverb.wet : 1
  m.reverbWet.gain.value = fx.reverb.enabled ? fx.reverb.wet : 0
  if (fx.reverb.enabled) m.reverbN.buffer = createImpulseResponse(ctx, fx.reverb.decay, 2)

  m.delayDry.gain.value = fx.delay.enabled ? 1 - fx.delay.wet : 1
  m.delayWet.gain.value = fx.delay.enabled ? fx.delay.wet : 0
  m.delayN.delayTime.value = fx.delay.time
  m.delayFeed.gain.value = fx.delay.enabled ? fx.delay.feedback : 0

  m.comp.threshold.value = fx.compressor.enabled ? fx.compressor.threshold : 0
  m.comp.ratio.value = fx.compressor.enabled ? fx.compressor.ratio : 1
  if (fx.compressor.enabled) {
    m.comp.attack.value = fx.compressor.attack / 1000
    m.comp.release.value = fx.compressor.release / 1000
  }

  m.distDry.gain.value = fx.distortion.enabled ? 1 - fx.distortion.wet : 1
  m.distWet.gain.value = fx.distortion.enabled ? fx.distortion.wet : 0
  m.distWS.curve = fx.distortion.enabled ? makeDistortionCurve(fx.distortion.amount * 4) as Float32Array<ArrayBuffer> : null

  m.chorusDry.gain.value = fx.chorus.enabled ? 1 - fx.chorus.wet : 1
  m.chorusWet.gain.value = fx.chorus.enabled ? fx.chorus.wet : 0
  m.chorusLFO.frequency.value = fx.chorus.rate
  m.chorusDepth.gain.value = fx.chorus.depth * 0.01
}

/** Effective per-track gain accounting for mute and any soloing. */
function effectiveTrackGain(track: Track, anySolo: boolean): number {
  if (track.muted) return 0
  if (anySolo && !track.solo) return 0
  return track.gain
}

/** Absolute timeline end of a track (offset + effective length). */
export function trackTimelineEnd(track: Track): number {
  if (!track.buffer) return track.offset
  return track.offset + effectiveDuration(track.buffer.duration, track.cuts)
}

export function timelineTotal(tracks: Track[]): number {
  return tracks.reduce((max, t) => Math.max(max, trackTimelineEnd(t)), 0)
}

interface TrackNode { gain: GainNode; pan: StereoPannerNode }

export class StudioEngine {
  ctx: AudioContext | null = null
  private master: MasterNodes | null = null
  private analyser: AnalyserNode | null = null
  private trackNodes = new Map<string, TrackNode>()
  private activeSources: AudioBufferSourceNode[] = []
  private eqFreqs: number[] = []

  private _playing = false
  private _rate = 1
  private _playheadAtStart = 0   // timeline seconds when the current run started
  private _ctxTimeAtStart = 0    // ctx.currentTime when the current run started
  private _pausedPlayhead = 0    // frozen playhead while not playing

  constructor(eqBands: EQBand[]) { this.eqFreqs = eqBands.map(b => b.freq) }

  /** Create the context + master chain lazily (context may start suspended). */
  ensureContext(): AudioContext {
    if (this.ctx) return this.ctx
    const ctx = new AudioContext()
    const { nodes, output } = buildMasterChain(ctx, this.eqFreqs)
    const analyser = ctx.createAnalyser(); analyser.fftSize = 2048
    output.connect(analyser); analyser.connect(ctx.destination)
    this.ctx = ctx; this.master = nodes; this.analyser = analyser
    return ctx
  }

  get sampleRate(): number { return this.ctx?.sampleRate ?? 44100 }
  get isPlaying(): boolean { return this._playing }
  getAnalyser(): AnalyserNode | null { return this.analyser }

  async decode(data: ArrayBuffer): Promise<AudioBuffer> {
    const ctx = this.ensureContext()
    return ctx.decodeAudioData(data)
  }

  setEQ(bands: EQBand[]) { if (this.master) applyEQToChain(this.master.eq, bands) }
  setEffects(fx: EffectParams) { if (this.ctx && this.master) applyEffectsToChain(this.ctx, this.master, fx) }
  setMasterVolume(v: number) { if (this.master) this.master.masterGain.gain.value = v }

  /** Ensure a persistent gain/pan node exists per track and update live params. */
  syncTracks(tracks: Track[]) {
    const ctx = this.ensureContext()
    const anySolo = tracks.some(t => t.solo)
    const alive = new Set(tracks.map(t => t.id))
    // remove stale
    for (const [id, node] of this.trackNodes) {
      if (!alive.has(id)) { node.gain.disconnect(); node.pan.disconnect(); this.trackNodes.delete(id) }
    }
    for (const t of tracks) {
      let node = this.trackNodes.get(t.id)
      if (!node) {
        const gain = ctx.createGain()
        const pan = ctx.createStereoPanner()
        gain.connect(pan); pan.connect(this.master!.input)
        node = { gain, pan }
        this.trackNodes.set(t.id, node)
      }
      node.gain.gain.value = effectiveTrackGain(t, anySolo)
      node.pan.pan.value = Math.max(-1, Math.min(1, t.pan))
    }
  }

  getPlayhead(): number {
    if (!this._playing || !this.ctx) return this._pausedPlayhead
    return this._playheadAtStart + (this.ctx.currentTime - this._ctxTimeAtStart) * this._rate
  }

  private stopSources() {
    for (const s of this.activeSources) { try { s.onended = null; s.stop() } catch { /* already stopped */ } }
    this.activeSources = []
  }

  /** Schedule every kept segment of every track from `from` (timeline s). */
  private schedule(tracks: Track[], from: number, rate: number) {
    const ctx = this.ensureContext()
    this.stopSources()
    const startCtxTime = ctx.currentTime + SCHEDULE_LOOKAHEAD
    for (const t of tracks) {
      if (!t.buffer) continue
      const node = this.trackNodes.get(t.id)
      if (!node) continue
      const segs = buildSegments(t.buffer.duration, t.cuts)
      for (const seg of segs) {
        const segLen = seg.srcEnd - seg.srcStart
        const segStartTL = t.offset + seg.timelineStart     // where the segment starts on the timeline
        const segEndTL = segStartTL + segLen
        if (segEndTL <= from + 1e-4) continue               // fully in the past
        const src = ctx.createBufferSource()
        src.buffer = t.buffer
        src.playbackRate.value = rate
        src.connect(node.gain)
        if (segStartTL >= from) {
          // starts in the future
          const when = startCtxTime + (segStartTL - from) / rate
          src.start(when, seg.srcStart, segLen)
        } else {
          // we are in the middle of this segment
          const into = from - segStartTL                    // timeline seconds already elapsed
          src.start(startCtxTime, seg.srcStart + into, segLen - into)
        }
        this.activeSources.push(src)
      }
    }
    this._ctxTimeAtStart = startCtxTime
    this._playheadAtStart = from
    this._rate = rate
  }

  async play(tracks: Track[], from: number, rate: number) {
    const ctx = this.ensureContext()
    await ctx.resume()
    this.syncTracks(tracks)
    this.schedule(tracks, from, rate)
    this._playing = true
  }

  /** Freeze playback, returning the current playhead. */
  pause(): number {
    const head = this.getPlayhead()
    this.stopSources()
    this._playing = false
    this._pausedPlayhead = head
    return head
  }

  stop() {
    this.stopSources()
    this._playing = false
    this._pausedPlayhead = 0
  }

  /** Move the playhead; reschedule seamlessly if currently playing. */
  seek(tracks: Track[], to: number) {
    if (this._playing) {
      this.schedule(tracks, to, this._rate)
    } else {
      this._pausedPlayhead = to
    }
  }

  setRate(tracks: Track[], rate: number) {
    if (this._playing) {
      const head = this.getPlayhead()
      this.schedule(tracks, head, rate)
    } else {
      this._rate = rate
    }
  }

  /** Reschedule from the current playhead (after a timing-affecting edit). */
  reschedule(tracks: Track[]) {
    if (this._playing) this.schedule(tracks, this.getPlayhead(), this._rate)
  }

  /**
   * Offline-render the full mix through the exact same graph (EQ + effects
   * + ripple cuts), so the exported file matches what you hear.
   */
  async renderMix(tracks: Track[], eq: EQBand[], fx: EffectParams, masterVol: number): Promise<AudioBuffer> {
    const usable = tracks.filter(t => t.buffer)
    const anySolo = usable.some(t => t.solo)
    const audible = usable.filter(t => effectiveTrackGain(t, anySolo) > 0)
    const total = timelineTotal(usable)
    const sr = this.sampleRate
    const length = Math.max(1, Math.ceil(total * sr))
    const offline = new OfflineAudioContext(2, length, sr)
    const { nodes, output } = buildMasterChain(offline, this.eqFreqs)
    output.connect(offline.destination)
    applyEQToChain(nodes.eq, eq)
    applyEffectsToChain(offline, nodes, fx)
    nodes.masterGain.gain.value = masterVol

    for (const t of audible) {
      const gain = offline.createGain(); gain.gain.value = effectiveTrackGain(t, anySolo)
      const pan = offline.createStereoPanner(); pan.pan.value = Math.max(-1, Math.min(1, t.pan))
      gain.connect(pan); pan.connect(nodes.input)
      const segs = buildSegments(t.buffer!.duration, t.cuts)
      for (const seg of segs) {
        const segLen = seg.srcEnd - seg.srcStart
        const src = offline.createBufferSource()
        src.buffer = t.buffer!
        src.connect(gain)
        src.start(t.offset + seg.timelineStart, seg.srcStart, segLen)
      }
    }
    return offline.startRendering()
  }

  dispose() {
    this.stopSources()
    try { this.ctx?.close() } catch { /* ignore */ }
    this.ctx = null; this.master = null; this.analyser = null
    this.trackNodes.clear()
  }
}
