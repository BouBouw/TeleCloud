import { useRef, useEffect, useState, useCallback, useMemo } from 'react'
import type React from 'react'
import { useI18n } from '../i18n'
import {
  Play, Pause, Square, SkipBack, Plus, Download, Save,
  Volume1, VolumeX, Scissors, Copy,
  Music2, Loader2, Wand2, RotateCcw,
  Repeat, ZoomIn, ZoomOut, Activity, Keyboard,
  MousePointer, Move, X,
} from 'lucide-react'
import { trackApi, wsApi } from '../lib/api'
import type { Track, Workspace } from '../lib/api'

/* ─── Types ─────────────────────────────────────────────────────── */
interface EQBand { label: string; freq: number; gain: number }
interface EffectParams {
  reverb:     { enabled: boolean; wet: number; decay: number }
  delay:      { enabled: boolean; time: number; feedback: number; wet: number }
  compressor: { enabled: boolean; threshold: number; ratio: number; attack: number; release: number }
  distortion: { enabled: boolean; amount: number; wet: number }
  chorus:     { enabled: boolean; rate: number; depth: number; wet: number }
}
interface DawChannel  { id: string; name: string; color: string; volume: number; pan: number; muted: boolean; solo: boolean }
interface CutRegion   { start: number; end: number }
interface ClipState   { offset: number; selection: { start: number; end: number } | null; cuts: CutRegion[] }
interface ExtraTrack  { id: string; name: string; color: string; src: string; duration: number; waveData: Float32Array | null; volume: number; muted: boolean; trackId?: string }
type Tool = 'select' | 'move'

/* ─── Constants ──────────────────────────────────────────────────── */
const DEFAULT_EQ: EQBand[] = [
  { label: 'Sub',     freq: 60,    gain: 0 },
  { label: 'Bass',    freq: 200,   gain: 0 },
  { label: 'Low-Mid', freq: 800,   gain: 0 },
  { label: 'Mid',     freq: 2500,  gain: 0 },
  { label: 'Hi-Mid',  freq: 6000,  gain: 0 },
  { label: 'Air',     freq: 14000, gain: 0 },
]
const EQ_PRESETS: Record<string, number[]> = {
  'Manual':    [0, 0, 0, 0, 0, 0],
  'Bass Boost':[6, 4, 0, -1, -1, 0],
  'Vocal':     [-3, -2, 1, 4, 3, -1],
  'Hip-Hop':   [5, 4, -1, -2, 0, 1],
  'Pop':       [-2, -1, 3, 3, 1, -2],
  'Rock':      [4, 2, -1, 2, 3, 1],
}
const DEFAULT_FX: EffectParams = {
  reverb:     { enabled: false, wet: 0.4,  decay: 2.5 },
  delay:      { enabled: false, time: 0.35, feedback: 0.4, wet: 0.4 },
  compressor: { enabled: false, threshold: -24, ratio: 4, attack: 3, release: 250 },
  distortion: { enabled: false, amount: 50, wet: 0.6 },
  chorus:     { enabled: false, rate: 1.5,  depth: 0.3, wet: 0.4 },
}
const INIT_CHANNELS: DawChannel[] = [
  { id: 'main',         name: 'Original', color: '#4f8ef7', volume: 0.8, pan: 0, muted: false, solo: false },
  { id: 'instrumental', name: 'Musique',  color: '#2eb872', volume: 0.8, pan: 0, muted: true,  solo: false },
  { id: 'vocals',       name: 'Voix',     color: '#9b59e2', volume: 0.8, pan: 0, muted: true,  solo: false },
]
const INIT_CLIPS: Record<string, ClipState> = {
  main:         { offset: 0, selection: null, cuts: [] },
  instrumental: { offset: 0, selection: null, cuts: [] },
  vocals:       { offset: 0, selection: null, cuts: [] },
}
const EXTRA_COLORS = ['#e67e22','#e91e63','#00bcd4','#8bc34a','#ff5722','#673ab7']

/* ─── BPM detection ─────────────────────────────────────────────── */
function detectBpm(buffer: AudioBuffer): number {
  const sampleRate = buffer.sampleRate
  const raw = buffer.getChannelData(0)

  // Downsample to ~11025 Hz
  const targetSR = 11025
  const step = Math.max(1, Math.floor(sampleRate / targetSR))
  const len = Math.floor(raw.length / step)
  const ds = new Float32Array(len)
  for (let i = 0; i < len; i++) ds[i] = raw[i * step]

  // Short-time energy flux (onset strength)
  const frameSize = Math.max(1, Math.floor(targetSR * 0.023)) // ~23 ms
  const hopSize  = Math.max(1, Math.floor(frameSize / 4))
  const onsets: number[] = []
  let prevEnergy = 0
  for (let i = 0; i + frameSize < len; i += hopSize) {
    let e = 0
    for (let j = i; j < i + frameSize; j++) e += ds[j] * ds[j]
    e /= frameSize
    onsets.push(Math.max(0, e - prevEnergy))
    prevEnergy = e
  }

  // Normalise
  const peak = Math.max(...onsets)
  if (peak === 0) return 120
  for (let i = 0; i < onsets.length; i++) onsets[i] /= peak

  // Autocorrelation in the 60–200 BPM lag window
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
  // fold harmonics into 60–180 range
  while (bpm > 180) bpm = Math.round(bpm / 2)
  while (bpm < 60)  bpm = Math.round(bpm * 2)
  return Math.min(300, Math.max(40, bpm))
}

/* ─── Audio helpers ──────────────────────────────────────────────── */
function createImpulseResponse(ctx: AudioContext, duration: number, decay: number): AudioBuffer {
  const length = Math.ceil(ctx.sampleRate * duration)
  const buf = ctx.createBuffer(2, length, ctx.sampleRate)
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch)
    for (let i = 0; i < length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay)
  }
  return buf
}
function makeDistortionCurve(amount: number): Float32Array {
  const n = 512; const curve = new Float32Array(n); const k = Math.max(amount, 1)
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1
    curve[i] = ((Math.PI + k) * x) / (Math.PI + k * Math.abs(x))
  }
  return curve
}

/* ─── Waveform drawing ───────────────────────────────────────────── */
/* ─── WAV encoder ───────────────────────────────────────────────── */
function encodeWAV(data: Float32Array, sampleRate: number): Blob {
  const buf = new ArrayBuffer(44 + data.length * 2)
  const v   = new DataView(buf)
  const wr  = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }
  wr(0, 'RIFF'); v.setUint32(4, 36 + data.length * 2, true)
  wr(8, 'WAVE'); wr(12, 'fmt ')
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true)
  v.setUint16(32, 2, true); v.setUint16(34, 16, true)
  wr(36, 'data'); v.setUint32(40, data.length * 2, true)
  for (let i = 0; i < data.length; i++) {
    const s = Math.max(-1, Math.min(1, data[i]))
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true)
  }
  return new Blob([buf], { type: 'audio/wav' })
}

function drawWave(canvas: HTMLCanvasElement, data: Float32Array, color: string, cuts: CutRegion[], clipDuration: number, pxPerSec: number) {
  const w = Math.max(1, Math.round(clipDuration * pxPerSec))
  const h = canvas.height = canvas.offsetHeight || 80
  canvas.width = w
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#0a0a0a'; ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = '#1c1c1c'; ctx.fillRect(0, Math.floor(h / 2), w, 1)
  const step = Math.max(1, data.length / w)
  ctx.fillStyle = color
  for (let x = 0; x < w; x++) {
    const s0 = Math.floor(x * step), s1 = Math.min(Math.floor((x + 1) * step), data.length)
    let lo = 1, hi = -1
    for (let j = s0; j < s1; j++) { const v = data[j]; if (v < lo) lo = v; if (v > hi) hi = v }
    ctx.fillRect(x, ((1 - hi) / 2) * h, 1, Math.max(1, ((hi - lo) / 2) * h))
  }
  if (clipDuration > 0) {
    for (const r of cuts) {
      const rx = (r.start / clipDuration) * w
      const rw = Math.max(2, ((r.end - r.start) / clipDuration) * w)
      // Dark fill
      ctx.fillStyle = 'rgba(0,0,0,0.78)'
      ctx.fillRect(rx, 0, rw, h)
      // Red diagonal hatch
      ctx.save()
      ctx.beginPath(); ctx.rect(rx, 0, rw, h); ctx.clip()
      ctx.strokeStyle = 'rgba(220,50,50,0.30)'
      ctx.lineWidth = 1
      for (let hx = rx - h; hx < rx + rw + h; hx += 7) {
        ctx.beginPath(); ctx.moveTo(hx, 0); ctx.lineTo(hx + h, h); ctx.stroke()
      }
      ctx.restore()
      // Red left/right boundary lines
      ctx.fillStyle = 'rgba(220,50,50,0.85)'
      ctx.fillRect(rx, 0, 2, h)
      ctx.fillRect(rx + rw - 2, 0, 2, h)
      // "CUT" label if wide enough
      if (rw > 28) {
        ctx.font = 'bold 9px monospace'
        ctx.fillStyle = 'rgba(220,50,50,0.70)'
        ctx.fillText('CUT', rx + rw / 2 - 9, h / 2 + 3)
      }
    }
  }
}

/* ─── Ruler drawing ──────────────────────────────────────────────── */
function drawRuler(canvas: HTMLCanvasElement, totalDur: number, pxPerSec: number) {
  const w = Math.max(800, Math.round((totalDur + 60) * pxPerSec))
  const h = canvas.height = canvas.offsetHeight || 24
  canvas.width = w
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#1a1a1a'; ctx.fillRect(0, 0, w, h)
  if (totalDur <= 0) return
  const every = pxPerSec < 20 ? 60 : pxPerSec < 50 ? 30 : pxPerSec < 120 ? 10 : pxPerSec < 300 ? 5 : 1
  ctx.font = '9px monospace'
  for (let t = 0; t <= totalDur + 60; t += every) {
    const x = Math.round(t * pxPerSec)
    ctx.fillStyle = '#333'; ctx.fillRect(x, 0, 1, h)
    ctx.fillStyle = '#777'; ctx.fillText(fmtTime(t), x + 2, h - 3)
  }
  const fineEvery = every / 4
  if (fineEvery >= 1) {
    for (let t = 0; t <= totalDur + 60; t += fineEvery) {
      const x = Math.round(t * pxPerSec)
      ctx.fillStyle = '#252525'; ctx.fillRect(x, Math.floor(h * 0.6), 1, Math.floor(h * 0.4))
    }
  }
}

function fmtTime(s: number) { return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` }

/* ─── EQ helpers ─────────────────────────────────────────────────── */
const freqToX = (freq: number, w: number) => (Math.log10(freq / 30) / Math.log10(20000 / 30)) * w
const dbToY   = (db: number, h: number)   => h - ((db + 12) / 24) * h
const yToDb   = (y: number, h: number)    => Math.max(-12, Math.min(12, ((h - y) / h) * 24 - 12))

/* ─── EQ Canvas component (Spotify-style) ───────────────────────── */
function EQCanvas({ bands, onChange, onReset }: { bands: EQBand[]; onChange: (i: number, g: number) => void; onReset: () => void }) {
  const { t } = useI18n()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dragIdx   = useRef<number | null>(null)
  const [preset, setPreset] = useState('Manual')

  const redraw = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    const dw = canvas.clientWidth, dh = canvas.clientHeight
    if (dw === 0 || dh === 0) return
    canvas.width = dw * dpr; canvas.height = dh * dpr
    const ctx = canvas.getContext('2d')!
    ctx.scale(dpr, dpr)
    const w = dw, h = dh

    ctx.fillStyle = '#0d0d0d'; ctx.fillRect(0, 0, w, h)

    // Grid
    for (const db of [-12, -6, 0, 6, 12]) {
      const y = dbToY(db, h)
      ctx.strokeStyle = db === 0 ? '#2a2a2a' : '#181818'
      ctx.lineWidth = db === 0 ? 1.5 : 1
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke()
    }
    // dB labels
    ctx.font = '9px monospace'; ctx.fillStyle = '#888'
    for (const db of [12, 6, 0, -6, -12]) {
      const y = dbToY(db, h)
      ctx.textBaseline = y < 8 ? 'top' : y > h - 8 ? 'bottom' : 'middle'
      ctx.fillText(db > 0 ? `+${db}dB` : `${db}dB`, 4, y)
    }

    // Control points in screen space
    const pts = bands.map(b => ({ x: freqToX(b.freq, w), y: dbToY(b.gain, h) }))
    const allPts = [{ x: -20, y: dbToY(0, h) }, ...pts, { x: w + 20, y: dbToY(0, h) }]

    // Catmull-Rom spline
    const drawSpline = () => {
      ctx.beginPath(); ctx.moveTo(allPts[0].x, allPts[0].y)
      const tension = 0.45
      for (let i = 0; i < allPts.length - 1; i++) {
        const p0 = allPts[Math.max(0, i - 1)], p1 = allPts[i]
        const p2 = allPts[i + 1], p3 = allPts[Math.min(allPts.length - 1, i + 2)]
        const cp1x = p1.x + (p2.x - p0.x) * tension / 3
        const cp1y = p1.y + (p2.y - p0.y) * tension / 3
        const cp2x = p2.x - (p3.x - p1.x) * tension / 3
        const cp2y = p2.y - (p3.y - p1.y) * tension / 3
        ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y)
      }
    }

    // Fill below curve
    drawSpline()
    ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath()
    const grad = ctx.createLinearGradient(0, 0, 0, h)
    grad.addColorStop(0, 'rgba(30,215,96,0.38)')
    grad.addColorStop(0.55, 'rgba(30,215,96,0.12)')
    grad.addColorStop(1, 'rgba(30,215,96,0.02)')
    ctx.fillStyle = grad; ctx.fill()

    // Stroke line
    drawSpline()
    ctx.strokeStyle = '#1ed760'; ctx.lineWidth = 1.5; ctx.stroke()

    // Control points
    pts.forEach((pt, i) => {
      ctx.beginPath(); ctx.arc(pt.x, pt.y, 5, 0, Math.PI * 2)
      ctx.fillStyle = '#fff'; ctx.fill()
      ctx.strokeStyle = '#1ed760'; ctx.lineWidth = 1.5; ctx.stroke()
      // gain label above
      if (bands[i].gain !== 0) {
        ctx.fillStyle = '#1ed760'; ctx.font = '8px monospace'; ctx.textBaseline = 'bottom'
        const lbl = bands[i].gain > 0 ? `+${bands[i].gain}` : `${bands[i].gain}`
        ctx.fillText(lbl, pt.x - ctx.measureText(lbl).width / 2, pt.y - 7)
      }
    })

    // Freq labels at bottom
    ctx.textBaseline = 'bottom'; ctx.font = '9px monospace'; ctx.fillStyle = '#888'
    bands.forEach(b => {
      const x = freqToX(b.freq, w)
      const lbl = b.freq >= 1000 ? `${b.freq / 1000}KHz` : `${b.freq}Hz`
      ctx.fillText(lbl, x - ctx.measureText(lbl).width / 2, h - 2)
    })
  }, [bands])

  useEffect(() => {
    redraw()
    const obs = new ResizeObserver(redraw)
    if (canvasRef.current) obs.observe(canvasRef.current.parentElement!)
    return () => obs.disconnect()
  }, [redraw])

  const hitTest = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current; if (!canvas) return -1
    const r = canvas.getBoundingClientRect()
    const mx = e.clientX - r.left, my = e.clientY - r.top
    for (let i = 0; i < bands.length; i++) {
      if (Math.hypot(mx - freqToX(bands[i].freq, r.width), my - dbToY(bands[i].gain, r.height)) < 12) return i
    }
    return -1
  }

  return (
    <div className="flex flex-col h-full" style={{ background: '#0d0d0d' }}>
      <div className="flex items-center gap-3 px-3 shrink-0" style={{ height: 32, borderBottom: '1px solid #161616' }}>
        <span className="text-[9px] uppercase" style={{ color: '#555' }}>{t('eq_label_presets')}</span>
        <select value={preset} onChange={e => {
          const p = e.target.value; setPreset(p)
          if (EQ_PRESETS[p]) {
            EQ_PRESETS[p].forEach((g, i) => onChange(i, g))
          }
        }} className="text-[10px] px-1.5 py-0.5 rounded outline-none"
          style={{ background: '#1a1a1a', color: '#999', border: '1px solid #2a2a2a' }}>
          {Object.keys(EQ_PRESETS).map(k => <option key={k}>{k}</option>)}
        </select>
        <button onClick={() => { onReset(); setPreset('Manual') }} className="ml-auto flex items-center gap-1 text-[9px] px-2 py-0.5 rounded hover:bg-white/5" style={{ color: '#555' }}>
          <RotateCcw size={9} /> {t('btn_reset_eq')}
        </button>
      </div>
      <canvas ref={canvasRef} className="w-full block"
        style={{ height: 220, cursor: 'crosshair', touchAction: 'none' }}
        onMouseDown={e => { const i = hitTest(e); if (i >= 0) dragIdx.current = i }}
        onMouseMove={e => {
          if (dragIdx.current === null) return
          const r = canvasRef.current!.getBoundingClientRect()
          const g = Math.round(yToDb(e.clientY - r.top, r.height) * 2) / 2
          onChange(dragIdx.current, g)
        }}
        onMouseUp={() => { dragIdx.current = null }}
        onMouseLeave={() => { dragIdx.current = null }}
      />
    </div>
  )
}

/* ─── Pan knob ───────────────────────────────────────────────────── */
function PanKnob({ pan, onChange, color }: { pan: number; onChange: (v: number) => void; color: string }) {
  const dragY = useRef<number | null>(null)
  const dragPan = useRef(0)
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (dragY.current === null) return
      const delta = (dragY.current - e.clientY) / 80
      onChange(Math.max(-1, Math.min(1, dragPan.current + delta)))
    }
    const onUp = () => { dragY.current = null }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
  }, [onChange])

  const angle = pan * 140 // -140 to +140 degrees from top
  return (
    <div title={`Pan: ${pan >= 0 ? 'R' : 'L'}${Math.round(Math.abs(pan) * 100)}`}
      onMouseDown={e => { dragY.current = e.clientY; dragPan.current = pan; e.preventDefault() }}
      style={{ width: 28, height: 28, borderRadius: '50%', cursor: 'ns-resize', userSelect: 'none', position: 'relative',
        background: 'radial-gradient(circle at 35% 32%, #3c3c3c, #111)', boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.8), 0 1px 0 #3a3a3a' }}>
      <div style={{ position: 'absolute', bottom: '50%', left: '50%', width: 1.5, height: 10,
        transformOrigin: 'bottom center', transform: `translateX(-50%) rotate(${angle}deg)`,
        background: color, borderRadius: 1 }} />
      {pan !== 0 && (
        <div style={{ position: 'absolute', inset: -1, borderRadius: '50%', border: `1.5px solid ${color}30` }} />
      )}
    </div>
  )
}

/* ─── Studio ─────────────────────────────────────────────────────── */
export default function Studio() {
  const { t } = useI18n()
  /* ── Element refs */
  const audioRef        = useRef<HTMLAudioElement>(null)
  const vocalsAudioRef  = useRef<HTMLAudioElement>(null)
  const instrAudioRef   = useRef<HTMLAudioElement>(null)
  const mainCanvasRef   = useRef<HTMLCanvasElement>(null)
  const instrCanvasRef  = useRef<HTMLCanvasElement>(null)
  const vocalsCanvasRef = useRef<HTMLCanvasElement>(null)
  const rulerCanvasRef  = useRef<HTMLCanvasElement>(null)
  const scrollRef       = useRef<HTMLDivElement>(null)
  const animRef         = useRef<number>(0)
  /* ── Web Audio refs */
  const ctxRef            = useRef<AudioContext | null>(null)
  const gainRef           = useRef<GainNode | null>(null)
  const analyserRef       = useRef<AnalyserNode | null>(null)
  const eqNodesRef        = useRef<BiquadFilterNode[]>([])
  const distWaveShaperRef = useRef<WaveShaperNode | null>(null)
  const distDryRef        = useRef<GainNode | null>(null)
  const distWetRef        = useRef<GainNode | null>(null)
  const compressorNodeRef = useRef<DynamicsCompressorNode | null>(null)
  const reverbNodeRef     = useRef<ConvolverNode | null>(null)
  const reverbDryRef      = useRef<GainNode | null>(null)
  const reverbWetRef      = useRef<GainNode | null>(null)
  const delayNodeRef      = useRef<DelayNode | null>(null)
  const delayFeedRef      = useRef<GainNode | null>(null)
  const delayDryRef       = useRef<GainNode | null>(null)
  const delayWetRef       = useRef<GainNode | null>(null)
  const chorusDelayRef    = useRef<DelayNode | null>(null)
  const chorusLFORef      = useRef<OscillatorNode | null>(null)
  const chorusDepthRef    = useRef<GainNode | null>(null)
  const chorusDryRef      = useRef<GainNode | null>(null)
  const chorusWetRef      = useRef<GainNode | null>(null)
  /* ── Mutable state refs */
  const isPlayingRef   = useRef(false)
  const durationRef    = useRef(0)
  const pxPerSecRef    = useRef(80)
  const clipsRef          = useRef<Record<string, ClipState>>(INIT_CLIPS)
  const toolRef           = useRef<Tool>('select')
  const extraTracksRef    = useRef<ExtraTrack[]>([])
  const lastCutTrackRef   = useRef<string>('main')
  const loopEnabledRef    = useRef(false)
  /* ── Waveform data refs */
  const mainWaveRef   = useRef<Float32Array | null>(null)
  const instrWaveRef  = useRef<Float32Array | null>(null)
  const vocalsWaveRef = useRef<Float32Array | null>(null)
  const stemDurRef    = useRef(0)
  /* ── Extra track refs (dynamic) */
  const extraAudioRefs  = useRef<Map<string, HTMLAudioElement>>(new Map())
  const extraCanvasRefs = useRef<Map<string, HTMLCanvasElement>>(new Map())
  const extraWaveRefs   = useRef<Map<string, Float32Array>>(new Map())
  /* ── Drag refs */
  const dragRef = useRef<{
    type: 'select' | 'move'
    trackId: string
    startClientX: number
    startLocalTime: number
    startOffset: number
  } | null>(null)
  const resizeDragRef = useRef<{ type: 'lib'; startPos: number; startSize: number } | null>(null)
  const winDragRef    = useRef<{ startX: number; startY: number; startWx: number; startWy: number } | null>(null)
  const winResizeRef  = useRef<{ dir: string; startX: number; startY: number; startW: number; startH: number; startWx: number; startWy: number } | null>(null)

  /* ── Transport state */
  const [isPlaying,    setIsPlaying]    = useState(false)
  const [currentTime,  setCurrentTime]  = useState(0)
  const [duration,     setDuration]     = useState(0)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [loopEnabled,  setLoopEnabled]  = useState(false)
  const [bpm,          setBpm]          = useState(130)
  const [detectingBpm, setDetectingBpm] = useState(false)
  /* ── Clip state */
  const [clips, setClips] = useState<Record<string, ClipState>>(INIT_CLIPS)
  const [clipboard, setClipboard] = useState<{ trackId: string; start: number; end: number } | null>(null)
  /* ── Tool */
  const [tool, setTool] = useState<Tool>('select')
  /* ── Channels */
  const [channels, setChannels] = useState<DawChannel[]>(INIT_CHANNELS)
  /* ── Extra tracks */
  const [extraTracks, setExtraTracks] = useState<ExtraTrack[]>([])
  /* ── Effects / EQ */
  const [eq,           setEq]           = useState<EQBand[]>(DEFAULT_EQ)
  const [effectParams, setEffectParams] = useState<EffectParams>(DEFAULT_FX)
  /* ── Floating window */
  const [floatWin, setFloatWin] = useState<{ tab: 'mixer'|'eq'|'effects'; x:number; y:number; w:number; h:number; minimized:boolean } | null>(null)
  const floatWinRef = useRef<typeof floatWin>(null)
  /* ── Library */
  const [workspace,    setWorkspace]    = useState<Workspace | null>(null)
  const [libTracks,    setLibTracks]    = useState<Track[]>([])
  const [loadingLib,   setLoadingLib]   = useState(true)
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null)
  const [showLibrary,  setShowLibrary]  = useState(() => window.innerWidth >= 768)
  /* ── Stems */
  const [stemsReady,   setStemsReady]   = useState(false)
  const [separating,   setSeparating]   = useState(false)
  const [stemError,    setStemError]    = useState<string | null>(null)
  /* ── UI */
  const [showShortcuts,   setShowShortcuts]   = useState(false)
  const [showExportModal, setShowExportModal] = useState(false)
  const [zoom,             setZoom]           = useState(1)
  const [libWidth,         setLibWidth]       = useState(176)
  const [dragOverTracks,   setDragOverTracks] = useState(false)

  /* ── Derived ───────────────────────────────────────── */
  const pxPerSec = useMemo(() => 80 * zoom, [zoom])
  const contentWidth = useMemo(() => {
    const ends = [
      clips.main?.offset         + duration,
      clips.instrumental?.offset + stemDurRef.current,
      clips.vocals?.offset       + stemDurRef.current,
      ...extraTracks.map(t => (clips[t.id]?.offset ?? 0) + t.duration),
    ].filter(n => n > 0)
    return Math.max(800, (ends.length ? Math.max(...ends) : 0) * pxPerSec + 300, pxPerSec * 30)
  }, [clips, duration, pxPerSec, extraTracks])

  /* ── Keep mutable refs in sync ─────────────────────── */
  useEffect(() => { isPlayingRef.current  = isPlaying },    [isPlaying])
  useEffect(() => { durationRef.current   = duration },     [duration])
  useEffect(() => { pxPerSecRef.current   = pxPerSec },     [pxPerSec])
  useEffect(() => { clipsRef.current      = clips },        [clips])
  useEffect(() => { toolRef.current       = tool },         [tool])
  useEffect(() => { extraTracksRef.current = extraTracks }, [extraTracks])
  useEffect(() => { loopEnabledRef.current  = loopEnabled }, [loopEnabled])
  const currentTimeRef = useRef(0)
  useEffect(() => { currentTimeRef.current = currentTime }, [currentTime])
  useEffect(() => { floatWinRef.current = floatWin }, [floatWin])

  /* ── Library fetch ─────────────────────────────────── */
  useEffect(() => {
    wsApi.list().then(({ workspaces }) => {
      const ws = workspaces[0]; if (!ws) { setLoadingLib(false); return }
      setWorkspace(ws)
      trackApi.list(ws.id).then(({ tracks }) => setLibTracks(tracks)).finally(() => setLoadingLib(false))
    }).catch(() => setLoadingLib(false))
  }, [])

  /* ── Web Audio setup ───────────────────────────────── */
  const setupAudio = useCallback(() => {
    if (ctxRef.current || !audioRef.current) return
    const ctx = new AudioContext()
    const filters = DEFAULT_EQ.map(b => {
      const f = ctx.createBiquadFilter(); f.type = 'peaking'
      f.frequency.value = b.freq; f.Q.value = 1; f.gain.value = 0; return f
    })
    const distWS = ctx.createWaveShaper()
    const distDry = ctx.createGain(); distDry.gain.value = 1
    const distWet = ctx.createGain(); distWet.gain.value = 0
    const distOut = ctx.createGain()
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = 0; comp.ratio.value = 1
    const reverbN = ctx.createConvolver(); reverbN.buffer = createImpulseResponse(ctx, 2.5, 2)
    const reverbDry = ctx.createGain(); reverbDry.gain.value = 1
    const reverbWet = ctx.createGain(); reverbWet.gain.value = 0
    const reverbOut = ctx.createGain()
    const delayN = ctx.createDelay(5); delayN.delayTime.value = 0.35
    const delayFeed = ctx.createGain(); delayFeed.gain.value = 0
    const delayDry = ctx.createGain(); delayDry.gain.value = 1
    const delayWet = ctx.createGain(); delayWet.gain.value = 0
    const delayOut = ctx.createGain()
    delayN.connect(delayFeed); delayFeed.connect(delayN)
    const chorusDelay = ctx.createDelay(0.1); chorusDelay.delayTime.value = 0.025
    const chorusLFO = ctx.createOscillator(); chorusLFO.frequency.value = 1.5
    const chorusDepth = ctx.createGain(); chorusDepth.gain.value = 0.003
    chorusLFO.connect(chorusDepth); chorusDepth.connect(chorusDelay.delayTime); chorusLFO.start()
    const chorusDry = ctx.createGain(); chorusDry.gain.value = 1
    const chorusWet = ctx.createGain(); chorusWet.gain.value = 0
    const chorusOut = ctx.createGain()
    const masterGain = ctx.createGain(); masterGain.gain.value = 0.8
    const analyser = ctx.createAnalyser(); analyser.fftSize = 2048
    const src = ctx.createMediaElementSource(audioRef.current)
    src.connect(distDry); src.connect(distWS)
    distDry.connect(distOut); distWS.connect(distWet); distWet.connect(distOut)
    distOut.connect(comp)
    let chain: AudioNode = comp
    filters.forEach(f => { chain.connect(f); chain = f })
    chain.connect(reverbDry); chain.connect(reverbN)
    reverbDry.connect(reverbOut); reverbN.connect(reverbWet); reverbWet.connect(reverbOut)
    reverbOut.connect(delayDry); reverbOut.connect(delayN)
    delayDry.connect(delayOut); delayN.connect(delayWet); delayWet.connect(delayOut)
    delayOut.connect(chorusDry); delayOut.connect(chorusDelay)
    chorusDry.connect(chorusOut); chorusDelay.connect(chorusWet); chorusWet.connect(chorusOut)
    chorusOut.connect(masterGain); masterGain.connect(analyser); analyser.connect(ctx.destination)
    ctxRef.current = ctx; gainRef.current = masterGain; analyserRef.current = analyser
    eqNodesRef.current = filters
    distWaveShaperRef.current = distWS; distDryRef.current = distDry; distWetRef.current = distWet
    compressorNodeRef.current = comp
    reverbNodeRef.current = reverbN; reverbDryRef.current = reverbDry; reverbWetRef.current = reverbWet
    delayNodeRef.current = delayN; delayFeedRef.current = delayFeed
    delayDryRef.current = delayDry; delayWetRef.current = delayWet
    chorusDelayRef.current = chorusDelay; chorusLFORef.current = chorusLFO
    chorusDepthRef.current = chorusDepth; chorusDryRef.current = chorusDry; chorusWetRef.current = chorusWet
  }, [])

  /* ── Apply effects ─────────────────────────────────── */
  const applyEffects = useCallback(() => {
    if (!ctxRef.current) return
    const ep = effectParams; const ctx = ctxRef.current
    if (reverbDryRef.current) reverbDryRef.current.gain.value = ep.reverb.enabled ? 1 - ep.reverb.wet : 1
    if (reverbWetRef.current) reverbWetRef.current.gain.value = ep.reverb.enabled ? ep.reverb.wet : 0
    if (reverbNodeRef.current && ep.reverb.enabled) reverbNodeRef.current.buffer = createImpulseResponse(ctx, ep.reverb.decay, 2)
    if (delayDryRef.current) delayDryRef.current.gain.value = ep.delay.enabled ? 1 - ep.delay.wet : 1
    if (delayWetRef.current) delayWetRef.current.gain.value = ep.delay.enabled ? ep.delay.wet : 0
    if (delayNodeRef.current) delayNodeRef.current.delayTime.value = ep.delay.time
    if (delayFeedRef.current) delayFeedRef.current.gain.value = ep.delay.enabled ? ep.delay.feedback : 0
    if (compressorNodeRef.current) {
      compressorNodeRef.current.threshold.value = ep.compressor.enabled ? ep.compressor.threshold : 0
      compressorNodeRef.current.ratio.value = ep.compressor.enabled ? ep.compressor.ratio : 1
      if (ep.compressor.enabled) {
        compressorNodeRef.current.attack.value  = ep.compressor.attack / 1000
        compressorNodeRef.current.release.value = ep.compressor.release / 1000
      }
    }
    if (distDryRef.current)        distDryRef.current.gain.value   = ep.distortion.enabled ? 1 - ep.distortion.wet : 1
    if (distWetRef.current)        distWetRef.current.gain.value   = ep.distortion.enabled ? ep.distortion.wet : 0
    if (distWaveShaperRef.current) distWaveShaperRef.current.curve = ep.distortion.enabled ? makeDistortionCurve(ep.distortion.amount * 4) as Float32Array<ArrayBuffer> : null
    if (chorusDryRef.current) chorusDryRef.current.gain.value = ep.chorus.enabled ? 1 - ep.chorus.wet : 1
    if (chorusWetRef.current) chorusWetRef.current.gain.value = ep.chorus.enabled ? ep.chorus.wet : 0
    if (chorusLFORef.current) chorusLFORef.current.frequency.value = ep.chorus.rate
    if (chorusDepthRef.current) chorusDepthRef.current.gain.value = ep.chorus.depth * 0.01
  }, [effectParams])
  useEffect(() => { applyEffects() }, [applyEffects])
  useEffect(() => { eq.forEach((b, i) => { if (eqNodesRef.current[i]) eqNodesRef.current[i].gain.value = b.gain }) }, [eq])
  useEffect(() => {
    const main  = channels.find(c => c.id === 'main')
    const instr = channels.find(c => c.id === 'instrumental')
    const vox   = channels.find(c => c.id === 'vocals')
    if (gainRef.current && main)   gainRef.current.gain.value       = main.muted  ? 0 : main.volume
    if (instrAudioRef.current && instr) instrAudioRef.current.volume = instr.muted ? 0 : instr.volume
    if (vocalsAudioRef.current && vox)  vocalsAudioRef.current.volume = vox.muted  ? 0 : vox.volume
  }, [channels])
  useEffect(() => {
    for (const [id, el] of extraAudioRefs.current.entries()) {
      const et = extraTracksRef.current.find(t => t.id === id)
      if (et) el.volume = et.muted ? 0 : et.volume
    }
  }, [extraTracks])
  useEffect(() => { if (audioRef.current) audioRef.current.playbackRate = playbackRate }, [playbackRate])

  /* ── Redraw on zoom/cut changes ────────────────────── */
  useEffect(() => {
    const ps = pxPerSec
    if (mainWaveRef.current   && mainCanvasRef.current)
      drawWave(mainCanvasRef.current,   mainWaveRef.current,   '#4f8ef7', clips.main?.cuts ?? [],         duration,           ps)
    if (instrWaveRef.current  && instrCanvasRef.current)
      drawWave(instrCanvasRef.current,  instrWaveRef.current,  '#2eb872', clips.instrumental?.cuts ?? [], stemDurRef.current, ps)
    if (vocalsWaveRef.current && vocalsCanvasRef.current)
      drawWave(vocalsCanvasRef.current, vocalsWaveRef.current, '#9b59e2', clips.vocals?.cuts ?? [],       stemDurRef.current, ps)
    if (rulerCanvasRef.current) drawRuler(rulerCanvasRef.current, duration, ps)
    for (const [id, canvas] of extraCanvasRefs.current.entries()) {
      const wd = extraWaveRefs.current.get(id)
      const et = extraTracksRef.current.find(t => t.id === id)
      if (wd && et) drawWave(canvas, wd, et.color, clipsRef.current[id]?.cuts ?? [], et.duration, ps)
    }
  }, [clips, duration, pxPerSec])

  /* ── Seek ──────────────────────────────────────────── */
  const seek = useCallback((t: number) => {
    if (!audioRef.current) return
    const clamped = Math.max(0, Math.min(durationRef.current, t))
    audioRef.current.currentTime = clamped
    setCurrentTime(clamped)
    const cs = clipsRef.current
    if (vocalsAudioRef.current) {
      const off = cs.vocals?.offset ?? 0
      vocalsAudioRef.current.currentTime = clamped >= off ? Math.min(stemDurRef.current, clamped - off) : 0
    }
    if (instrAudioRef.current) {
      const off = cs.instrumental?.offset ?? 0
      instrAudioRef.current.currentTime = clamped >= off ? Math.min(stemDurRef.current, clamped - off) : 0
    }
    for (const [id, el] of extraAudioRefs.current.entries()) {
      const off = cs[id]?.offset ?? 0
      const et = extraTracksRef.current.find(t => t.id === id)
      if (et) el.currentTime = clamped >= off ? Math.min(et.duration, clamped - off) : 0
    }
  }, [])

  /* ── timeupdate ────────────────────────────────────── */
  useEffect(() => {
    const el = audioRef.current; if (!el) return
    const onTime = () => {
      const t = el.currentTime
      setCurrentTime(t)
      const cs = clipsRef.current
      const mainSel = cs.main?.selection
      if (loopEnabledRef.current && mainSel && t >= mainSel.end + (cs.main?.offset ?? 0) - 0.05)
        el.currentTime = mainSel.start + (cs.main?.offset ?? 0)
      const inCut = (cs.main?.cuts ?? []).find(r => t >= r.start + (cs.main?.offset ?? 0) && t < r.end + (cs.main?.offset ?? 0))
      if (inCut) { el.currentTime = inCut.end + (cs.main?.offset ?? 0); return }
      if (stemDurRef.current > 0) {
        for (const [stemEl, id] of [
          [vocalsAudioRef.current, 'vocals'],
          [instrAudioRef.current,  'instrumental'],
        ] as [HTMLAudioElement | null, string][]) {
          if (!stemEl) continue
          const off = cs[id]?.offset ?? 0
          if (t < off) { if (!stemEl.paused) stemEl.pause(); stemEl.currentTime = 0 }
          else {
            const stemT = Math.min(stemDurRef.current, t - off)
            if (Math.abs(stemEl.currentTime - stemT) > 0.15) stemEl.currentTime = stemT
            if (isPlayingRef.current && stemEl.paused) stemEl.play().catch(() => {})
          }
        }
      }
      for (const [id, stemEl] of extraAudioRefs.current.entries()) {
        const off = cs[id]?.offset ?? 0
        const et = extraTracksRef.current.find(et2 => et2.id === id)
        if (!et) continue
        if (t < off) { if (!stemEl.paused) stemEl.pause(); stemEl.currentTime = 0 }
        else {
          const stemT = Math.min(et.duration, t - off)
          if (Math.abs(stemEl.currentTime - stemT) > 0.15) stemEl.currentTime = stemT
          if (isPlayingRef.current && stemEl.paused) stemEl.play().catch(() => {})
        }
      }
    }
    const onEnded = () => {
      if (!isPlayingRef.current) return
      const clips2 = clipsRef.current
      const maxEnd = extraTracksRef.current.reduce(
        (acc, et) => Math.max(acc, (clips2[et.id]?.offset ?? 0) + et.duration),
        durationRef.current
      )
      if (loopEnabledRef.current) {
        el.currentTime = 0; el.play().catch(() => {})
        vocalsAudioRef.current && (vocalsAudioRef.current.currentTime = 0)
        instrAudioRef.current  && (instrAudioRef.current.currentTime  = 0)
        for (const el2 of extraAudioRefs.current.values()) { el2.pause(); el2.currentTime = 0 }
        return
      }
      if (maxEnd <= durationRef.current + 0.05) {
        setIsPlaying(false); setCurrentTime(durationRef.current); return
      }
      // Extra clips extend beyond main — drive clock with rAF
      let clk = durationRef.current
      let lastTs = performance.now()
      const tick = (ts: number) => {
        const dt = (ts - lastTs) / 1000; lastTs = ts
        clk = Math.min(clk + dt, maxEnd)
        setCurrentTime(clk); currentTimeRef.current = clk
        const cs2 = clipsRef.current
        for (const [id, el2] of extraAudioRefs.current.entries()) {
          const off = cs2[id]?.offset ?? 0
          const et = extraTracksRef.current.find(e2 => e2.id === id)
          if (!et) continue
          if (clk < off) { if (!el2.paused) el2.pause(); el2.currentTime = 0 }
          else {
            const stemT = Math.min(et.duration, clk - off)
            if (Math.abs(el2.currentTime - stemT) > 0.15) el2.currentTime = stemT
            if (el2.paused && isPlayingRef.current) el2.play().catch(() => {})
          }
        }
        if (clk >= maxEnd || !isPlayingRef.current) {
          for (const el2 of extraAudioRefs.current.values()) el2.pause()
          setIsPlaying(false); return
        }
        animRef.current = requestAnimationFrame(tick)
      }
      animRef.current = requestAnimationFrame(tick)
    }
    el.addEventListener('timeupdate', onTime)
    el.addEventListener('ended', onEnded)
    return () => { el.removeEventListener('timeupdate', onTime); el.removeEventListener('ended', onEnded) }
  }, [])

  /* ── Transport ─────────────────────────────────────── */
  const togglePlay = useCallback(() => {
    if (!audioRef.current) return
    setupAudio()
    if (isPlayingRef.current) {
      audioRef.current.pause()
      vocalsAudioRef.current?.pause(); instrAudioRef.current?.pause()
      for (const el of extraAudioRefs.current.values()) el.pause()
      cancelAnimationFrame(animRef.current); setIsPlaying(false)
    } else {
      ctxRef.current?.resume(); audioRef.current.play()
      const t = audioRef.current.currentTime
      const cs = clipsRef.current
      if (stemDurRef.current > 0) {
        if (vocalsAudioRef.current) {
          const off = cs.vocals?.offset ?? 0
          if (t >= off) { vocalsAudioRef.current.currentTime = t - off; vocalsAudioRef.current.play().catch(() => {}) }
        }
        if (instrAudioRef.current) {
          const off = cs.instrumental?.offset ?? 0
          if (t >= off) { instrAudioRef.current.currentTime = t - off; instrAudioRef.current.play().catch(() => {}) }
        }
      }
      for (const [id, el] of extraAudioRefs.current.entries()) {
        const off = cs[id]?.offset ?? 0
        const et = extraTracksRef.current.find(e2 => e2.id === id)
        if (et && t >= off) { el.currentTime = t - off; el.play().catch(() => {}) }
      }
      setIsPlaying(true)
    }
  }, [setupAudio])

  const stopPlayback = useCallback(() => {
    audioRef.current?.pause(); vocalsAudioRef.current?.pause(); instrAudioRef.current?.pause()
    for (const el of extraAudioRefs.current.values()) el.pause()
    cancelAnimationFrame(animRef.current)
    if (audioRef.current) audioRef.current.currentTime = 0
    setIsPlaying(false); setCurrentTime(0)
  }, [])

  /* ── Stem separation ───────────────────────────────── */
  const doSeparate = useCallback(async (track: Track, ws: Workspace) => {
    setSeparating(true); setStemError(null)
    try {
      const token = localStorage.getItem('ss_token')
      const res = await fetch(`/api/workspaces/${ws.id}/tracks/${track.id}/separate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      const q = token ? `?token=${encodeURIComponent(token)}` : ''
      const mkUrl = (stem: string) => `/api/workspaces/${ws.id}/tracks/${track.id}/stems/${stem}${q}`
      if (vocalsAudioRef.current) { vocalsAudioRef.current.src = mkUrl('vocals'); vocalsAudioRef.current.loop = true }
      if (instrAudioRef.current)  { instrAudioRef.current.src  = mkUrl('instrumental'); instrAudioRef.current.loop = true }
      for (const [stem, canvasRef, color] of [
        ['instrumental', instrCanvasRef,  '#2eb872'],
        ['vocals',       vocalsCanvasRef, '#9b59e2'],
      ] as [string, React.RefObject<HTMLCanvasElement | null>, string][]) {
        fetch(mkUrl(stem)).then(r => r.arrayBuffer()).then(async ab => {
          const tmp = new AudioContext(); const buf = await tmp.decodeAudioData(ab); tmp.close()
          stemDurRef.current = buf.duration
          const wd = buf.getChannelData(0)
          if (stem === 'instrumental') instrWaveRef.current = wd
          else vocalsWaveRef.current = wd
          const canvas = canvasRef.current
          if (canvas) drawWave(canvas, wd, color, clipsRef.current[stem]?.cuts ?? [], buf.duration, pxPerSecRef.current)
        }).catch(() => {})
      }
      setStemsReady(true)
    } catch (err) {
      setStemError(err instanceof Error ? err.message : 'Separation failed')
    } finally { setSeparating(false) }
  }, [])

  /* ── Load track from library ───────────────────────── */
  const loadTrack = useCallback(async (track: Track) => {
    if (!workspace || !audioRef.current) return
    audioRef.current.src = trackApi.streamUrl(workspace.id, track.id)
    audioRef.current.loop = false
    ctxRef.current = null; eqNodesRef.current = []
    setIsPlaying(false); setCurrentTime(0); setDuration(0)
    setCurrentTrack(track); setStemsReady(false); setStemError(null)
    setClips(INIT_CLIPS); mainWaveRef.current = null; instrWaveRef.current = null; vocalsWaveRef.current = null
    const url = trackApi.streamUrl(workspace.id, track.id)
    fetch(url).then(r => r.arrayBuffer()).then(async ab => {
      const tmp = new AudioContext(); const buf = await tmp.decodeAudioData(ab); tmp.close()
      mainWaveRef.current = buf.getChannelData(0); setDuration(buf.duration)
      if (mainCanvasRef.current) drawWave(mainCanvasRef.current, mainWaveRef.current!, '#4f8ef7', [], buf.duration, pxPerSecRef.current)
      if (rulerCanvasRef.current) drawRuler(rulerCanvasRef.current, buf.duration, pxPerSecRef.current)
    }).catch(() => {})
    doSeparate(track, workspace)
  }, [workspace, doSeparate])

  /* ── Add extra track from library ──────────────────── */
  const addExtraTrackFromLibrary = useCallback(async (track: Track) => {
    if (!workspace) return
    const id = `extra-${Date.now()}`
    const src = trackApi.streamUrl(workspace.id, track.id)
    const color = EXTRA_COLORS[extraTracksRef.current.length % EXTRA_COLORS.length]
    setExtraTracks(p => [...p, { id, name: track.title, color, src, duration: 0, waveData: null, volume: 0.8, muted: false, trackId: track.id }])
    setClips(p => ({ ...p, [id]: { offset: 0, selection: null, cuts: [] } }))
    fetch(src).then(r => r.arrayBuffer()).then(async ab => {
      const tmp = new AudioContext(); const buf = await tmp.decodeAudioData(ab); tmp.close()
      const wd = buf.getChannelData(0)
      extraWaveRefs.current.set(id, wd)
      setExtraTracks(p => p.map(t => t.id === id ? { ...t, duration: buf.duration, waveData: wd } : t))
      const canvas = extraCanvasRefs.current.get(id)
      if (canvas) drawWave(canvas, wd, color, [], buf.duration, pxPerSecRef.current)
    }).catch(() => {})
  }, [workspace])

  /* ── Add extra track from file ─────────────────────── */
  const addExtraTrackFromFile = useCallback((file: File) => {
    const id = `extra-${Date.now()}`
    const src = URL.createObjectURL(file)
    const color = EXTRA_COLORS[extraTracksRef.current.length % EXTRA_COLORS.length]
    const name = file.name.replace(/\.[^/.]+$/, '')
    setExtraTracks(p => [...p, { id, name, color, src, duration: 0, waveData: null, volume: 0.8, muted: false }])
    setClips(p => ({ ...p, [id]: { offset: 0, selection: null, cuts: [] } }))
    file.arrayBuffer().then(async ab => {
      const tmp = new AudioContext(); const buf = await tmp.decodeAudioData(ab); tmp.close()
      const wd = buf.getChannelData(0)
      extraWaveRefs.current.set(id, wd)
      setExtraTracks(p => p.map(t => t.id === id ? { ...t, duration: buf.duration, waveData: wd } : t))
      const canvas = extraCanvasRefs.current.get(id)
      if (canvas) drawWave(canvas, wd, color, [], buf.duration, pxPerSecRef.current)
    }).catch(() => {})
  }, [])

  const removeExtraTrack = useCallback((id: string) => {
    setExtraTracks(p => p.filter(t => t.id !== id))
    setClips(p => { const n = { ...p }; delete n[id]; return n })
    extraAudioRefs.current.delete(id)
    extraCanvasRefs.current.delete(id)
    extraWaveRefs.current.delete(id)
  }, [])

  /* ── Download ──────────────────────────────────────── */
  const downloadTrack = useCallback(() => {
    if (!audioRef.current?.src) return
    const a = document.createElement('a')
    a.href = audioRef.current.src
    a.download = `${currentTrack?.title ?? 'track'}.mp3`
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
  }, [currentTrack])

  /* ── Clip editing ──────────────────────────────────── */
  const copySelection = useCallback((trackId: string) => {
    const sel = clipsRef.current[trackId]?.selection
    if (sel) setClipboard({ trackId, start: sel.start, end: sel.end })
  }, [])
  const cutSelection = useCallback((trackId: string) => {
    const clip = clipsRef.current[trackId]; const sel = clip?.selection
    if (!sel || sel.end - sel.start < 0.001) return
    setClipboard({ trackId, start: sel.start, end: sel.end })
    setClips(p => ({
      ...p,
      [trackId]: { ...p[trackId], cuts: [...(p[trackId]?.cuts ?? []), { start: sel.start, end: sel.end }].sort((a, b) => a.start - b.start), selection: null },
    }))
    lastCutTrackRef.current = trackId
  }, [])
  const restoreAll = useCallback((trackId: string) => {
    setClips(p => ({ ...p, [trackId]: { ...p[trackId], cuts: [] } }))
  }, [])
  const pasteClipboard = useCallback(() => {
    if (!clipboard) return
    // Find wave data for the source track
    let srcWave: Float32Array | null = null
    if (clipboard.trackId === 'main') srcWave = mainWaveRef.current
    else if (clipboard.trackId === 'instrumental') srcWave = instrWaveRef.current
    else if (clipboard.trackId === 'vocals') srcWave = vocalsWaveRef.current
    else srcWave = extraWaveRefs.current.get(clipboard.trackId) ?? null
    if (!srcWave) {
      // Fallback: just restore selection
      setClips(p => ({ ...p, [clipboard.trackId]: { ...p[clipboard.trackId], selection: { start: clipboard.start, end: clipboard.end } } }))
      return
    }
    // Estimate sample rate from wave length vs track duration
    const trackDur = clipboard.trackId === 'main' ? durationRef.current
      : (clipboard.trackId === 'instrumental' || clipboard.trackId === 'vocals') ? stemDurRef.current
      : (extraTracksRef.current.find(t => t.id === clipboard.trackId)?.duration ?? 0)
    if (trackDur <= 0) return
    const sampleRate = Math.round(srcWave.length / trackDur)
    const s0 = Math.floor(clipboard.start * sampleRate)
    const s1 = Math.min(Math.ceil(clipboard.end * sampleRate), srcWave.length)
    const segment = new Float32Array(srcWave.buffer, srcWave.byteOffset + s0 * 4, s1 - s0)
    const blob = encodeWAV(segment, sampleRate)
    const src = URL.createObjectURL(blob)
    const id = `paste-${Date.now()}`
    const segDur = clipboard.end - clipboard.start
    const color = EXTRA_COLORS[extraTracksRef.current.length % EXTRA_COLORS.length]
    const pasteAt = currentTimeRef.current
    setExtraTracks(p => [...p, { id, name: `Copie ${fmtTime(clipboard.start)}–${fmtTime(clipboard.end)}`, color, src, duration: segDur, waveData: segment, volume: 0.8, muted: false }])
    setClips(p => ({ ...p, [id]: { offset: pasteAt, selection: null, cuts: [] } }))
    extraWaveRefs.current.set(id, segment)
    setTimeout(() => {
      const canvas = extraCanvasRefs.current.get(id)
      if (canvas) drawWave(canvas, segment, color, [], segDur, pxPerSecRef.current)
    }, 80)
  }, [clipboard])

  /* ── Global drag handler ───────────────────────────── */
  useEffect(() => {
    const getTimeAtClientX = (clientX: number) => {
      const el = scrollRef.current; if (!el) return 0
      return Math.max(0, (clientX - el.getBoundingClientRect().left + el.scrollLeft) / pxPerSecRef.current)
    }
    const onMove = (e: MouseEvent) => {
      const drag = dragRef.current
      if (drag) {
        const t = getTimeAtClientX(e.clientX)
        if (drag.type === 'move') {
          const dt = t - getTimeAtClientX(drag.startClientX)
          setClips(p => ({ ...p, [drag.trackId]: { ...p[drag.trackId], offset: Math.max(0, drag.startOffset + dt) } }))
        } else {
          const off = clipsRef.current[drag.trackId]?.offset ?? 0
          const et = extraTracksRef.current.find(e2 => e2.id === drag.trackId)
          const clipDur = drag.trackId === 'main' ? durationRef.current : drag.trackId === 'instrumental' || drag.trackId === 'vocals' ? stemDurRef.current : (et?.duration ?? 0)
          const localT = Math.max(0, Math.min(clipDur, t - off))
          setClips(p => ({
            ...p,
            [drag.trackId]: { ...p[drag.trackId], selection: { start: Math.min(drag.startLocalTime, localT), end: Math.max(drag.startLocalTime, localT) } },
          }))
        }
      }
      const rd = resizeDragRef.current
      if (rd) {
        setLibWidth(Math.max(120, Math.min(360, rd.startSize + (e.clientX - rd.startPos))))
      }
      const wd = winDragRef.current
      if (wd) {
        setFloatWin(p => p ? { ...p, x: wd.startWx + (e.clientX - wd.startX), y: wd.startWy + (e.clientY - wd.startY) } : p)
      }
      const wr = winResizeRef.current
      if (wr) {
        const dx = e.clientX - wr.startX, dy = e.clientY - wr.startY
        setFloatWin(p => {
          if (!p) return p
          let { x, y, w, h } = { x: wr.startWx, y: wr.startWy, w: wr.startW, h: wr.startH }
          if (wr.dir.includes('e')) w = Math.max(320, wr.startW + dx)
          if (wr.dir.includes('s')) h = Math.max(180, wr.startH + dy)
          if (wr.dir.includes('w')) { w = Math.max(320, wr.startW - dx); x = wr.startWx + (wr.startW - w) }
          if (wr.dir.includes('n')) { h = Math.max(180, wr.startH - dy); y = wr.startWy + (wr.startH - h) }
          return { ...p, x, y, w, h }
        })
      }
    }
    const onUp = () => {
      const drag = dragRef.current
      if (drag?.type === 'select') {
        const tid = drag.trackId
        setClips(p => {
          const sel = p[tid]?.selection
          if (!sel || sel.end - sel.start < 0.01) return { ...p, [tid]: { ...p[tid], selection: null } }
          return p
        })
      }
      dragRef.current = null; resizeDragRef.current = null
      winDragRef.current = null; winResizeRef.current = null
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
  }, [])

  /* ── Ctrl+Scroll = zoom ────────────────────────────── */
  useEffect(() => {
    const el = scrollRef.current; if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      setZoom(p => Math.max(0.15, Math.min(10, p * (e.deltaY < 0 ? 1.12 : 0.89))))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  /* ── Keyboard shortcuts ────────────────────────────── */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      const activeId = Object.entries(clipsRef.current).find(([, c]) => c.selection)?.[0] ?? 'main'
      switch (e.code) {
        case 'Space':   e.preventDefault(); togglePlay(); break
        case 'Escape':  stopPlayback(); break
        case 'Delete': case 'Backspace':
          if (clipsRef.current[activeId]?.selection) { e.preventDefault(); cutSelection(activeId) }; break
        case 'KeyA':  if (e.ctrlKey||e.metaKey) { e.preventDefault()
          const dur = activeId === 'main' ? durationRef.current : activeId === 'instrumental' || activeId === 'vocals' ? stemDurRef.current : (extraTracksRef.current.find(t => t.id === activeId)?.duration ?? 0)
          setClips(p => ({ ...p, [activeId]: { ...p[activeId], selection: { start: 0, end: dur } } }))
        }; break
        case 'KeyC': if (e.ctrlKey||e.metaKey) { e.preventDefault(); copySelection(activeId) }; break
        case 'KeyX': if (e.ctrlKey||e.metaKey) { e.preventDefault(); cutSelection(activeId) }; break
        case 'KeyV': if (e.ctrlKey||e.metaKey) { e.preventDefault(); pasteClipboard() } else setTool('move'); break
        case 'KeyZ': if (e.ctrlKey||e.metaKey) {
          e.preventDefault()
          const undoId = Object.entries(clipsRef.current).find(([, c]) => c.selection)?.[0] ?? lastCutTrackRef.current
          setClips(p => ({ ...p, [undoId]: { ...p[undoId], cuts: p[undoId].cuts.slice(0, -1) } }))
        }; break
        case 'KeyL': if (!e.ctrlKey) setLoopEnabled(p => !p); break
        case 'KeyM': setChannels(p => p.map(c => c.id === 'main' ? { ...c, muted: !c.muted } : c)); break
        case 'KeyS': if (!e.ctrlKey) setTool('select'); break
        case 'Home': seek(0); break
        case 'End':  seek(durationRef.current); break
        case 'ArrowLeft':  e.preventDefault(); seek(currentTime - (e.shiftKey ? 10 : 2)); break
        case 'ArrowRight': e.preventDefault(); seek(currentTime + (e.shiftKey ? 10 : 2)); break
        case 'Equal': if (e.ctrlKey) { e.preventDefault(); setZoom(p => Math.min(p * 1.5, 10)) }; break
        case 'Minus': if (e.ctrlKey) { e.preventDefault(); setZoom(p => Math.max(p / 1.5, 0.15)) }; break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [togglePlay, stopPlayback, cutSelection, copySelection, pasteClipboard, restoreAll, seek, currentTime])

  /* ── Helpers ───────────────────────────────────────── */
  const updateEQ = (i: number, gain: number) => setEq(p => p.map((b, j) => j === i ? { ...b, gain } : b))
  const resetEQ  = () => setEq(DEFAULT_EQ)
  const setFx = <K extends keyof EffectParams>(key: K, patch: Partial<EffectParams[K]>) =>
    setEffectParams(p => ({ ...p, [key]: { ...p[key], ...patch } }))
  const toggleSolo = (id: string) =>
    setChannels(p => p.map(c => ({ ...c, solo: c.id === id ? !c.solo : false })))

  const openPanel = (tab: 'mixer' | 'eq' | 'effects') => {
    const mobile = window.innerWidth < 768
    setFloatWin(p => p
      ? { ...p, tab, minimized: false }
      : {
          tab,
          x: mobile ? 0 : 180,
          y: mobile ? Math.max(0, window.innerHeight - 300) : 80,
          w: mobile ? window.innerWidth : 660,
          h: 300,
          minimized: false,
        }
    )
  }

  /* ── Track rows ────────────────────────────────────── */
  const trackRows = [
    { id: 'main',         name: 'Original', color: '#4f8ef7', canvasRef: mainCanvasRef,   clipDur: duration,           ready: true,       loading: !mainWaveRef.current && !!currentTrack },
    { id: 'instrumental', name: 'Musique',  color: '#2eb872', canvasRef: instrCanvasRef,  clipDur: stemDurRef.current, ready: stemsReady, loading: separating },
    { id: 'vocals',       name: 'Voix',     color: '#9b59e2', canvasRef: vocalsCanvasRef, clipDur: stemDurRef.current, ready: stemsReady, loading: separating },
    ...extraTracks.map(t => ({
      id: t.id, name: t.name, color: t.color,
      canvasRef: { current: extraCanvasRefs.current.get(t.id) ?? null } as React.RefObject<HTMLCanvasElement | null>,
      clipDur: t.duration, ready: t.duration > 0, loading: false, isExtra: true,
    })),
  ]

  return (
    <div className="flex flex-col fade-in relative" style={{ minHeight: 'calc(105vh - 96px)', background: '#141414', fontFamily: 'monospace' }}>
      <audio ref={audioRef} onLoadedMetadata={e => setDuration((e.target as HTMLAudioElement).duration)} />
      <audio ref={vocalsAudioRef} loop />
      <audio ref={instrAudioRef} loop />
      {/* Extra track audio elements */}
      {extraTracks.map(t => (
        <audio key={t.id} src={t.src} loop
          ref={el => { if (el) extraAudioRefs.current.set(t.id, el); else extraAudioRefs.current.delete(t.id) }} />
      ))}

      {/* ═══ TOOLBAR ═══════════════════════════════════════════════════ */}
      <div className="shrink-0 flex items-center gap-2 px-3 border-b overflow-x-auto" style={{ height: 44, background: '#242424', borderColor: '#333', minWidth: 0 }}>
        <button onClick={() => setShowLibrary(p => !p)} className="px-2 py-1 rounded text-xs" style={{ background: showLibrary ? '#3a3a3a' : 'transparent', color: '#aaa' }}><Music2 size={14} /></button>
        <div className="w-px h-6" style={{ background: '#333' }} />
        <button onClick={() => seek(0)} className="p-1.5 rounded hover:bg-white/10" style={{ color: '#aaa' }}><SkipBack size={14} /></button>
        <button onClick={stopPlayback} className="p-1.5 rounded hover:bg-white/10" style={{ color: '#aaa' }}><Square size={14} /></button>
        <button onClick={togglePlay} className="w-9 h-9 rounded flex items-center justify-center" style={{ background: isPlaying ? '#f0a830' : '#2eb872', color: '#000' }}>
          {isPlaying ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}
        </button>
        <button onClick={() => setLoopEnabled(p => !p)} className="p-1.5 rounded" style={{ color: loopEnabled ? '#f0a830' : '#666', background: loopEnabled ? 'rgba(240,168,48,0.15)' : 'transparent' }}><Repeat size={14} /></button>
        <div className="w-px h-6" style={{ background: '#333' }} />
        <div className="px-2 py-1 rounded text-sm tabular-nums" style={{ background: '#0a0a0a', color: '#4f8ef7', minWidth: 64, textAlign: 'center' }}>{fmtTime(currentTime)}</div>
        <span className="text-xs" style={{ color: '#444' }}>/</span>
        <div className="text-xs tabular-nums" style={{ color: '#555' }}>{fmtTime(duration)}</div>
        <div className="w-px h-6" style={{ background: '#333' }} />
        <div className="flex items-center gap-1">
          <span className="text-xs" style={{ color: '#555' }}>{t('toolbar_bpm_label')}</span>
          {detectingBpm
            ? <div className="w-14 flex items-center justify-center"><Loader2 size={12} className="animate-spin" style={{ color: '#f0a830' }} /></div>
            : <input type="number" value={bpm} min={40} max={300} onChange={e => setBpm(Number(e.target.value))}
                className="w-14 px-1 py-0.5 rounded text-xs tabular-nums text-center outline-none"
                style={{ background: '#0a0a0a', color: '#f0a830', border: '1px solid #333' }} />
          }
        </div>
        <div className="w-px h-6" style={{ background: '#333' }} />
        <div className="flex rounded overflow-hidden border" style={{ borderColor: '#333' }}>
          <button onClick={() => setTool('select')} title={t('shortcut_select_tool')} className="px-2 py-1.5 flex items-center transition-colors"
            style={{ background: tool === 'select' ? '#3a3a3a' : 'transparent', color: tool === 'select' ? '#ddd' : '#555' }}><MousePointer size={12} /></button>
          <button onClick={() => setTool('move')} title={t('shortcut_move_tool')} className="px-2 py-1.5 flex items-center transition-colors"
            style={{ background: tool === 'move' ? '#3a3a3a' : 'transparent', color: tool === 'move' ? '#ddd' : '#555' }}><Move size={12} /></button>
        </div>
        <div className="w-px h-6" style={{ background: '#333' }} />
        {(['main', 'instrumental', 'vocals', ...extraTracks.map(t => t.id)] as string[]).map(id => {
          const clip = clips[id]
          return clip?.selection ? (
            <div key={id} className="flex items-center gap-1">
              <span className="text-[9px] px-1 rounded" style={{ background: '#2a2a2a', color: '#666' }}>
                {id === 'main' ? 'Orig' : id === 'instrumental' ? 'Mus' : id === 'vocals' ? 'Voix' : (extraTracks.find(t => t.id === id)?.name ?? id).slice(0, 4)}
              </span>
              <button onClick={() => cutSelection(id)} className="p-1.5 rounded hover:bg-white/10" style={{ color: '#aaa' }}><Scissors size={13} /></button>
              <button onClick={() => copySelection(id)} className="p-1.5 rounded hover:bg-white/10" style={{ color: '#aaa' }}><Copy size={13} /></button>
              <button onClick={() => restoreAll(id)} className="p-1.5 rounded hover:bg-white/10" style={{ color: '#aaa' }}><RotateCcw size={13} /></button>
            </div>
          ) : null
        })}
        <div className="w-px h-6" style={{ background: '#333' }} />
        <button onClick={() => setZoom(p => Math.min(p * 1.4, 10))} className="p-1.5 rounded hover:bg-white/10" style={{ color: '#aaa' }}><ZoomIn size={14} /></button>
        <div className="text-xs tabular-nums" style={{ color: '#444', minWidth: 28 }}>{zoom.toFixed(1)}x</div>
        <button onClick={() => setZoom(p => Math.max(p / 1.4, 0.15))} className="p-1.5 rounded hover:bg-white/10" style={{ color: '#aaa' }}><ZoomOut size={14} /></button>
        <div className="flex-1" />
        <div className="flex items-center gap-1.5">
          <span className="text-xs" style={{ color: '#555' }}>×</span>
          <input type="range" min={0.5} max={2} step={0.05} value={playbackRate} onChange={e => setPlaybackRate(Number(e.target.value))} className="w-20 accent-orange-400" />
          <span className="text-xs w-8 tabular-nums" style={{ color: '#888' }}>{playbackRate.toFixed(2)}</span>
        </div>
        <div className="w-px h-6" style={{ background: '#333' }} />
        <button onClick={() => setShowExportModal(true)} className="flex items-center gap-1 px-2 py-1.5 rounded text-xs hover:bg-white/10" style={{ color: '#2eb872' }}><Download size={12} /><span>{t('btn_export')}</span></button>
        <div className="w-px h-6" style={{ background: '#333' }} />
        <button onClick={() => openPanel(floatWin?.tab ?? 'mixer')} className="p-1.5 rounded hover:bg-white/10" style={{ color: floatWin ? '#f0a830' : '#666' }}><Activity size={14} /></button>
        <button onClick={() => setShowShortcuts(p => !p)} className="p-1.5 rounded hover:bg-white/10" style={{ color: '#666' }}><Keyboard size={14} /></button>
      </div>

      {/* ═══ MAIN AREA ══════════════════════════════════════════════════ */}
      <div className="flex flex-1 min-h-0 relative">

        {/* ── Library sidebar ─────────────────────────────────────── */}
        {showLibrary && (
          <div className="fixed inset-0 z-30 md:hidden" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={() => setShowLibrary(false)} />
        )}
        {showLibrary && (
          <div className="fixed inset-y-0 left-0 z-40 md:relative md:inset-auto md:z-auto shrink-0 flex" style={{ width: libWidth }}>
            <div className="flex flex-col border-r overflow-y-auto w-full" style={{ background: '#1a1a1a', borderColor: '#2e2e2e' }}
              onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' }}
              onDrop={e => {
                e.preventDefault()
                const tid = e.dataTransfer.getData('trackId')
                const tname = e.dataTransfer.getData('trackTitle')
                if (tid && workspace) {
                  const t = libTracks.find(lt => lt.id === tid)
                  if (t) addExtraTrackFromLibrary(t)
                } else {
                  Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('audio/')).forEach(addExtraTrackFromFile)
                }
                void tname
              }}>
              <div className="px-3 py-2 text-xs font-bold uppercase tracking-wider shrink-0" style={{ color: '#555', borderBottom: '1px solid #2e2e2e' }}>{t('library_sidebar_title')}</div>
              <div className="mx-2 my-2 rounded border-2 border-dashed flex flex-col items-center justify-center gap-1 cursor-pointer py-3 text-center hover:border-blue-600/50"
                style={{ borderColor: '#2e2e2e', color: '#444' }}
                onClick={() => document.getElementById('studio-file-input')?.click()}>
                <Wand2 size={16} className="mb-1" />
                <p className="text-[10px]">{t('btn_import_file')}</p>
                <input id="studio-file-input" type="file" accept="audio/*" className="hidden"
                  onChange={e => {
                    const file = e.target.files?.[0]; if (!file || !audioRef.current) return
                    audioRef.current.src = URL.createObjectURL(file); audioRef.current.loop = false
                    ctxRef.current = null; eqNodesRef.current = []
                    setIsPlaying(false); setCurrentTime(0); setDuration(0); setCurrentTrack(null)
                    setStemsReady(false); setStemError(null); mainWaveRef.current = null; setClips(INIT_CLIPS)
                    setDetectingBpm(true)
                    file.arrayBuffer().then(async ab => {
                      const tmp = new AudioContext(); const buf = await tmp.decodeAudioData(ab); tmp.close()
                      mainWaveRef.current = buf.getChannelData(0); setDuration(buf.duration)
                      if (mainCanvasRef.current) drawWave(mainCanvasRef.current, mainWaveRef.current!, '#4f8ef7', [], buf.duration, pxPerSecRef.current)
                      // BPM detection runs off the main thread after a tick to avoid blocking paint
                      setTimeout(() => {
                        try { setBpm(detectBpm(buf)) } catch { /* ignore */ } finally { setDetectingBpm(false) }
                      }, 0)
                    }).catch(() => { setDetectingBpm(false) })
                  }}
                />
              </div>
              <div className="mx-2 mb-2 rounded border-2 border-dashed flex flex-col items-center justify-center gap-1 cursor-pointer py-2 text-center hover:border-green-600/50"
                style={{ borderColor: '#2a2a2a', color: '#444', fontSize: 10 }}
                onClick={() => document.getElementById('extra-file-input')?.click()}>
                <Plus size={12} /> {t('btn_add_track')}
                <input id="extra-file-input" type="file" accept="audio/*" multiple className="hidden"
                  onChange={e => { Array.from(e.target.files ?? []).forEach(addExtraTrackFromFile) }} />
              </div>
              {loadingLib
                ? <div className="flex justify-center py-4"><Loader2 size={14} className="animate-spin" style={{ color: '#555' }} /></div>
                : libTracks.length === 0
                  ? <p className="text-[10px] text-center py-4" style={{ color: '#444' }}>{t('library_empty')}</p>
                  : libTracks.map(track => (
                    <div key={track.id} draggable
                      onDragStart={e => { e.dataTransfer.setData('trackId', track.id); e.dataTransfer.setData('trackTitle', track.title) }}>
                      <button onClick={() => loadTrack(track)}
                        className="flex items-start gap-1.5 px-3 py-1.5 text-left text-xs w-full truncate"
                        style={{ background: currentTrack?.id === track.id ? '#2a2a2a' : 'transparent', color: currentTrack?.id === track.id ? '#4f8ef7' : '#666', borderLeft: currentTrack?.id === track.id ? '2px solid #4f8ef7' : '2px solid transparent' }}>
                        <Music2 size={10} className="mt-0.5 shrink-0" style={{ color: '#444' }} />
                        <div className="truncate">
                          <p className="truncate">{track.title}</p>
                          {track.artist && <p className="truncate text-[9px]" style={{ color: '#444' }}>{track.artist}</p>}
                        </div>
                      </button>
                    </div>
                  ))
              }
            </div>
            {/* Resize handle */}
            <div className="absolute right-0 top-0 bottom-0 flex items-center justify-center" style={{ width: 6, cursor: 'col-resize', zIndex: 10 }}
              onMouseDown={e => { resizeDragRef.current = { type: 'lib', startPos: e.clientX, startSize: libWidth }; e.preventDefault() }}>
              <div style={{ width: 2, height: 32, borderRadius: 2, background: '#2e2e2e' }} />
            </div>
          </div>
        )}

        {/* ── Workspace ───────────────────────────────────────────── */}
        <div className="flex flex-col flex-1 min-w-0">
          <div className="flex flex-1 min-h-0">

            {/* Fixed track headers */}
            <div className="shrink-0 flex flex-col w-20 md:w-36" style={{ background: '#1e1e1e', borderRight: '1px solid #2e2e2e', zIndex: 5 }}>
              <div style={{ height: 28, background: '#1a1a1a', borderBottom: '1px solid #2e2e2e' }} />
              {trackRows.map(tr => {
                const ch = channels.find(c => c.id === tr.id)
                const isExtraRow = !['main','instrumental','vocals'].includes(tr.id)
                const extraTrack = extraTracks.find(t => t.id === tr.id)
                const muted = ch ? ch.muted : (extraTrack?.muted ?? false)
                const vol   = ch ? ch.volume : (extraTrack?.volume ?? 0.8)
                const clip  = clips[tr.id]
                return (
                  <div key={tr.id} className="flex flex-col justify-between px-2 py-1.5 border-b" style={{ height: 80, borderColor: '#202020', borderLeft: `3px solid ${tr.color}` }}>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold truncate flex-1 mr-1" style={{ color: tr.color }}>{tr.name}</span>
                      <div className="flex gap-1">
                        {!isExtraRow && ch && (
                          <button onClick={() => toggleSolo(tr.id)}
                            className="hidden md:flex w-4 h-4 rounded text-[9px] font-bold items-center justify-center"
                            style={{ background: ch.solo ? '#f0a830' : '#2a2a2a', color: ch.solo ? '#000' : '#666' }}>S</button>
                        )}
                        <button onClick={() => {
                          if (isExtraRow) setExtraTracks(p => p.map(t => t.id === tr.id ? { ...t, muted: !t.muted } : t))
                          else setChannels(p => p.map(c => c.id === tr.id ? { ...c, muted: !c.muted } : c))
                        }} className="w-4 h-4 rounded text-[9px] font-bold flex items-center justify-center"
                          style={{ background: muted ? '#e74c3c' : '#2a2a2a', color: muted ? '#fff' : '#666' }}>M</button>
                        {isExtraRow && (
                          <button onClick={() => removeExtraTrack(tr.id)} className="w-4 h-4 rounded text-[9px] flex items-center justify-center hover:bg-red-900/30" style={{ color: '#555' }}><X size={8} /></button>
                        )}
                      </div>
                    </div>
                    <div className="hidden md:flex items-center gap-1.5">
                      {muted ? <VolumeX size={10} style={{ color: '#e74c3c' }} /> : <Volume1 size={10} style={{ color: '#555' }} />}
                      <input type="range" min={0} max={1} step={0.01} value={vol}
                        onChange={e => {
                          if (isExtraRow) setExtraTracks(p => p.map(t => t.id === tr.id ? { ...t, volume: Number(e.target.value) } : t))
                          else setChannels(p => p.map(c => c.id === tr.id ? { ...c, volume: Number(e.target.value) } : c))
                        }}
                        className="flex-1" style={{ accentColor: tr.color, height: '3px' }} />
                      <span className="text-[9px] tabular-nums" style={{ color: '#444', minWidth: 24 }}>{Math.round(vol * 100)}</span>
                    </div>
                    <div className="hidden md:flex items-center gap-1 h-4">
                      {tr.id !== 'main' && !isExtraRow && separating && <><Loader2 size={9} className="animate-spin" style={{ color: '#f0a830' }} /><span className="text-[9px]" style={{ color: '#888' }}>{t('track_separating')}</span></>}
                      {clip?.selection && <span className="text-[8px] tabular-nums" style={{ color: '#f0a830' }}>{fmtTime(clip.selection.start)}–{fmtTime(clip.selection.end)}</span>}
                    </div>
                  </div>
                )
              })}
              {/* Add track row */}
              <div className="px-2 py-2 border-b" style={{ borderColor: '#202020' }}>
                <button
                  onDragOver={e => { e.preventDefault(); setDragOverTracks(true) }}
                  onDragLeave={() => setDragOverTracks(false)}
                  onDrop={e => {
                    e.preventDefault(); setDragOverTracks(false)
                    const tid = e.dataTransfer.getData('trackId')
                    if (tid && workspace) { const t = libTracks.find(lt => lt.id === tid); if (t) addExtraTrackFromLibrary(t) }
                    else Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('audio/')).forEach(addExtraTrackFromFile)
                  }}
                  onClick={() => document.getElementById('extra-file-input')?.click()}
                  className="w-full flex items-center justify-center gap-1 py-2 rounded border border-dashed text-[9px] transition-colors"
                  style={{ borderColor: dragOverTracks ? '#2eb872' : '#252525', color: dragOverTracks ? '#2eb872' : '#444' }}>
                  <Plus size={10} /> {dragOverTracks ? t('btn_drop_here') : t('btn_add_track')}
                </button>
              </div>
            </div>

            {/* Scrollable timeline */}
            <div ref={scrollRef} className="flex-1 overflow-x-auto overflow-y-hidden relative" style={{ background: '#141414' }}
              onDragOver={e => { e.preventDefault() }}
              onDrop={e => {
                e.preventDefault()
                const tid = e.dataTransfer.getData('trackId')
                if (tid && workspace) { const t = libTracks.find(lt => lt.id === tid); if (t) addExtraTrackFromLibrary(t) }
                else Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('audio/')).forEach(addExtraTrackFromFile)
              }}>
              <div style={{ position: 'relative', width: contentWidth, minHeight: '100%' }}>
                {/* Ruler */}
                <canvas ref={rulerCanvasRef}
                  style={{ display: 'block', height: 28, cursor: 'pointer', borderBottom: '1px solid #2e2e2e', position: 'sticky', top: 0, zIndex: 4 }}
                  onClick={e => {
                    const r = scrollRef.current!.getBoundingClientRect()
                    seek((e.clientX - r.left + scrollRef.current!.scrollLeft) / pxPerSec)
                  }}
                />
                {/* Track rows */}
                {trackRows.map(tr => {
                  const clip = clips[tr.id]
                  const clipW = tr.clipDur * pxPerSec
                  const clipL = (clip?.offset ?? 0) * pxPerSec
                  return (
                    <div key={tr.id} style={{ height: 80, position: 'relative', borderBottom: '1px solid #202020', background: '#141414' }}>
                      <div style={{ position: 'absolute', inset: 0, cursor: 'pointer' }}
                        onClick={e => {
                          if (dragRef.current) return
                          const r = scrollRef.current!.getBoundingClientRect()
                          seek((e.clientX - r.left + scrollRef.current!.scrollLeft) / pxPerSec)
                        }} />
                      {tr.clipDur > 0 && (
                        <div style={{ position: 'absolute', left: clipL, width: clipW, top: 0, bottom: 0 }}>
                          <div style={{ height: 14, background: tr.color + '28', borderTop: `2px solid ${tr.color}`, cursor: 'grab', userSelect: 'none', display: 'flex', alignItems: 'center', paddingLeft: 4 }}
                            onMouseDown={e => {
                              e.stopPropagation(); e.preventDefault()
                              dragRef.current = { type: 'move', trackId: tr.id, startClientX: e.clientX, startLocalTime: 0, startOffset: clip?.offset ?? 0 }
                            }}>
                            <span style={{ fontSize: 9, color: tr.color }}>{tr.name} @ {fmtTime(clip?.offset ?? 0)}</span>
                          </div>
                          <div style={{ position: 'relative', height: 'calc(100% - 14px)', cursor: tool === 'move' ? 'grab' : 'crosshair' }}
                            onMouseDown={e => {
                              e.stopPropagation()
                              const r = scrollRef.current!.getBoundingClientRect()
                              const t = (e.clientX - r.left + scrollRef.current!.scrollLeft) / pxPerSecRef.current
                              if (toolRef.current === 'move') {
                                dragRef.current = { type: 'move', trackId: tr.id, startClientX: e.clientX, startLocalTime: 0, startOffset: clip?.offset ?? 0 }
                              } else {
                                const localT = Math.max(0, Math.min(tr.clipDur, t - (clip?.offset ?? 0)))
                                seek(t)
                                setClips(p => ({ ...p, [tr.id]: { ...p[tr.id], selection: { start: localT, end: localT } } }))
                                dragRef.current = { type: 'select', trackId: tr.id, startClientX: e.clientX, startLocalTime: localT, startOffset: clip?.offset ?? 0 }
                              }
                            }}>
                            <canvas ref={!['main','instrumental','vocals'].includes(tr.id) ? (el => { if (el) extraCanvasRefs.current.set(tr.id, el) }) : tr.canvasRef}
                              style={{ display: 'block', width: '100%', height: '100%', pointerEvents: 'none' }} />
                            {clip?.selection && tr.clipDur > 0 && clip.selection.end > clip.selection.start && (
                              <>
                                <div style={{ position: 'absolute', top: 0, bottom: 0, background: 'rgba(240,168,48,0.13)', pointerEvents: 'none',
                                  left: `${(clip.selection.start / tr.clipDur) * 100}%`, width: `${((clip.selection.end - clip.selection.start) / tr.clipDur) * 100}%` }} />
                                <div style={{ position: 'absolute', top: 0, bottom: 0, width: 1, background: 'rgba(240,168,48,0.8)', pointerEvents: 'none', left: `${(clip.selection.start / tr.clipDur) * 100}%` }} />
                                <div style={{ position: 'absolute', top: 0, bottom: 0, width: 1, background: 'rgba(240,168,48,0.8)', pointerEvents: 'none', left: `${(clip.selection.end / tr.clipDur) * 100}%` }} />
                              </>
                            )}
                            {tr.loading && (
                              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.55)' }}>
                                <Loader2 size={16} className="animate-spin" style={{ color: tr.color }} />
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                      {tr.clipDur <= 0 && !['main'].includes(tr.id) && !separating && (
                        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', paddingLeft: 8, pointerEvents: 'none' }}>
                          <span style={{ fontSize: 10, color: '#2a2a2a' }}>{t('track_waiting')}</span>
                        </div>
                      )}
                    </div>
                  )
                })}
                {/* Global playhead */}
                <div style={{ position: 'absolute', top: 0, bottom: 0, width: 1, background: 'rgba(255,255,255,0.85)', left: currentTime * pxPerSec, zIndex: 10, pointerEvents: 'none' }}>
                  <div style={{ position: 'absolute', top: 28, left: -4, width: 9, height: 9, background: 'white', clipPath: 'polygon(50% 100%, 0 0, 100% 0)' }} />
                </div>
              </div>
            </div>
          </div>

          {/* ── Bottom panel removed – now floating window below ─── */}
        </div>
      </div>

      {/* ═══ FLOATING PANEL WINDOW ══════════════════════════════════════ */}
      {floatWin && (
        <div style={{
          position: 'fixed', left: floatWin.x, top: floatWin.y,
          width: floatWin.w, height: floatWin.minimized ? 34 : floatWin.h,
          zIndex: 200, display: 'flex', flexDirection: 'column',
          background: '#1e1e1e', border: '1px solid #3a3a3a',
          borderRadius: 6, overflow: 'hidden',
          boxShadow: '0 8px 32px rgba(0,0,0,0.7)',
          minWidth: 320, minHeight: floatWin.minimized ? 34 : 180,
          maxWidth: '100vw', maxHeight: '90vh',
        }}>
          {/* ── Title bar / tab bar ── */}
          <div className="flex items-center gap-0 shrink-0 select-none"
            style={{ height: 34, background: '#242424', borderBottom: floatWin.minimized ? 'none' : '1px solid #2e2e2e', cursor: 'grab', userSelect: 'none' }}
            onMouseDown={e => {
              if ((e.target as HTMLElement).closest('button')) return
              winDragRef.current = { startX: e.clientX, startY: e.clientY, startWx: floatWin.x, startWy: floatWin.y }
              e.preventDefault()
            }}>
            {/* Window controls */}
            <div className="flex items-center gap-1 px-2 shrink-0">
              <button onClick={() => setFloatWin(null)}
                style={{ width: 11, height: 11, borderRadius: '50%', background: '#ff5f57', border: 'none', cursor: 'pointer' }} />
              <button onClick={() => setFloatWin(p => p ? { ...p, minimized: !p.minimized } : p)}
                style={{ width: 11, height: 11, borderRadius: '50%', background: '#febc2e', border: 'none', cursor: 'pointer' }} />
              <button onClick={() => setFloatWin(p => p ? { ...p, w: 660, h: 280, minimized: false } : p)}
                style={{ width: 11, height: 11, borderRadius: '50%', background: '#28c840', border: 'none', cursor: 'pointer' }} />
            </div>
            {/* Tabs */}
            <div className="flex items-center h-full">
              {(['mixer', 'eq', 'effects'] as const).map(tab => (
                <button key={tab} onClick={() => setFloatWin(p => p ? { ...p, tab, minimized: false } : p)}
                  className="px-3 h-full text-xs"
                  style={{ color: floatWin.tab === tab ? '#e0e0e0' : '#555', background: 'transparent', cursor: 'pointer', border: 'none', borderBottom: floatWin.tab === tab ? '2px solid #f0a830' : '2px solid transparent' }}>
                  {tab === 'eq' ? t('float_tab_eq') : tab === 'effects' ? t('float_tab_effects') : t('float_tab_mixer')}
                </button>
              ))}
            </div>
          </div>

          {/* ── Content ── */}
          {!floatWin.minimized && (
            <div className="flex flex-1 min-h-0 overflow-hidden">

              {/* Mixer */}
              {floatWin.tab === 'mixer' && (
                <div className="flex flex-1 min-h-0 overflow-x-auto" style={{ background: '#1a1a1a' }}>
                  {(() => {
                    const main = channels.find(c => c.id === 'main')!
                    return (
                      <div className="flex flex-col items-center shrink-0 border-r relative" style={{ width: 56, background: '#1e1e1e', borderColor: '#111' }}>
                        <div style={{ width: 8, height: 8, borderRadius: '50%', marginTop: 6, background: !main.muted ? '#4CAF50' : '#1a1a1a', boxShadow: !main.muted ? '0 0 5px #4CAF50' : 'none' }} />
                        <div className="text-[8px] mt-0.5" style={{ color: '#2e8b57' }}>M</div>
                        <div className="mt-1.5"><PanKnob pan={main.pan} color="#4f8ef7" onChange={v => setChannels(p => p.map(c => c.id === 'main' ? { ...c, pan: v } : c))} /></div>
                        <div className="flex-1 flex flex-col items-center justify-center py-1 gap-1">
                          <input type="range" min={0} max={1.2} step={0.01} value={main.volume}
                            onChange={e => setChannels(p => p.map(c => c.id === 'main' ? { ...c, volume: Number(e.target.value) } : c))}
                            style={{ writingMode: 'vertical-lr', direction: 'rtl', height: 72, width: 18, accentColor: main.muted ? '#333' : '#4f8ef7', cursor: 'pointer' }} />
                          <span style={{ fontSize: 8, color: '#444' }}>{Math.round(main.volume * 100)}</span>
                        </div>
                        <div className="flex gap-0.5 mb-1">
                          <button onClick={() => setChannels(p => p.map(c => c.id === 'main' ? { ...c, muted: !c.muted } : c))}
                            style={{ width: 16, height: 14, fontSize: 8, fontWeight: 700, background: main.muted ? '#e74c3c' : '#252525', color: main.muted ? '#fff' : '#555', border: 'none', borderRadius: 2, cursor: 'pointer' }}>M</button>
                          <button onClick={() => toggleSolo('main')}
                            style={{ width: 16, height: 14, fontSize: 8, fontWeight: 700, background: main.solo ? '#f0a830' : '#252525', color: main.solo ? '#000' : '#555', border: 'none', borderRadius: 2, cursor: 'pointer' }}>S</button>
                        </div>
                        <div style={{ height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <span style={{ writingMode: 'vertical-lr', transform: 'rotate(180deg)', fontSize: 9, color: '#4f8ef7', maxHeight: 44, overflow: 'hidden' }}>{t('mixer_master_label')}</span>
                        </div>
                      </div>
                    )
                  })()}
                  {channels.filter(c => c.id !== 'main').map((ch, idx) => (
                    <div key={ch.id} className="flex flex-col items-center shrink-0 border-r" style={{ width: 52, background: '#1a1a1a', borderColor: '#111' }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', marginTop: 6, background: !ch.muted ? ch.color : '#1a1a1a', boxShadow: !ch.muted ? `0 0 4px ${ch.color}` : 'none' }} />
                      <div className="text-[8px] mt-0.5" style={{ color: '#3a3a3a' }}>{idx + 1}</div>
                      <div className="mt-1.5"><PanKnob pan={ch.pan} color={ch.color} onChange={v => setChannels(p => p.map(c => c.id === ch.id ? { ...c, pan: v } : c))} /></div>
                      <div className="flex-1 flex flex-col items-center justify-center py-1 gap-1">
                        <input type="range" min={0} max={1.2} step={0.01} value={ch.volume}
                          onChange={e => setChannels(p => p.map(c => c.id === ch.id ? { ...c, volume: Number(e.target.value) } : c))}
                          style={{ writingMode: 'vertical-lr', direction: 'rtl', height: 72, width: 18, accentColor: ch.muted ? '#333' : ch.color, cursor: 'pointer' }} />
                        <span style={{ fontSize: 8, color: '#444' }}>{Math.round(ch.volume * 100)}</span>
                      </div>
                      <div className="flex gap-0.5 mb-1">
                        <button onClick={() => setChannels(p => p.map(c => c.id === ch.id ? { ...c, muted: !c.muted } : c))}
                          style={{ width: 16, height: 14, fontSize: 8, fontWeight: 700, background: ch.muted ? '#e74c3c' : '#252525', color: ch.muted ? '#fff' : '#555', border: 'none', borderRadius: 2, cursor: 'pointer' }}>M</button>
                        <button onClick={() => toggleSolo(ch.id)}
                          style={{ width: 16, height: 14, fontSize: 8, fontWeight: 700, background: ch.solo ? '#f0a830' : '#252525', color: ch.solo ? '#000' : '#555', border: 'none', borderRadius: 2, cursor: 'pointer' }}>S</button>
                      </div>
                      <div style={{ height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <span style={{ writingMode: 'vertical-lr', transform: 'rotate(180deg)', fontSize: 9, color: ch.color, maxHeight: 44, overflow: 'hidden' }}>{ch.name}</span>
                      </div>
                    </div>
                  ))}
                  {extraTracks.map((et, idx) => (
                    <div key={et.id} className="flex flex-col items-center shrink-0 border-r" style={{ width: 52, background: '#1a1a1a', borderColor: '#111' }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', marginTop: 6, background: !et.muted ? et.color : '#1a1a1a', boxShadow: !et.muted ? `0 0 4px ${et.color}` : 'none' }} />
                      <div className="text-[8px] mt-0.5" style={{ color: '#3a3a3a' }}>{channels.length - 1 + idx + 1}</div>
                      <div className="mt-1.5"><div style={{ width: 28, height: 28 }} /></div>
                      <div className="flex-1 flex flex-col items-center justify-center py-1 gap-1">
                        <input type="range" min={0} max={1.2} step={0.01} value={et.volume}
                          onChange={e => setExtraTracks(p => p.map(t => t.id === et.id ? { ...t, volume: Number(e.target.value) } : t))}
                          style={{ writingMode: 'vertical-lr', direction: 'rtl', height: 72, width: 18, accentColor: et.muted ? '#333' : et.color, cursor: 'pointer' }} />
                        <span style={{ fontSize: 8, color: '#444' }}>{Math.round(et.volume * 100)}</span>
                      </div>
                      <div className="flex gap-0.5 mb-1">
                        <button onClick={() => setExtraTracks(p => p.map(t => t.id === et.id ? { ...t, muted: !t.muted } : t))}
                          style={{ width: 16, height: 14, fontSize: 8, fontWeight: 700, background: et.muted ? '#e74c3c' : '#252525', color: et.muted ? '#fff' : '#555', border: 'none', borderRadius: 2, cursor: 'pointer' }}>M</button>
                        <button onClick={() => removeExtraTrack(et.id)}
                          style={{ width: 16, height: 14, fontSize: 8, background: '#252525', color: '#555', border: 'none', borderRadius: 2, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><X size={8} /></button>
                      </div>
                      <div style={{ height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <span style={{ writingMode: 'vertical-lr', transform: 'rotate(180deg)', fontSize: 9, color: et.color, maxHeight: 44, overflow: 'hidden' }}>{et.name}</span>
                      </div>
                    </div>
                  ))}
                  <div className="flex flex-col gap-2 px-3 py-2 ml-2 shrink-0" style={{ borderLeft: '1px solid #222', minWidth: 160 }}>
                    <span className="text-[9px] uppercase" style={{ color: '#333' }}>{t('mixer_offset_label')}</span>
                    {trackRows.map(tr => (
                      <div key={tr.id} className="flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-sm shrink-0" style={{ background: tr.color }} />
                        <span className="text-[9px] w-14 truncate" style={{ color: '#555' }}>{tr.name}</span>
                        <input type="number" min={0} step={0.1} value={(clips[tr.id]?.offset ?? 0).toFixed(1)}
                          onChange={e => setClips(p => ({ ...p, [tr.id]: { ...p[tr.id], offset: Math.max(0, Number(e.target.value)) } }))}
                          className="w-14 px-1 py-0.5 rounded text-[9px] outline-none"
                          style={{ background: '#0a0a0a', color: '#ddd', border: '1px solid #252525' }} />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* EQ */}
              {floatWin.tab === 'eq' && (
                <div className="flex-1 min-h-0">
                  <EQCanvas bands={eq} onChange={updateEQ} onReset={resetEQ} />
                </div>
              )}

              {/* Effects */}
              {floatWin.tab === 'effects' && (
                <div className="flex flex-1 min-h-0 px-2 py-2 gap-2 overflow-x-auto">
                  {([
                    { key: 'reverb'     as const, label: 'Reverb',    color: '#7c3aed', rows: [['Wet','wet',0,1,0.01,(v:number)=>`${Math.round(v*100)}%`],['Decay','decay',0.5,6,0.1,(v:number)=>`${v.toFixed(1)}s`]] },
                    { key: 'delay'      as const, label: 'Delay',     color: '#2563eb', rows: [['Time','time',0.05,1,0.01,(v:number)=>`${Math.round(v*1000)}ms`],['Feedback','feedback',0,0.9,0.01,(v:number)=>`${Math.round(v*100)}%`],['Wet','wet',0,1,0.01,(v:number)=>`${Math.round(v*100)}%`]] },
                    { key: 'compressor' as const, label: 'Compressor',color: '#059669', rows: [['Threshold','threshold',-60,0,1,(v:number)=>`${v}dB`],['Ratio','ratio',1,20,0.5,(v:number)=>`${v}:1`]] },
                    { key: 'distortion' as const, label: 'Distortion',color: '#dc2626', rows: [['Amount','amount',1,100,1,(v:number)=>`${v}`],['Wet','wet',0,1,0.01,(v:number)=>`${Math.round(v*100)}%`]] },
                    { key: 'chorus'     as const, label: 'Chorus',    color: '#db2777', rows: [['Rate','rate',0.1,8,0.1,(v:number)=>`${v.toFixed(1)}Hz`],['Depth','depth',0.05,1,0.01,(v:number)=>`${Math.round(v*100)}%`],['Wet','wet',0,1,0.01,(v:number)=>`${Math.round(v*100)}%`]] },
                  ] as const).map(fx => {
                    const enabled = effectParams[fx.key].enabled
                    return (
                      <div key={fx.key} className="flex-1 rounded flex flex-col shrink-0 min-w-[120px]" style={{ background: '#1e1e1e', border: `1px solid ${enabled ? fx.color + '55' : '#2a2a2a'}` }}>
                        <div className="flex items-center justify-between px-2.5 py-1.5 border-b shrink-0" style={{ borderColor: enabled ? fx.color + '30' : '#222' }}>
                          <div className="flex items-center gap-1.5">
                            <div style={{ width: 6, height: 6, borderRadius: '50%', background: enabled ? fx.color : '#333', boxShadow: enabled ? `0 0 4px ${fx.color}` : 'none' }} />
                            <span className="text-[11px] font-bold tracking-wide" style={{ color: enabled ? fx.color : '#444' }}>{fx.label}</span>
                          </div>
                          <button onClick={() => setFx(fx.key, { enabled: !enabled })}
                            className="relative shrink-0" style={{ width: 28, height: 14, borderRadius: 7, background: enabled ? fx.color : '#2a2a2a', border: 'none', cursor: 'pointer', transition: 'background 0.15s' }}>
                            <span style={{ position: 'absolute', top: 2, left: enabled ? 14 : 2, width: 10, height: 10, borderRadius: '50%', background: '#fff', transition: 'left 0.15s' }} />
                          </button>
                        </div>
                        <div className="flex-1 flex flex-col justify-center gap-1.5 px-2.5 py-1.5">
                          {(fx.rows as unknown as [string, string, number, number, number, (v: number) => string][]).map(([lbl, param, min, max, step, fmt]) => (
                            <div key={param} className="flex items-center gap-2">
                              <span className="text-[9px] shrink-0" style={{ color: '#555', width: 52 }}>{lbl}</span>
                              <input type="range" min={min} max={max} step={step}
                                value={(effectParams[fx.key] as unknown as Record<string, number>)[param]}
                                onChange={e => setFx(fx.key, { [param]: Number(e.target.value) } as Partial<EffectParams[typeof fx.key]>)}
                                className="flex-1 min-w-0" style={{ accentColor: enabled ? fx.color : '#555', height: 2, cursor: 'pointer' }} />
                              <span className="text-[9px] tabular-nums shrink-0" style={{ color: '#666', width: 30, textAlign: 'right' }}>{fmt((effectParams[fx.key] as unknown as Record<string, number>)[param])}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── Resize handles ── */}
          {!floatWin.minimized && (<>
            {/* edges */}
            <div style={{ position:'absolute', right:0, top:4, bottom:4, width:4, cursor:'ew-resize' }} onMouseDown={e=>{winResizeRef.current={dir:'e',startX:e.clientX,startY:e.clientY,startW:floatWin.w,startH:floatWin.h,startWx:floatWin.x,startWy:floatWin.y};e.preventDefault()}} />
            <div style={{ position:'absolute', left:0, top:4, bottom:4, width:4, cursor:'ew-resize' }} onMouseDown={e=>{winResizeRef.current={dir:'w',startX:e.clientX,startY:e.clientY,startW:floatWin.w,startH:floatWin.h,startWx:floatWin.x,startWy:floatWin.y};e.preventDefault()}} />
            <div style={{ position:'absolute', bottom:0, left:4, right:4, height:4, cursor:'ns-resize' }} onMouseDown={e=>{winResizeRef.current={dir:'s',startX:e.clientX,startY:e.clientY,startW:floatWin.w,startH:floatWin.h,startWx:floatWin.x,startWy:floatWin.y};e.preventDefault()}} />
            {/* corners */}
            <div style={{ position:'absolute', right:0, bottom:0, width:10, height:10, cursor:'nwse-resize' }} onMouseDown={e=>{winResizeRef.current={dir:'se',startX:e.clientX,startY:e.clientY,startW:floatWin.w,startH:floatWin.h,startWx:floatWin.x,startWy:floatWin.y};e.preventDefault()}} />
            <div style={{ position:'absolute', left:0, bottom:0, width:10, height:10, cursor:'nesw-resize' }} onMouseDown={e=>{winResizeRef.current={dir:'sw',startX:e.clientX,startY:e.clientY,startW:floatWin.w,startH:floatWin.h,startWx:floatWin.x,startWy:floatWin.y};e.preventDefault()}} />
          </>)}
        </div>
      )}

      {/* ═══ KEYBOARD SHORTCUTS ═════════════════════════════════════════ */}
      {showShortcuts && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.7)' }} onClick={() => setShowShortcuts(false)}>
          <div className="rounded-lg p-5 max-w-md w-full mx-4" style={{ background: '#242424', border: '1px solid #3a3a3a' }} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold" style={{ color: '#e0e0e0' }}>{t('shortcuts_modal_title')}</h3>
              <button onClick={() => setShowShortcuts(false)} style={{ color: '#555' }}>✕</button>
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs" style={{ color: '#888' }}>
              {[['Espace', t('shortcut_play_pause')],['Échap', t('shortcut_stop')],['S', t('shortcut_select_tool')],['V', t('shortcut_move_tool')],
                ['Clic ruler', t('shortcut_seek')],['Drag waveform (S)', t('shortcut_select')],['Drag clip (V)', t('shortcut_move_clip')],
                ['Ctrl+Scroll', t('shortcut_zoom')],['Home / End', t('shortcut_start_end')],['← →', t('shortcut_seek_2s')],
                ['Ctrl+A', t('shortcut_select_all')],['Ctrl+C', t('shortcut_copy')],['Ctrl+X / Suppr', t('shortcut_cut')],
                ['Ctrl+V', t('shortcut_paste')],['Ctrl+Z', t('shortcut_restore')],['L', t('shortcut_loop')],
              ].map(([k, v]) => (
                <div key={k} className="flex items-center gap-2">
                  <kbd className="px-1.5 py-0.5 rounded text-[9px]" style={{ background: '#333', color: '#ccc', fontFamily: 'monospace' }}>{k}</kbd>
                  <span style={{ color: '#666' }}>{v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ═══ EXPORT MODAL ════════════════════════════════════════════════ */}
      {showExportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.75)' }} onClick={() => setShowExportModal(false)}>
          <div className="rounded-xl p-6 w-80" style={{ background: '#242424', border: '1px solid #3a3a3a' }} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-bold" style={{ color: '#e0e0e0' }}>{t('export_modal_title')}</h3>
              <button onClick={() => setShowExportModal(false)} style={{ color: '#555' }}><X size={14} /></button>
            </div>
            <div className="space-y-3">
              {/* Download original */}
              <button onClick={() => { downloadTrack(); setShowExportModal(false) }}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm transition-colors hover:bg-white/5"
                style={{ background: '#1a1a1a', color: '#e0e0e0', border: '1px solid #2e2e2e' }}>
                <Download size={16} style={{ color: '#4f8ef7' }} />
                <div className="text-left">
                  <p className="font-medium">{t('export_download_mp3')}</p>
                  <p className="text-[10px]" style={{ color: '#555' }}>{t('export_download_mp3_desc')}</p>
                </div>
              </button>
              {/* Save to library (stem) */}
              {currentTrack && workspace && (
                <>
                  {['vocals', 'instrumental'].map(stem => (
                    <a key={stem} href={`/api/workspaces/${workspace.id}/tracks/${currentTrack.id}/stems/${stem}?token=${localStorage.getItem('ss_token') ?? ''}`}
                      download={`${currentTrack.title}_${stem}.mp3`}
                      className="flex items-center gap-3 px-4 py-3 rounded-lg text-sm transition-colors hover:bg-white/5 no-underline"
                      style={{ background: '#1a1a1a', color: '#e0e0e0', border: '1px solid #2e2e2e', display: 'flex' }}
                      onClick={() => setShowExportModal(false)}>
                      <Download size={16} style={{ color: stem === 'vocals' ? '#9b59e2' : '#2eb872' }} />
                      <div className="text-left">
                        <p className="font-medium">{stem === 'vocals' ? t('export_download_vocals') : t('export_download_instru')}</p>
                        <p className="text-[10px]" style={{ color: '#555' }}>{t('export_stem_desc')}</p>
                      </div>
                    </a>
                  ))}
                </>
              )}
              {/* Save to library */}
              <button onClick={() => {
                if (!currentTrack) return
                alert(t('alert_already_in_library', { title: currentTrack.title }))
                setShowExportModal(false)
              }} className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm transition-colors hover:bg-white/5"
                style={{ background: '#1a1a1a', color: currentTrack ? '#e0e0e0' : '#555', border: '1px solid #2e2e2e' }}>
                <Save size={16} style={{ color: '#2eb872' }} />
                <div className="text-left">
                  <p className="font-medium">{t('export_library')}</p>
                  <p className="text-[10px]" style={{ color: '#555' }}>{currentTrack ? t('export_already_saved') : t('export_no_track')}</p>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}

      {stemError && (
        <div className="fixed bottom-4 right-4 px-4 py-2 rounded text-xs z-50" style={{ background: '#1a0808', color: '#e74c3c', border: '1px solid #3a1010' }}>
          {stemError}
        </div>
      )}
    </div>
  )
}