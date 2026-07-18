import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { useI18n } from '../../i18n'
import type { StudioApi } from '../useStudioEngine'
import type { EffectParams } from '../constants'
import { PanKnob } from './PanKnob'
import { EQCanvas } from './EQCanvas'

type Tab = 'mixer' | 'eq' | 'effects'
export interface FloatWinState { tab: Tab; x: number; y: number; w: number; h: number; minimized: boolean }

const FX_DEFS = [
  { key: 'reverb'     as const, label: 'Reverb',     color: '#7c3aed', rows: [['Wet', 'wet', 0, 1, 0.01, (v: number) => `${Math.round(v * 100)}%`], ['Decay', 'decay', 0.5, 6, 0.1, (v: number) => `${v.toFixed(1)}s`]] },
  { key: 'delay'      as const, label: 'Delay',      color: '#2563eb', rows: [['Time', 'time', 0.05, 1, 0.01, (v: number) => `${Math.round(v * 1000)}ms`], ['Feedback', 'feedback', 0, 0.9, 0.01, (v: number) => `${Math.round(v * 100)}%`], ['Wet', 'wet', 0, 1, 0.01, (v: number) => `${Math.round(v * 100)}%`]] },
  { key: 'compressor' as const, label: 'Compressor', color: '#059669', rows: [['Threshold', 'threshold', -60, 0, 1, (v: number) => `${v}dB`], ['Ratio', 'ratio', 1, 20, 0.5, (v: number) => `${v}:1`]] },
  { key: 'distortion' as const, label: 'Distortion', color: '#dc2626', rows: [['Amount', 'amount', 1, 100, 1, (v: number) => `${v}`], ['Wet', 'wet', 0, 1, 0.01, (v: number) => `${Math.round(v * 100)}%`]] },
  { key: 'chorus'     as const, label: 'Chorus',     color: '#db2777', rows: [['Rate', 'rate', 0.1, 8, 0.1, (v: number) => `${v.toFixed(1)}Hz`], ['Depth', 'depth', 0.05, 1, 0.01, (v: number) => `${Math.round(v * 100)}%`], ['Wet', 'wet', 0, 1, 0.01, (v: number) => `${Math.round(v * 100)}%`]] },
] as const

function ChannelStrip({ name, color, gain, pan, muted, solo, idx, onGain, onPan, onMute, onSolo, onRemove }: {
  name: string; color: string; gain: number; pan: number; muted: boolean; solo: boolean; idx: number
  onGain: (v: number) => void; onPan?: (v: number) => void; onMute: () => void; onSolo: () => void; onRemove?: () => void
}) {
  return (
    <div className="flex flex-col items-center shrink-0 border-r" style={{ width: 52, background: '#1a1a1a', borderColor: '#111' }}>
      <div style={{ width: 8, height: 8, borderRadius: '50%', marginTop: 6, background: !muted ? color : '#1a1a1a', boxShadow: !muted ? `0 0 4px ${color}` : 'none' }} />
      <div className="text-[8px] mt-0.5" style={{ color: '#3a3a3a' }}>{idx}</div>
      <div className="mt-1.5">{onPan ? <PanKnob pan={pan} color={color} onChange={onPan} /> : <div style={{ width: 28, height: 28 }} />}</div>
      <div className="flex-1 flex flex-col items-center justify-center py-1 gap-1">
        <input type="range" min={0} max={1.2} step={0.01} value={gain} onChange={e => onGain(Number(e.target.value))}
          style={{ writingMode: 'vertical-lr', direction: 'rtl', height: 72, width: 18, accentColor: muted ? '#333' : color, cursor: 'pointer' }} />
        <span style={{ fontSize: 8, color: '#444' }}>{Math.round(gain * 100)}</span>
      </div>
      <div className="flex gap-0.5 mb-1">
        <button onClick={onMute} style={{ width: 16, height: 14, fontSize: 8, fontWeight: 700, background: muted ? '#e74c3c' : '#252525', color: muted ? '#fff' : '#555', border: 'none', borderRadius: 2, cursor: 'pointer' }}>M</button>
        {onRemove
          ? <button onClick={onRemove} style={{ width: 16, height: 14, fontSize: 8, background: '#252525', color: '#555', border: 'none', borderRadius: 2, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><X size={8} /></button>
          : <button onClick={onSolo} style={{ width: 16, height: 14, fontSize: 8, fontWeight: 700, background: solo ? '#f0a830' : '#252525', color: solo ? '#000' : '#555', border: 'none', borderRadius: 2, cursor: 'pointer' }}>S</button>}
      </div>
      <div style={{ height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ writingMode: 'vertical-lr', transform: 'rotate(180deg)', fontSize: 9, color, maxHeight: 44, overflow: 'hidden' }} title={name}>{name}</span>
      </div>
    </div>
  )
}

export function FloatingPanel({ api, win, setWin }: { api: StudioApi; win: FloatWinState; setWin: React.Dispatch<React.SetStateAction<FloatWinState | null>> }) {
  const { t } = useI18n()
  const winDrag = useRef<{ startX: number; startY: number; startWx: number; startWy: number } | null>(null)
  const winResize = useRef<{ dir: string; startX: number; startY: number; startW: number; startH: number; startWx: number; startWy: number } | null>(null)

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const wd = winDrag.current
      if (wd) setWin(p => p ? {
        ...p,
        x: Math.max(0, Math.min(window.innerWidth - 60, wd.startWx + (e.clientX - wd.startX))),
        y: Math.max(0, Math.min(window.innerHeight - 40, wd.startWy + (e.clientY - wd.startY))),
      } : p)
      const wr = winResize.current
      if (wr) {
        const dx = e.clientX - wr.startX, dy = e.clientY - wr.startY
        setWin(p => {
          if (!p) return p
          let { x, w, h } = { x: wr.startWx, w: wr.startW, h: wr.startH }
          const y = wr.startWy
          if (wr.dir.includes('e')) w = Math.max(320, wr.startW + dx)
          if (wr.dir.includes('s')) h = Math.max(180, wr.startH + dy)
          if (wr.dir.includes('w')) { w = Math.max(320, wr.startW - dx); x = wr.startWx + (wr.startW - w) }
          return { ...p, x, y, w, h }
        })
      }
    }
    const onUp = () => { winDrag.current = null; winResize.current = null }
    document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp)
    return () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
  }, [setWin])

  const setTab = (tab: Tab) => setWin(p => p ? { ...p, tab, minimized: false } : p)
  const tracks = api.tracks

  return (
    <div style={{
      position: 'fixed', left: win.x, top: win.y, width: win.w, height: win.minimized ? 34 : win.h,
      zIndex: 200, display: 'flex', flexDirection: 'column', background: '#1e1e1e', border: '1px solid #3a3a3a',
      borderRadius: 6, overflow: 'hidden', boxShadow: '0 8px 32px rgba(0,0,0,0.7)',
      minWidth: 320, minHeight: win.minimized ? 34 : 180, maxWidth: '100vw', maxHeight: '90vh',
    }}>
      {/* title / tab bar */}
      <div className="flex items-center gap-0 shrink-0 select-none"
        style={{ height: 34, background: '#242424', borderBottom: win.minimized ? 'none' : '1px solid #2e2e2e', cursor: 'grab' }}
        onMouseDown={e => { if ((e.target as HTMLElement).closest('button')) return; winDrag.current = { startX: e.clientX, startY: e.clientY, startWx: win.x, startWy: win.y }; e.preventDefault() }}>
        <div className="flex items-center gap-1 px-2 shrink-0">
          <button onClick={() => setWin(null)} style={{ width: 11, height: 11, borderRadius: '50%', background: '#ff5f57', border: 'none', cursor: 'pointer' }} />
          <button onClick={() => setWin(p => p ? { ...p, minimized: !p.minimized } : p)} style={{ width: 11, height: 11, borderRadius: '50%', background: '#febc2e', border: 'none', cursor: 'pointer' }} />
          <button onClick={() => setWin(p => p ? { ...p, w: 660, h: 300, minimized: false } : p)} style={{ width: 11, height: 11, borderRadius: '50%', background: '#28c840', border: 'none', cursor: 'pointer' }} />
        </div>
        <div className="flex items-center h-full">
          {(['mixer', 'eq', 'effects'] as const).map(tab => (
            <button key={tab} onClick={() => setTab(tab)} className="px-3 h-full text-xs"
              style={{ color: win.tab === tab ? '#e0e0e0' : '#555', background: 'transparent', border: 'none', borderBottom: win.tab === tab ? '2px solid #f0a830' : '2px solid transparent', cursor: 'pointer' }}>
              {tab === 'eq' ? t('float_tab_eq') : tab === 'effects' ? t('float_tab_effects') : t('float_tab_mixer')}
            </button>
          ))}
        </div>
      </div>

      {!win.minimized && (
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {win.tab === 'mixer' && (
            <div className="flex flex-1 min-h-0 overflow-x-auto" style={{ background: '#1a1a1a' }}>
              {/* master */}
              <div className="flex flex-col items-center shrink-0 border-r" style={{ width: 56, background: '#1e1e1e', borderColor: '#111' }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', marginTop: 6, background: '#4CAF50', boxShadow: '0 0 5px #4CAF50' }} />
                <div className="text-[8px] mt-0.5" style={{ color: '#2e8b57' }}>M</div>
                <div className="mt-1.5"><div style={{ width: 28, height: 28 }} /></div>
                <div className="flex-1 flex flex-col items-center justify-center py-1 gap-1">
                  <input type="range" min={0} max={1.2} step={0.01} value={api.masterVol} onChange={e => api.setMasterVol(Number(e.target.value))}
                    style={{ writingMode: 'vertical-lr', direction: 'rtl', height: 72, width: 18, accentColor: '#4f8ef7', cursor: 'pointer' }} />
                  <span style={{ fontSize: 8, color: '#444' }}>{Math.round(api.masterVol * 100)}</span>
                </div>
                <div style={{ height: 62, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ writingMode: 'vertical-lr', transform: 'rotate(180deg)', fontSize: 9, color: '#4f8ef7' }}>{t('mixer_master_label')}</span>
                </div>
              </div>
              {tracks.map((tr, i) => (
                <ChannelStrip key={tr.id} name={tr.name} color={tr.color} gain={tr.gain} pan={tr.pan} muted={tr.muted} solo={tr.solo} idx={i + 1}
                  onGain={v => api.setGain(tr.id, v)} onPan={v => api.setPan(tr.id, v)} onMute={() => api.toggleMute(tr.id)} onSolo={() => api.toggleSolo(tr.id)}
                  onRemove={tr.kind === 'extra' ? () => api.removeTrack(tr.id) : undefined} />
              ))}
              {/* offsets */}
              <div className="flex flex-col gap-2 px-3 py-2 ml-2 shrink-0" style={{ borderLeft: '1px solid #222', minWidth: 160 }}>
                <span className="text-[9px] uppercase" style={{ color: '#333' }}>{t('mixer_offset_label')}</span>
                {tracks.map(tr => (
                  <div key={tr.id} className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-sm shrink-0" style={{ background: tr.color }} />
                    <span className="text-[9px] w-14 truncate" style={{ color: '#555' }} title={tr.name}>{tr.name}</span>
                    <input type="number" min={0} step={0.1} value={tr.offset.toFixed(1)} onChange={e => api.setOffset(tr.id, Number(e.target.value))}
                      className="w-14 px-1 py-0.5 rounded text-[9px] outline-none" style={{ background: '#0a0a0a', color: '#ddd', border: '1px solid #252525' }} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {win.tab === 'eq' && <div className="flex-1 min-h-0"><EQCanvas bands={api.eq} onChange={api.setEqBand} onReset={api.resetEq} /></div>}

          {win.tab === 'effects' && (
            <div className="flex flex-1 min-h-0 px-2 py-2 gap-2 overflow-x-auto">
              {FX_DEFS.map(fx => {
                const enabled = api.fx[fx.key].enabled
                return (
                  <div key={fx.key} className="flex-1 rounded flex flex-col shrink-0 min-w-[120px]" style={{ background: '#1e1e1e', border: `1px solid ${enabled ? fx.color + '55' : '#2a2a2a'}` }}>
                    <div className="flex items-center justify-between px-2.5 py-1.5 border-b shrink-0" style={{ borderColor: enabled ? fx.color + '30' : '#222' }}>
                      <div className="flex items-center gap-1.5">
                        <div style={{ width: 6, height: 6, borderRadius: '50%', background: enabled ? fx.color : '#333', boxShadow: enabled ? `0 0 4px ${fx.color}` : 'none' }} />
                        <span className="text-[11px] font-bold tracking-wide" style={{ color: enabled ? fx.color : '#444' }}>{fx.label}</span>
                      </div>
                      <button onClick={() => api.patchFx(fx.key, { enabled: !enabled } as Partial<EffectParams[typeof fx.key]>)}
                        className="relative shrink-0" style={{ width: 28, height: 14, borderRadius: 7, background: enabled ? fx.color : '#2a2a2a', border: 'none', cursor: 'pointer' }}>
                        <span style={{ position: 'absolute', top: 2, left: enabled ? 14 : 2, width: 10, height: 10, borderRadius: '50%', background: '#fff', transition: 'left 0.15s' }} />
                      </button>
                    </div>
                    <div className="flex-1 flex flex-col justify-center gap-1.5 px-2.5 py-1.5">
                      {(fx.rows as unknown as [string, string, number, number, number, (v: number) => string][]).map(([lbl, param, min, max, step, fmt]) => (
                        <div key={param} className="flex items-center gap-2">
                          <span className="text-[9px] shrink-0" style={{ color: '#555', width: 52 }}>{lbl}</span>
                          <input type="range" min={min} max={max} step={step}
                            value={(api.fx[fx.key] as unknown as Record<string, number>)[param]}
                            onChange={e => api.patchFx(fx.key, { [param]: Number(e.target.value) } as Partial<EffectParams[typeof fx.key]>)}
                            className="flex-1 min-w-0" style={{ accentColor: enabled ? fx.color : '#555', height: 2, cursor: 'pointer' }} />
                          <span className="text-[9px] tabular-nums shrink-0" style={{ color: '#666', width: 30, textAlign: 'right' }}>{fmt((api.fx[fx.key] as unknown as Record<string, number>)[param])}</span>
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

      {!win.minimized && (<>
        <div style={{ position: 'absolute', right: 0, top: 4, bottom: 4, width: 4, cursor: 'ew-resize' }} onMouseDown={e => { winResize.current = { dir: 'e', startX: e.clientX, startY: e.clientY, startW: win.w, startH: win.h, startWx: win.x, startWy: win.y }; e.preventDefault() }} />
        <div style={{ position: 'absolute', left: 0, top: 4, bottom: 4, width: 4, cursor: 'ew-resize' }} onMouseDown={e => { winResize.current = { dir: 'w', startX: e.clientX, startY: e.clientY, startW: win.w, startH: win.h, startWx: win.x, startWy: win.y }; e.preventDefault() }} />
        <div style={{ position: 'absolute', bottom: 0, left: 4, right: 4, height: 4, cursor: 'ns-resize' }} onMouseDown={e => { winResize.current = { dir: 's', startX: e.clientX, startY: e.clientY, startW: win.w, startH: win.h, startWx: win.x, startWy: win.y }; e.preventDefault() }} />
        <div style={{ position: 'absolute', right: 0, bottom: 0, width: 10, height: 10, cursor: 'nwse-resize' }} onMouseDown={e => { winResize.current = { dir: 'se', startX: e.clientX, startY: e.clientY, startW: win.w, startH: win.h, startWx: win.x, startWy: win.y }; e.preventDefault() }} />
      </>)}
    </div>
  )
}
