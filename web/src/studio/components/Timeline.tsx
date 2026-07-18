import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import type React from 'react'
import { Loader2, Volume1, VolumeX, X, Plus } from 'lucide-react'
import { useI18n } from '../../i18n'
import type { StudioApi } from '../useStudioEngine'
import type { Tool, Track } from '../types'
import { BASE_PX_PER_SEC, TRACK_HEIGHT, RULER_HEIGHT } from '../constants'
import { drawWaveViewport, drawRulerViewport, fmtTime } from '../waveform'

interface DragState {
  type: 'select' | 'move'
  trackId: string
  startClientX: number
  startLocal: number   // for select: local seconds at press
  startOffset: number  // for move
}

export function Timeline({ api, tool, onContextMenu, onAddTrack }: {
  api: StudioApi
  tool: Tool
  onContextMenu: (e: React.MouseEvent, trackId: string) => void
  onAddTrack: () => void
}) {
  const { t } = useI18n()
  const px = BASE_PX_PER_SEC * api.zoom
  const scrollRef = useRef<HTMLDivElement>(null)
  const rulerRef = useRef<HTMLCanvasElement>(null)
  const canvasRefs = useRef<Map<string, HTMLCanvasElement>>(new Map())
  const drag = useRef<DragState | null>(null)

  const tracks = api.tracks
  const total = api.total
  const contentWidth = Math.max(800, total * px + 300)

  /* ── viewport-virtualized redraw ── */
  const redraw = useCallback(() => {
    const scroll = scrollRef.current; if (!scroll) return
    const sl = scroll.scrollLeft
    const vw = scroll.clientWidth
    if (rulerRef.current) drawRulerViewport(rulerRef.current, sl, px, vw, RULER_HEIGHT)
    for (const tr of tracks) {
      const canvas = canvasRefs.current.get(tr.id)
      if (canvas && tr.buffer) drawWaveViewport(canvas, tr.buffer, tr.cuts, tr.offset, tr.color, sl, px, vw, TRACK_HEIGHT - 14)
    }
  }, [tracks, px])

  useLayoutEffect(() => { redraw() }, [redraw])
  useEffect(() => {
    const scroll = scrollRef.current; if (!scroll) return
    let raf = 0
    const onScroll = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(redraw) }
    scroll.addEventListener('scroll', onScroll)
    const ro = new ResizeObserver(redraw); ro.observe(scroll)
    return () => { scroll.removeEventListener('scroll', onScroll); ro.disconnect(); cancelAnimationFrame(raf) }
  }, [redraw])

  /* ── auto fit-to-view: on first load, zoom so the whole track fits ── */
  const fittedRef = useRef(false)
  useEffect(() => {
    const scroll = scrollRef.current
    if (total <= 0) { fittedRef.current = false; return }
    if (fittedRef.current || !scroll) return
    const vw = scroll.clientWidth
    if (vw < 60) return
    const target = (vw - 24) / (total * BASE_PX_PER_SEC)
    api.setZoom(Math.max(0.15, Math.min(6, target)))
    fittedRef.current = true
  }, [total, api])

  /* ── follow playhead while playing ── */
  useEffect(() => {
    if (!api.playing) return
    const scroll = scrollRef.current; if (!scroll) return
    const x = api.playhead * px
    if (x < scroll.scrollLeft + 40 || x > scroll.scrollLeft + scroll.clientWidth - 80)
      scroll.scrollLeft = Math.max(0, x - scroll.clientWidth * 0.3)
  }, [api.playhead, api.playing, px])

  /* ── Ctrl+scroll zoom ── */
  useEffect(() => {
    const scroll = scrollRef.current; if (!scroll) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      api.setZoom(Math.max(0.15, Math.min(10, api.zoom * (e.deltaY < 0 ? 1.12 : 0.89))))
    }
    scroll.addEventListener('wheel', onWheel, { passive: false })
    return () => scroll.removeEventListener('wheel', onWheel)
  }, [api])

  const timeAtClientX = useCallback((clientX: number) => {
    const scroll = scrollRef.current; if (!scroll) return 0
    return Math.max(0, (clientX - scroll.getBoundingClientRect().left + scroll.scrollLeft) / px)
  }, [px])

  /* ── global drag handling ── */
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = drag.current; if (!d) return
      const t2 = timeAtClientX(e.clientX)
      if (d.type === 'move') {
        const dt = t2 - timeAtClientX(d.startClientX)
        api.setOffset(d.trackId, d.startOffset + dt)
      } else {
        const track = api.tracksRef.current.find(x => x.id === d.trackId)
        const eff = track ? api.effectiveDuration(track) : 0
        const local = Math.max(0, Math.min(eff, t2 - (track?.offset ?? 0)))
        api.setSelection(d.trackId, { start: Math.min(d.startLocal, local), end: Math.max(d.startLocal, local) })
      }
    }
    const onUp = () => {
      const d = drag.current
      if (d?.type === 'select') {
        const track = api.tracksRef.current.find(x => x.id === d.trackId)
        const sel = track?.selection
        if (sel && sel.end - sel.start < 0.01) api.setSelection(d.trackId, null)
      }
      drag.current = null
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
  }, [api, timeAtClientX])

  const startBodyDrag = (e: React.MouseEvent, tr: Track) => {
    e.stopPropagation()
    const t2 = timeAtClientX(e.clientX)
    if (tool === 'move') {
      drag.current = { type: 'move', trackId: tr.id, startClientX: e.clientX, startLocal: 0, startOffset: tr.offset }
    } else {
      const eff = api.effectiveDuration(tr)
      const local = Math.max(0, Math.min(eff, t2 - tr.offset))
      api.seek(t2)
      api.setSelection(tr.id, { start: local, end: local })
      drag.current = { type: 'select', trackId: tr.id, startClientX: e.clientX, startLocal: local, startOffset: tr.offset }
    }
  }

  return (
    <div className="flex flex-1 min-h-0">
      {/* Fixed track headers */}
      <div className="shrink-0 flex flex-col w-20 md:w-36" style={{ background: '#1e1e1e', borderRight: '1px solid #2e2e2e', zIndex: 5 }}>
        <div style={{ height: RULER_HEIGHT, background: '#1a1a1a', borderBottom: '1px solid #2e2e2e' }} />
        {tracks.map(tr => (
          <div key={tr.id} className="flex flex-col justify-between px-2 py-1.5 border-b" style={{ height: TRACK_HEIGHT, borderColor: '#202020', borderLeft: `3px solid ${tr.color}` }}
            onContextMenu={e => onContextMenu(e, tr.id)}>
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold truncate flex-1 mr-1" style={{ color: tr.color }} title={tr.name}>{tr.name}</span>
              <div className="flex gap-1">
                <button onClick={() => api.toggleSolo(tr.id)} className="hidden md:flex w-4 h-4 rounded text-[9px] font-bold items-center justify-center"
                  style={{ background: tr.solo ? '#f0a830' : '#2a2a2a', color: tr.solo ? '#000' : '#666' }}>S</button>
                <button onClick={() => api.toggleMute(tr.id)} className="w-4 h-4 rounded text-[9px] font-bold flex items-center justify-center"
                  style={{ background: tr.muted ? '#e74c3c' : '#2a2a2a', color: tr.muted ? '#fff' : '#666' }}>M</button>
                {tr.kind === 'extra' && (
                  <button onClick={() => api.removeTrack(tr.id)} className="w-4 h-4 rounded text-[9px] flex items-center justify-center hover:bg-red-900/30" style={{ color: '#555' }}><X size={8} /></button>
                )}
              </div>
            </div>
            <div className="hidden md:flex items-center gap-1.5">
              {tr.muted ? <VolumeX size={10} style={{ color: '#e74c3c' }} /> : <Volume1 size={10} style={{ color: '#555' }} />}
              <input type="range" min={0} max={1.2} step={0.01} value={tr.gain} onChange={e => api.setGain(tr.id, Number(e.target.value))}
                className="flex-1" style={{ accentColor: tr.color, height: '3px' }} />
              <span className="text-[9px] tabular-nums" style={{ color: '#444', minWidth: 24 }}>{Math.round(tr.gain * 100)}</span>
            </div>
            <div className="hidden md:flex items-center gap-1 h-4">
              {!tr.buffer && <><Loader2 size={9} className="animate-spin" style={{ color: '#f0a830' }} /><span className="text-[9px]" style={{ color: '#888' }}>{t('loading')}</span></>}
              {tr.selection && <span className="text-[8px] tabular-nums" style={{ color: '#f0a830' }}>{fmtTime(tr.selection.start)}–{fmtTime(tr.selection.end)}</span>}
            </div>
          </div>
        ))}
        <div className="px-2 py-2 border-b" style={{ borderColor: '#202020' }}>
          <button onClick={onAddTrack} className="w-full flex items-center justify-center gap-1 py-2 rounded border border-dashed text-[9px]" style={{ borderColor: '#252525', color: '#444' }}>
            <Plus size={10} /> {t('btn_add_track')}
          </button>
        </div>
      </div>

      {/* Scrollable timeline */}
      <div ref={scrollRef} className="flex-1 overflow-x-auto overflow-y-hidden relative" style={{ background: '#141414' }}>
        <div style={{ position: 'relative', width: contentWidth, minHeight: '100%' }}>
          {/* Ruler */}
          <canvas ref={rulerRef} style={{ display: 'block', height: RULER_HEIGHT, position: 'sticky', left: 0, top: 0, zIndex: 4, cursor: 'pointer', borderBottom: '1px solid #2e2e2e' }}
            onClick={e => api.seek(timeAtClientX(e.clientX))} />
          {/* Rows */}
          {tracks.map(tr => {
            const eff = api.effectiveDuration(tr)
            const clipL = tr.offset * px
            const clipW = eff * px
            return (
              <div key={tr.id} style={{ height: TRACK_HEIGHT, position: 'relative', borderBottom: '1px solid #202020' }}
                onContextMenu={e => onContextMenu(e, tr.id)}
                onMouseDown={e => { if (e.button === 0 && tr.buffer && eff > 0) startBodyDrag(e, tr) }}>
                {/* full-width sticky waveform canvas */}
                <canvas ref={el => { if (el) canvasRefs.current.set(tr.id, el); else canvasRefs.current.delete(tr.id) }}
                  style={{ display: 'block', position: 'sticky', left: 0, top: 0, marginTop: 14, height: TRACK_HEIGHT - 14, pointerEvents: 'none' }} />
                {tr.buffer && eff > 0 && (
                  <>
                    {/* clip header bar (content coords) */}
                    <div style={{ position: 'absolute', left: clipL, width: clipW, top: 0, height: 14, background: tr.color + '28', borderTop: `2px solid ${tr.color}`, cursor: tool === 'move' ? 'grab' : 'default', userSelect: 'none', display: 'flex', alignItems: 'center', paddingLeft: 4 }}
                      onMouseDown={e => { e.stopPropagation(); drag.current = { type: 'move', trackId: tr.id, startClientX: e.clientX, startLocal: 0, startOffset: tr.offset } }}>
                      <span style={{ fontSize: 9, color: tr.color, pointerEvents: 'none' }}>{tr.name} @ {fmtTime(tr.offset)}</span>
                    </div>
                    {/* selection overlay (content coords) */}
                    {tr.selection && tr.selection.end > tr.selection.start && (
                      <>
                        <div style={{ position: 'absolute', top: 14, bottom: 0, pointerEvents: 'none', background: 'rgba(240,168,48,0.13)', left: clipL + tr.selection.start * px, width: (tr.selection.end - tr.selection.start) * px }} />
                        <div style={{ position: 'absolute', top: 14, bottom: 0, width: 1, background: 'rgba(240,168,48,0.8)', pointerEvents: 'none', left: clipL + tr.selection.start * px }} />
                        <div style={{ position: 'absolute', top: 14, bottom: 0, width: 1, background: 'rgba(240,168,48,0.8)', pointerEvents: 'none', left: clipL + tr.selection.end * px }} />
                      </>
                    )}
                  </>
                )}
                {!tr.buffer && (
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                    <Loader2 size={16} className="animate-spin" style={{ color: tr.color }} />
                  </div>
                )}
              </div>
            )
          })}
          {/* Playhead */}
          <div style={{ position: 'absolute', top: 0, bottom: 0, width: 1, background: 'rgba(255,255,255,0.85)', left: api.playhead * px, zIndex: 10, pointerEvents: 'none' }}>
            <div style={{ position: 'absolute', top: RULER_HEIGHT, left: -4, width: 9, height: 9, background: 'white', clipPath: 'polygon(50% 100%, 0 0, 100% 0)' }} />
          </div>
        </div>
      </div>
    </div>
  )
}
