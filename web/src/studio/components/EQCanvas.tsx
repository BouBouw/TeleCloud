import { useCallback, useEffect, useRef, useState } from 'react'
import type React from 'react'
import { RotateCcw } from 'lucide-react'
import { useI18n } from '../../i18n'
import { EQ_PRESETS, type EQBand } from '../constants'

const freqToX = (freq: number, w: number) => (Math.log10(freq / 30) / Math.log10(20000 / 30)) * w
const dbToY = (db: number, h: number) => h - ((db + 12) / 24) * h
const yToDb = (y: number, h: number) => Math.max(-12, Math.min(12, ((h - y) / h) * 24 - 12))

/** Spotify-style draggable EQ curve over 6 peaking bands. */
export function EQCanvas({ bands, onChange, onReset }: { bands: EQBand[]; onChange: (i: number, g: number) => void; onReset: () => void }) {
  const { t } = useI18n()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dragIdx = useRef<number | null>(null)
  const [preset, setPreset] = useState('Manual')

  const redraw = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    const dw = canvas.clientWidth, dh = canvas.clientHeight
    if (dw === 0 || dh === 0) return
    canvas.width = dw * dpr; canvas.height = dh * dpr
    const ctx = canvas.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const w = dw, h = dh
    ctx.fillStyle = '#0d0d0d'; ctx.fillRect(0, 0, w, h)

    for (const db of [-12, -6, 0, 6, 12]) {
      const y = dbToY(db, h)
      ctx.strokeStyle = db === 0 ? '#2a2a2a' : '#181818'
      ctx.lineWidth = db === 0 ? 1.5 : 1
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke()
    }
    ctx.font = '9px monospace'; ctx.fillStyle = '#888'
    for (const db of [12, 6, 0, -6, -12]) {
      const y = dbToY(db, h)
      ctx.textBaseline = y < 8 ? 'top' : y > h - 8 ? 'bottom' : 'middle'
      ctx.fillText(db > 0 ? `+${db}dB` : `${db}dB`, 4, y)
    }

    const pts = bands.map(b => ({ x: freqToX(b.freq, w), y: dbToY(b.gain, h) }))
    const allPts = [{ x: -20, y: dbToY(0, h) }, ...pts, { x: w + 20, y: dbToY(0, h) }]
    const drawSpline = () => {
      ctx.beginPath(); ctx.moveTo(allPts[0].x, allPts[0].y)
      const tension = 0.45
      for (let i = 0; i < allPts.length - 1; i++) {
        const p0 = allPts[Math.max(0, i - 1)], p1 = allPts[i]
        const p2 = allPts[i + 1], p3 = allPts[Math.min(allPts.length - 1, i + 2)]
        ctx.bezierCurveTo(p1.x + (p2.x - p0.x) * tension / 3, p1.y + (p2.y - p0.y) * tension / 3,
          p2.x - (p3.x - p1.x) * tension / 3, p2.y - (p3.y - p1.y) * tension / 3, p2.x, p2.y)
      }
    }
    drawSpline()
    ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath()
    const grad = ctx.createLinearGradient(0, 0, 0, h)
    grad.addColorStop(0, 'rgba(30,215,96,0.38)'); grad.addColorStop(0.55, 'rgba(30,215,96,0.12)'); grad.addColorStop(1, 'rgba(30,215,96,0.02)')
    ctx.fillStyle = grad; ctx.fill()
    drawSpline(); ctx.strokeStyle = '#1ed760'; ctx.lineWidth = 1.5; ctx.stroke()

    pts.forEach((pt, i) => {
      ctx.beginPath(); ctx.arc(pt.x, pt.y, 5, 0, Math.PI * 2)
      ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = '#1ed760'; ctx.lineWidth = 1.5; ctx.stroke()
      if (bands[i].gain !== 0) {
        ctx.fillStyle = '#1ed760'; ctx.font = '8px monospace'; ctx.textBaseline = 'bottom'
        const lbl = bands[i].gain > 0 ? `+${bands[i].gain}` : `${bands[i].gain}`
        ctx.fillText(lbl, pt.x - ctx.measureText(lbl).width / 2, pt.y - 7)
      }
    })
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
    if (canvasRef.current?.parentElement) obs.observe(canvasRef.current.parentElement)
    return () => obs.disconnect()
  }, [redraw])

  const hitTest = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current; if (!canvas) return -1
    const r = canvas.getBoundingClientRect()
    const mx = e.clientX - r.left, my = e.clientY - r.top
    for (let i = 0; i < bands.length; i++)
      if (Math.hypot(mx - freqToX(bands[i].freq, r.width), my - dbToY(bands[i].gain, r.height)) < 12) return i
    return -1
  }

  return (
    <div className="flex flex-col h-full" style={{ background: '#0d0d0d' }}>
      <div className="flex items-center gap-3 px-3 shrink-0" style={{ height: 32, borderBottom: '1px solid #161616' }}>
        <span className="text-[9px] uppercase" style={{ color: '#555' }}>{t('eq_label_presets')}</span>
        <select value={preset} onChange={e => {
          const p = e.target.value; setPreset(p)
          if (EQ_PRESETS[p]) EQ_PRESETS[p].forEach((g, i) => onChange(i, g))
        }} className="text-[10px] px-1.5 py-0.5 rounded outline-none" style={{ background: '#1a1a1a', color: '#999', border: '1px solid #2a2a2a' }}>
          {Object.keys(EQ_PRESETS).map(k => <option key={k}>{k}</option>)}
        </select>
        <button onClick={() => { onReset(); setPreset('Manual') }} className="ml-auto flex items-center gap-1 text-[9px] px-2 py-0.5 rounded hover:bg-white/5" style={{ color: '#555' }}>
          <RotateCcw size={9} /> {t('btn_reset_eq')}
        </button>
      </div>
      <canvas ref={canvasRef} className="w-full block" style={{ height: 220, cursor: 'crosshair', touchAction: 'none' }}
        onMouseDown={e => { const i = hitTest(e); if (i >= 0) dragIdx.current = i }}
        onMouseMove={e => {
          if (dragIdx.current === null) return
          const r = canvasRef.current!.getBoundingClientRect()
          onChange(dragIdx.current, Math.round(yToDb(e.clientY - r.top, r.height) * 2) / 2)
        }}
        onMouseUp={() => { dragIdx.current = null }}
        onMouseLeave={() => { dragIdx.current = null }} />
    </div>
  )
}
