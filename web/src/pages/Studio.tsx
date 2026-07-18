import { useCallback, useEffect, useRef, useState } from 'react'
import type React from 'react'
import {
  Play, Pause, Square, SkipBack, Download, Music2, Loader2, Repeat,
  ZoomIn, ZoomOut, Activity, Keyboard, MousePointer, Move, X, Search,
  Scissors, Copy, RotateCcw, Trash2, Undo2, Plus, Wand2,
  Mic, Redo2, TrendingUp, TrendingDown, VolumeX, Crop, FlipHorizontal2,
  Maximize2, SplitSquareHorizontal, FolderOpen, Save, FilePlus2, Check,
} from 'lucide-react'
import { useI18n } from '../i18n'
import { trackApi, studioApi } from '../lib/api'
import type { Track as LibTrack, StudioProjectMeta } from '../lib/api'
import { useWorkspaces } from '../store/workspaceStore'
import { useStudioEngine, type StudioProjectData } from '../studio/useStudioEngine'
import { DEFAULT_EQ, DEFAULT_FX } from '../studio/constants'
import type { Tool } from '../studio/types'
import { fmtTime } from '../studio/waveform'
import { Timeline } from '../studio/components/Timeline'
import { FloatingPanel, type FloatWinState } from '../studio/components/FloatingPanel'
import { LevelMeter } from '../studio/components/LevelMeter'

export default function Studio() {
  const { t } = useI18n()
  const { workspace } = useWorkspaces()
  const api = useStudioEngine()

  const [tool, setTool] = useState<Tool>('select')
  const [floatWin, setFloatWin] = useState<FloatWinState | null>(null)
  const [showLibrary, setShowLibrary] = useState(() => window.innerWidth >= 768)
  const [libTracks, setLibTracks] = useState<LibTrack[]>([])
  const [loadingLib, setLoadingLib] = useState(true)
  const [libSearch, setLibSearch] = useState('')
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [showExport, setShowExport] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; trackId: string } | null>(null)

  /* ── Projects (save / restore / autosave) ── */
  const [projects, setProjects] = useState<StudioProjectMeta[]>([])
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null)
  const [projectName, setProjectName] = useState('Sans titre')
  const [showProjects, setShowProjects] = useState(false)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [restoring, setRestoring] = useState(false)
  const lastSavedRef = useRef('')

  const mainInputRef = useRef<HTMLInputElement>(null)
  const extraInputRef = useRef<HTMLInputElement>(null)
  const projBtnRef = useRef<HTMLButtonElement>(null)

  /* ── Library fetch ── */
  useEffect(() => {
    if (!workspace) { setLoadingLib(false); return }
    trackApi.list(workspace.id).then(({ tracks }) => setLibTracks(tracks)).finally(() => setLoadingLib(false))
    studioApi.list(workspace.id).then(({ projects: p }) => setProjects(p)).catch(() => {})
  }, [workspace])

  /* ── Save / restore ── */
  const saveProject = useCallback(async (opts?: { auto?: boolean }) => {
    if (!workspace) return
    const data = api.serialize()
    if (data.tracks.length === 0) return               // nothing server-backed to restore
    const json = JSON.stringify(data)
    if (opts?.auto && json === lastSavedRef.current) return  // no change since last save
    setSaveState('saving')
    try {
      if (currentProjectId) {
        await studioApi.update(workspace.id, currentProjectId, { name: projectName, data: json })
      } else {
        const { project } = await studioApi.create(workspace.id, projectName, json)
        setCurrentProjectId(project.id)
      }
      lastSavedRef.current = json
      setSaveState('saved')
      studioApi.list(workspace.id).then(({ projects: p }) => setProjects(p)).catch(() => {})
    } catch { setSaveState('error') }
  }, [workspace, api, currentProjectId, projectName])

  const saveRef = useRef(saveProject); saveRef.current = saveProject

  /* auto-save every 15 s (only when something restorable changed) */
  useEffect(() => {
    const iv = setInterval(() => { void saveRef.current({ auto: true }) }, 15000)
    return () => { clearInterval(iv); void saveRef.current({ auto: true }) } // final flush
  }, [])

  /* reflect "unsaved changes" vs "saved" in the toolbar indicator */
  useEffect(() => {
    setSaveState(s => {
      if (s === 'saving') return s
      const clean = JSON.stringify(api.serialize()) === lastSavedRef.current && lastSavedRef.current !== ''
      return clean ? 'saved' : 'idle'
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api.tracks, api.bpm, api.rate, api.loop, api.masterVol, api.eq, api.fx])

  const resolveUrl = useCallback((tr: { trackId?: string; stem?: 'vocals' | 'instrumental' }): string | null => {
    if (!workspace || !tr.trackId) return null
    return tr.stem ? trackApi.stemUrl(workspace.id, tr.trackId, tr.stem) : trackApi.streamUrl(workspace.id, tr.trackId)
  }, [workspace])

  const openProject = useCallback(async (id: string) => {
    if (!workspace) return
    setShowProjects(false); setRestoring(true)
    try {
      const { project } = await studioApi.get(workspace.id, id)
      const data = JSON.parse(project.data) as StudioProjectData
      await api.restoreProject(data, resolveUrl)
      setCurrentProjectId(project.id); setProjectName(project.name)
      lastSavedRef.current = JSON.stringify(api.serialize())
      setSaveState('saved')
    } catch (e) { alert((e as Error).message) }
    finally { setRestoring(false) }
  }, [workspace, api, resolveUrl])

  const newProject = useCallback(async () => {
    await api.restoreProject({ version: 1, master: { bpm: 120, rate: 1, loop: false, masterVol: 0.9, eq: DEFAULT_EQ, fx: DEFAULT_FX }, tracks: [] }, () => null)
    setCurrentProjectId(null); setProjectName('Sans titre'); lastSavedRef.current = ''; setSaveState('idle'); setShowProjects(false)
  }, [api])

  const deleteProject = useCallback(async (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    if (!workspace || !window.confirm('Supprimer ce projet ?')) return
    await studioApi.delete(workspace.id, id).catch(() => {})
    setProjects(prev => prev.filter(p => p.id !== id))
    if (currentProjectId === id) { setCurrentProjectId(null); setProjectName('Sans titre'); lastSavedRef.current = '' }
  }, [workspace, currentProjectId])

  /* ── Keyboard shortcuts ── */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      const sel = api.tracksRef.current.find(x => x.selection)
      const activeId = sel?.id ?? api.tracksRef.current[0]?.id
      switch (e.code) {
        case 'Space': e.preventDefault(); api.togglePlay(); break
        case 'Escape': api.stop(); break
        case 'Delete': case 'Backspace':
          if (activeId && sel) { e.preventDefault(); api.cutSelection(activeId) }; break
        case 'KeyA': if ((e.ctrlKey || e.metaKey) && activeId) {
          e.preventDefault()
          const tr = api.tracksRef.current.find(x => x.id === activeId)
          if (tr) api.setSelection(activeId, { start: 0, end: api.effectiveDuration(tr) })
        }; break
        case 'KeyC': if ((e.ctrlKey || e.metaKey) && activeId) { e.preventDefault(); api.copySelection(activeId) }; break
        case 'KeyX': if ((e.ctrlKey || e.metaKey) && activeId) { e.preventDefault(); api.cutSelection(activeId) }; break
        case 'KeyV': if (e.ctrlKey || e.metaKey) { e.preventDefault(); api.pasteClipboard() } else setTool('move'); break
        case 'KeyZ': if (e.ctrlKey || e.metaKey) { e.preventDefault(); if (e.shiftKey) api.redo(); else api.undo() }; break
        case 'KeyY': if (e.ctrlKey || e.metaKey) { e.preventDefault(); api.redo() }; break
        case 'KeyR': if (!e.ctrlKey && !e.metaKey) { e.preventDefault(); api.recording ? api.stopRecording() : api.startRecording() }; break
        case 'KeyB': if (activeId && !e.ctrlKey && !e.metaKey) { e.preventDefault(); api.splitAtPlayhead(activeId) }; break
        case 'KeyL': if (!e.ctrlKey) api.toggleLoop(); break
        case 'KeyS': if (e.ctrlKey || e.metaKey) { e.preventDefault(); void saveRef.current() } else setTool('select'); break
        case 'Home': api.seek(0); break
        case 'End': api.seek(api.total); break
        case 'ArrowLeft': e.preventDefault(); api.seek(api.getPlayhead() - (e.shiftKey ? 10 : 2)); break
        case 'ArrowRight': e.preventDefault(); api.seek(api.getPlayhead() + (e.shiftKey ? 10 : 2)); break
        case 'Equal': if (e.ctrlKey) { e.preventDefault(); api.setZoom(Math.min(api.zoom * 1.5, 10)) }; break
        case 'Minus': if (e.ctrlKey) { e.preventDefault(); api.setZoom(Math.max(api.zoom / 1.5, 0.15)) }; break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [api])

  const openPanel = (tab: 'mixer' | 'eq' | 'effects') => {
    const mobile = window.innerWidth < 768
    setFloatWin(p => p ? { ...p, tab, minimized: false } : {
      tab,
      // Center-ish in the viewport (position:fixed is now viewport-relative after
      // the fade-in transform fix), clamped so it never lands under the app sidebar.
      x: mobile ? 0 : Math.max(240, Math.round(window.innerWidth / 2 - 330)),
      y: mobile ? Math.max(0, window.innerHeight - 300) : 90,
      w: mobile ? window.innerWidth : 660, h: 300, minimized: false,
    })
  }

  const doExportMix = async () => {
    setIsExporting(true)
    try {
      const names = api.tracks.map(t2 => t2.name).filter(Boolean)
      const filename = (names.length > 1 ? names.slice(0, 3).join(' x ') : names[0] ?? 'mix')
      await api.exportMix(filename)
      setShowExport(false)
    } finally { setIsExporting(false) }
  }

  const mainTrack = api.tracks.find(tr => tr.kind === 'main')
  const filteredLib = libSearch.trim()
    ? libTracks.filter(tr => tr.title.toLowerCase().includes(libSearch.toLowerCase()) || (tr.artist ?? '').toLowerCase().includes(libSearch.toLowerCase()))
    : libTracks

  return (
    <div className="flex flex-col fade-in relative" style={{ height: '100%', overflow: 'hidden', background: '#141414', fontFamily: 'monospace' }}>
      {/* hidden inputs */}
      <input ref={mainInputRef} type="file" accept="audio/*" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) api.loadMainFromFile(f); e.target.value = '' }} />
      <input ref={extraInputRef} type="file" accept="audio/*" multiple className="hidden"
        onChange={e => { Array.from(e.target.files ?? []).forEach(api.addTrackFromFile); e.target.value = '' }} />

      {/* ═══ TOOLBAR ═══ */}
      <div className="shrink-0 flex items-center gap-2 px-3 border-b overflow-x-auto" style={{ height: 44, background: '#242424', borderColor: '#333', minWidth: 0 }}>
        <button onClick={() => setShowLibrary(p => !p)} className="px-2 py-1 rounded text-xs" style={{ background: showLibrary ? '#3a3a3a' : 'transparent', color: '#aaa' }}><Music2 size={14} /></button>
        <div className="w-px h-6" style={{ background: '#333' }} />
        {/* Projects */}
        <button ref={projBtnRef} onClick={() => setShowProjects(v => !v)} title="Projets" className="p-1.5 rounded hover:bg-white/10" style={{ background: showProjects ? '#3a3a3a' : 'transparent', color: '#aaa' }}><FolderOpen size={14} /></button>
        <input value={projectName} onChange={e => setProjectName(e.target.value)} placeholder="Projet…" className="px-1.5 py-0.5 rounded text-xs outline-none tabular-nums" style={{ width: 108, background: '#0a0a0a', color: '#ccc', border: '1px solid #333' }} />
        <button onClick={() => saveProject()} disabled={saveState === 'saving'} title="Sauvegarder (Ctrl+S)" className="p-1.5 rounded hover:bg-white/10" style={{ color: saveState === 'saved' ? '#2eb872' : saveState === 'error' ? '#e74c3c' : '#aaa' }}>
          {saveState === 'saving' ? <Loader2 size={13} className="animate-spin" /> : saveState === 'saved' ? <Check size={13} /> : <Save size={13} />}
        </button>
        {showProjects && (() => {
          const r = projBtnRef.current?.getBoundingClientRect()
          const left = Math.max(4, Math.min((r?.left ?? 8), window.innerWidth - 268))
          const top = (r?.bottom ?? 44) + 4
          return (
          <>
            <div className="fixed inset-0" style={{ zIndex: 60 }} onClick={() => setShowProjects(false)} />
            <div className="rounded-lg overflow-hidden" style={{ position: 'fixed', left, top, width: 264, zIndex: 61, background: '#1e1e1e', border: '1px solid #333', boxShadow: '0 8px 24px rgba(0,0,0,0.65)' }}>
              <div className="flex items-center justify-between px-3 py-2" style={{ borderBottom: '1px solid #2a2a2a' }}>
                <span className="text-[10px] uppercase tracking-wider" style={{ color: '#666' }}>Projets récents</span>
                <button onClick={newProject} className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded" style={{ color: '#2eb872', background: '#2eb87215' }}><FilePlus2 size={11} /> Nouveau</button>
              </div>
              <div style={{ maxHeight: 300, overflowY: 'auto' }}>
                {projects.length === 0
                  ? <p className="text-[10px] text-center py-5" style={{ color: '#555' }}>Aucun projet sauvegardé</p>
                  : projects.map(p => (
                    <div key={p.id} onClick={() => openProject(p.id)} className="group flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-white/5" style={{ background: currentProjectId === p.id ? '#2a2a2a' : 'transparent', borderLeft: currentProjectId === p.id ? '2px solid #4f8ef7' : '2px solid transparent' }}>
                      <Music2 size={11} className="shrink-0" style={{ color: currentProjectId === p.id ? '#4f8ef7' : '#555' }} />
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] truncate" style={{ color: '#ccc' }}>{p.name}</p>
                        <p className="text-[8px]" style={{ color: '#555' }}>{new Date(p.updatedAt).toLocaleString()}</p>
                      </div>
                      <button onClick={e => deleteProject(e, p.id)} title="Supprimer" className="opacity-0 group-hover:opacity-100 shrink-0 p-0.5" style={{ color: '#e74c3c' }}><Trash2 size={11} /></button>
                    </div>
                  ))}
              </div>
            </div>
          </>
          )
        })()}
        <div className="w-px h-6" style={{ background: '#333' }} />
        <button onClick={() => api.seek(0)} className="p-1.5 rounded hover:bg-white/10" style={{ color: '#aaa' }}><SkipBack size={14} /></button>
        <button onClick={api.stop} className="p-1.5 rounded hover:bg-white/10" style={{ color: '#aaa' }}><Square size={14} /></button>
        <button onClick={api.togglePlay} className="w-9 h-9 rounded flex items-center justify-center" style={{ background: api.playing ? '#f0a830' : '#2eb872', color: '#000' }}>
          {api.playing ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}
        </button>
        <button onClick={api.toggleLoop} className="p-1.5 rounded" style={{ color: api.loop ? '#f0a830' : '#666', background: api.loop ? 'rgba(240,168,48,0.15)' : 'transparent' }}><Repeat size={14} /></button>
        <button onClick={() => api.recording ? api.stopRecording() : api.startRecording()} title={api.recording ? t('studio_stop_record') : t('studio_record')}
          className="p-1.5 rounded flex items-center gap-1" style={{ color: api.recording ? '#fff' : '#e74c3c', background: api.recording ? '#e74c3c' : 'transparent' }}>
          <Mic size={14} className={api.recording ? 'animate-pulse' : ''} />
          {api.recording && <span className="text-[10px] tabular-nums">{fmtTime(api.recElapsed)}</span>}
        </button>
        <div className="w-px h-6" style={{ background: '#333' }} />
        <div className="px-2 py-1 rounded text-sm tabular-nums" style={{ background: '#0a0a0a', color: '#4f8ef7', minWidth: 64, textAlign: 'center' }}>{fmtTime(api.playhead)}</div>
        <span className="text-xs" style={{ color: '#444' }}>/</span>
        <div className="text-xs tabular-nums" style={{ color: '#555' }}>{fmtTime(api.total)}</div>
        <div className="w-px h-6" style={{ background: '#333' }} />
        <div className="flex items-center gap-1">
          <span className="text-xs" style={{ color: '#555' }}>{t('toolbar_bpm_label')}</span>
          {api.detectingBpm
            ? <div className="w-14 flex items-center justify-center"><Loader2 size={12} className="animate-spin" style={{ color: '#f0a830' }} /></div>
            : <input type="number" value={api.bpm} min={40} max={300} onChange={e => api.setBpm(Number(e.target.value))}
                className="w-14 px-1 py-0.5 rounded text-xs tabular-nums text-center outline-none" style={{ background: '#0a0a0a', color: '#f0a830', border: '1px solid #333' }} />}
        </div>
        <div className="w-px h-6" style={{ background: '#333' }} />
        <div className="flex rounded overflow-hidden border" style={{ borderColor: '#333' }}>
          <button onClick={() => setTool('select')} title={t('shortcut_select_tool')} className="px-2 py-1.5 flex items-center" style={{ background: tool === 'select' ? '#3a3a3a' : 'transparent', color: tool === 'select' ? '#ddd' : '#555' }}><MousePointer size={12} /></button>
          <button onClick={() => setTool('move')} title={t('shortcut_move_tool')} className="px-2 py-1.5 flex items-center" style={{ background: tool === 'move' ? '#3a3a3a' : 'transparent', color: tool === 'move' ? '#ddd' : '#555' }}><Move size={12} /></button>
        </div>
        <div className="w-px h-6" style={{ background: '#333' }} />
        <button onClick={api.undo} disabled={!api.canUndo} title={t('studio_undo')} className="p-1.5 rounded hover:bg-white/10 disabled:opacity-30" style={{ color: '#aaa' }}><Undo2 size={14} /></button>
        <button onClick={api.redo} disabled={!api.canRedo} title={t('studio_redo')} className="p-1.5 rounded hover:bg-white/10 disabled:opacity-30" style={{ color: '#aaa' }}><Redo2 size={14} /></button>
        <div className="w-px h-6" style={{ background: '#333' }} />
        {api.tracks.filter(tr => tr.selection).map(tr => (
          <div key={tr.id} className="flex items-center gap-0.5">
            <span className="text-[9px] px-1 rounded" style={{ background: '#2a2a2a', color: '#666' }}>{tr.name.slice(0, 5)}</span>
            <button onClick={() => api.cutSelection(tr.id)} className="p-1.5 rounded hover:bg-white/10" style={{ color: '#aaa' }} title={t('shortcut_cut')}><Scissors size={13} /></button>
            <button onClick={() => api.copySelection(tr.id)} className="p-1.5 rounded hover:bg-white/10" style={{ color: '#aaa' }} title={t('shortcut_copy')}><Copy size={13} /></button>
            <button onClick={() => api.trimToSelection(tr.id)} className="p-1.5 rounded hover:bg-white/10" style={{ color: '#aaa' }} title={t('studio_trim')}><Crop size={13} /></button>
            <button onClick={() => api.applyEdit(tr.id, 'fadeIn')} className="p-1.5 rounded hover:bg-white/10" style={{ color: '#aaa' }} title={t('studio_fade_in')}><TrendingUp size={13} /></button>
            <button onClick={() => api.applyEdit(tr.id, 'fadeOut')} className="p-1.5 rounded hover:bg-white/10" style={{ color: '#aaa' }} title={t('studio_fade_out')}><TrendingDown size={13} /></button>
            <button onClick={() => api.applyEdit(tr.id, 'silence')} className="p-1.5 rounded hover:bg-white/10" style={{ color: '#aaa' }} title={t('studio_silence')}><VolumeX size={13} /></button>
            <button onClick={() => api.applyEdit(tr.id, 'normalize')} className="p-1.5 rounded hover:bg-white/10" style={{ color: '#aaa' }} title={t('studio_normalize')}><Maximize2 size={13} /></button>
            <button onClick={() => api.applyEdit(tr.id, 'reverse')} className="p-1.5 rounded hover:bg-white/10" style={{ color: '#aaa' }} title={t('studio_reverse')}><FlipHorizontal2 size={13} /></button>
            <button onClick={() => api.undoCut(tr.id)} className="p-1.5 rounded hover:bg-white/10" style={{ color: '#aaa' }} title={t('shortcut_restore')}><RotateCcw size={13} /></button>
          </div>
        ))}
        <div className="w-px h-6" style={{ background: '#333' }} />
        <button onClick={() => api.setZoom(Math.min(api.zoom * 1.4, 10))} className="p-1.5 rounded hover:bg-white/10" style={{ color: '#aaa' }}><ZoomIn size={14} /></button>
        <div className="text-xs tabular-nums" style={{ color: '#444', minWidth: 28 }}>{api.zoom.toFixed(1)}x</div>
        <button onClick={() => api.setZoom(Math.max(api.zoom / 1.4, 0.15))} className="p-1.5 rounded hover:bg-white/10" style={{ color: '#aaa' }}><ZoomOut size={14} /></button>
        <div className="flex-1" />
        <div className="hidden sm:block"><LevelMeter analyser={api.analyser} /></div>
        <div className="w-px h-6 hidden sm:block" style={{ background: '#333' }} />
        <div className="flex items-center gap-1.5">
          <span className="text-xs" style={{ color: '#555' }}>×</span>
          <input type="range" min={0.5} max={2} step={0.05} value={api.rate} onChange={e => api.setRate(Number(e.target.value))} className="w-20 accent-orange-400" />
          <span className="text-xs w-8 tabular-nums" style={{ color: '#888' }}>{api.rate.toFixed(2)}</span>
        </div>
        <div className="w-px h-6" style={{ background: '#333' }} />
        <button onClick={() => setShowExport(true)} className="flex items-center gap-1 px-2 py-1.5 rounded text-xs hover:bg-white/10" style={{ color: '#2eb872' }}><Download size={12} /><span>{t('btn_export')}</span></button>
        <div className="w-px h-6" style={{ background: '#333' }} />
        <button onClick={() => openPanel(floatWin?.tab ?? 'mixer')} className="p-1.5 rounded hover:bg-white/10" style={{ color: floatWin ? '#f0a830' : '#666' }}><Activity size={14} /></button>
        <button onClick={() => setShowShortcuts(p => !p)} className="p-1.5 rounded hover:bg-white/10" style={{ color: '#666' }}><Keyboard size={14} /></button>
      </div>

      {/* ═══ MAIN AREA ═══ */}
      <div className="flex flex-1 min-h-0 relative">
        {showLibrary && <div className="fixed inset-0 z-30 md:hidden" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={() => setShowLibrary(false)} />}
        {showLibrary && (
          <div className="fixed inset-y-0 left-0 z-40 md:relative md:inset-auto md:z-auto shrink-0 flex overflow-y-auto" style={{ width: 200, maxHeight: 'calc(100vh - 44px)' }}>
            <div className="flex flex-col border-r w-full" style={{ background: '#1a1a1a', borderColor: '#2e2e2e', minHeight: 0 }}>
              <div className="shrink-0">
                <div className="px-3 py-2 text-xs font-bold uppercase tracking-wider" style={{ color: '#555', borderBottom: '1px solid #2e2e2e' }}>{t('library_sidebar_title')}</div>
                <div className="mx-2 mt-2 flex items-center gap-1.5 rounded px-2 py-1" style={{ background: '#111', border: '1px solid #2a2a2a' }}>
                  <Search size={10} style={{ color: '#444', flexShrink: 0 }} />
                  <input value={libSearch} onChange={e => setLibSearch(e.target.value)} placeholder={t('btn_search')} className="flex-1 bg-transparent outline-none text-[10px]" style={{ color: '#aaa', minWidth: 0 }} />
                  {libSearch && <button onClick={() => setLibSearch('')} style={{ color: '#444', lineHeight: 1 }}><X size={9} /></button>}
                </div>
                <div className="mx-2 my-2 rounded border-2 border-dashed flex flex-col items-center justify-center gap-1 cursor-pointer py-3 text-center hover:border-blue-600/50" style={{ borderColor: '#2e2e2e', color: '#444' }} onClick={() => mainInputRef.current?.click()}>
                  <Wand2 size={16} className="mb-1" />
                  <p className="text-[10px]">{t('btn_import_file')}</p>
                </div>
                <div className="mx-2 mb-2 rounded border-2 border-dashed flex flex-col items-center justify-center gap-1 cursor-pointer py-2 text-center hover:border-green-600/50" style={{ borderColor: '#2a2a2a', color: '#444', fontSize: 10 }} onClick={() => extraInputRef.current?.click()}>
                  <Plus size={12} /> {t('btn_add_track')}
                </div>
              </div>
              <div className="flex-1 overflow-y-auto" style={{ minHeight: 0 }}>
                {loadingLib
                  ? <div className="flex justify-center py-4"><Loader2 size={14} className="animate-spin" style={{ color: '#555' }} /></div>
                  : filteredLib.length === 0
                    ? <p className="text-[10px] text-center py-4" style={{ color: '#444' }}>{t('search_no_results')}</p>
                    : filteredLib.map(track => (
                      <div key={track.id} className="group">
                        <div className="flex items-center pr-1" style={{ background: mainTrack?.trackId === track.id ? '#2a2a2a' : 'transparent', borderLeft: mainTrack?.trackId === track.id ? '2px solid #4f8ef7' : '2px solid transparent' }}>
                          <button onClick={() => workspace && api.addTrackFromUrl(trackApi.streamUrl(workspace.id, track.id), track.title, track.id)} className="flex items-start gap-1.5 px-2 py-1.5 text-left text-xs flex-1 truncate" style={{ color: '#666' }}>
                            <Music2 size={10} className="mt-0.5 shrink-0" style={{ color: '#444' }} />
                            <div className="truncate">
                              <p className="truncate">{track.title}</p>
                              {track.artist && <p className="truncate text-[9px]" style={{ color: '#444' }}>{track.artist}</p>}
                            </div>
                          </button>
                          <button title={t('studio_load_main')} onClick={() => workspace && api.loadMainFromUrl(trackApi.streamUrl(workspace.id, track.id), track.title, track.id)}
                            className="opacity-0 group-hover:opacity-100 shrink-0 flex items-center justify-center rounded" style={{ width: 18, height: 18, color: mainTrack?.trackId === track.id ? '#4f8ef7' : '#888', background: '#1e1e1e', border: '1px solid #333' }}>
                            <Play size={9} />
                          </button>
                        </div>
                      </div>
                    ))}
              </div>
            </div>
          </div>
        )}

        {/* Workspace */}
        <div className="flex flex-col flex-1 min-w-0">
          <Timeline api={api} tool={tool} onContextMenu={(e, trackId) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, trackId }) }} onAddTrack={() => extraInputRef.current?.click()} />
        </div>
      </div>

      {/* Floating panel */}
      {floatWin && <FloatingPanel api={api} win={floatWin} setWin={setFloatWin} />}

      {/* Shortcuts modal */}
      {showShortcuts && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.7)' }} onClick={() => setShowShortcuts(false)}>
          <div className="rounded-lg p-5 max-w-md w-full mx-4" style={{ background: '#242424', border: '1px solid #3a3a3a' }} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold" style={{ color: '#e0e0e0' }}>{t('shortcuts_modal_title')}</h3>
              <button onClick={() => setShowShortcuts(false)} style={{ color: '#555' }}>✕</button>
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs" style={{ color: '#888' }}>
              {[['Espace', t('shortcut_play_pause')], ['Échap', t('shortcut_stop')], ['S', t('shortcut_select_tool')], ['V', t('shortcut_move_tool')],
                ['Clic ruler', t('shortcut_seek')], ['Drag (S)', t('shortcut_select')], ['Drag clip (V)', t('shortcut_move_clip')],
                ['Ctrl+Scroll', t('shortcut_zoom')], ['Home / End', t('shortcut_start_end')], ['← →', t('shortcut_seek_2s')],
                ['Ctrl+A', t('shortcut_select_all')], ['Ctrl+C', t('shortcut_copy')], ['Ctrl+X / Suppr', t('shortcut_cut')],
                ['Ctrl+V', t('shortcut_paste')], ['Ctrl+Z / ⇧Z', t('shortcut_undo')], ['L', t('shortcut_loop')],
                ['B', t('shortcut_split')], ['R', t('shortcut_record')],
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

      {/* Export modal */}
      {showExport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.75)' }} onClick={() => setShowExport(false)}>
          <div className="rounded-xl p-6 w-80" style={{ background: '#242424', border: '1px solid #3a3a3a' }} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-bold" style={{ color: '#e0e0e0' }}>{t('export_modal_title')}</h3>
              <button onClick={() => setShowExport(false)} style={{ color: '#555' }}><X size={14} /></button>
            </div>
            <div className="space-y-3">
              {api.tracks.some(tr => tr.buffer) && (
                <button onClick={doExportMix} disabled={isExporting} className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm hover:bg-white/5 disabled:opacity-60" style={{ background: '#1a1a1a', color: '#e0e0e0', border: '1px solid #2e2e2e' }}>
                  {isExporting ? <Loader2 size={16} className="animate-spin" style={{ color: '#f0a830' }} /> : <Download size={16} style={{ color: '#f0a830' }} />}
                  <div className="text-left">
                    <p className="font-medium">{t('btn_export')} (WAV)</p>
                    <p className="text-[10px]" style={{ color: '#555' }}>{isExporting ? t('loading') : t('export_stem_desc')}</p>
                  </div>
                </button>
              )}
              {mainTrack?.trackId && workspace && (['vocals', 'instrumental'] as const).map(stem => (
                <a key={stem} href={trackApi.stemUrl(workspace.id, mainTrack.trackId!, stem)} download={`${mainTrack.name}_${stem}.mp3`}
                  className="flex items-center gap-3 px-4 py-3 rounded-lg text-sm hover:bg-white/5 no-underline" style={{ background: '#1a1a1a', color: '#e0e0e0', border: '1px solid #2e2e2e', display: 'flex' }} onClick={() => setShowExport(false)}>
                  <Download size={16} style={{ color: stem === 'vocals' ? '#9b59e2' : '#2eb872' }} />
                  <div className="text-left">
                    <p className="font-medium">{stem === 'vocals' ? t('export_download_vocals') : t('export_download_instru')}</p>
                    <p className="text-[10px]" style={{ color: '#555' }}>{t('export_stem_desc')}</p>
                  </div>
                </a>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Context menu */}
      {ctxMenu && (() => {
        const track = api.tracks.find(tr => tr.id === ctxMenu.trackId)
        const canSeparate = track?.kind === 'main' && !!track.trackId && !api.separating
        const hasCuts = (track?.cuts.length ?? 0) > 0
        const hasBuffer = !!track?.buffer
        const mx = Math.min(ctxMenu.x, window.innerWidth - 236)
        const my = Math.min(ctxMenu.y, window.innerHeight - 430)
        const item = (disabled: boolean, danger = false): React.CSSProperties => ({ color: disabled ? '#3a3a3a' : danger ? '#e74c3c' : '#ccc', background: 'transparent', cursor: disabled ? 'not-allowed' : 'pointer' })
        const hover = (danger = false) => (e: React.MouseEvent<HTMLButtonElement>) => { const el = e.currentTarget; if (!el.disabled) el.style.background = danger ? 'rgba(231,76,60,0.12)' : '#2a2a2a' }
        const out = (e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.background = 'transparent' }
        return (
          <>
            <div className="fixed inset-0" style={{ zIndex: 300 }} onClick={() => setCtxMenu(null)} onContextMenu={e => { e.preventDefault(); setCtxMenu(null) }} />
            <div style={{ position: 'fixed', left: mx, top: my, zIndex: 301, background: '#1e1e1e', border: '1px solid #333', borderRadius: 6, padding: '4px 0', boxShadow: '0 8px 24px rgba(0,0,0,0.65)', minWidth: 224 }}>
              {/* ── Per-track mixer ── */}
              <div className="px-3 py-2" style={{ borderBottom: '1px solid #2a2a2a' }}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] font-bold truncate" style={{ color: track?.color ?? '#ccc', maxWidth: 130 }} title={track?.name}>{track?.name}</span>
                  <div className="flex gap-1">
                    <button onClick={() => api.toggleSolo(ctxMenu.trackId)} title="Solo" className="rounded text-[8px] font-bold flex items-center justify-center" style={{ width: 16, height: 16, background: track?.solo ? '#f0a830' : '#2a2a2a', color: track?.solo ? '#000' : '#777' }}>S</button>
                    <button onClick={() => api.toggleMute(ctxMenu.trackId)} title="Muet" className="rounded text-[8px] font-bold flex items-center justify-center" style={{ width: 16, height: 16, background: track?.muted ? '#e74c3c' : '#2a2a2a', color: track?.muted ? '#fff' : '#777' }}>M</button>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="text-[8px] w-5" style={{ color: '#666' }}>Vol</span>
                  <input type="range" min={0} max={1.2} step={0.01} value={track?.gain ?? 0.85} onChange={e => api.setGain(ctxMenu.trackId, Number(e.target.value))} className="flex-1" style={{ accentColor: track?.color ?? '#4f8ef7', height: 3 }} />
                  <span className="text-[8px] tabular-nums w-6 text-right" style={{ color: '#666' }}>{Math.round((track?.gain ?? 0) * 100)}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[8px] w-5" style={{ color: '#666' }}>Pan</span>
                  <input type="range" min={-1} max={1} step={0.02} value={track?.pan ?? 0} onChange={e => api.setPan(ctxMenu.trackId, Number(e.target.value))} className="flex-1" style={{ accentColor: track?.color ?? '#4f8ef7', height: 3 }} />
                  <span className="text-[8px] tabular-nums w-6 text-right" style={{ color: '#666' }}>{track?.pan ? (track.pan > 0 ? `R${Math.round(track.pan * 100)}` : `L${Math.round(-track.pan * 100)}`) : 'C'}</span>
                </div>
                <button onClick={() => { openPanel('effects'); setCtxMenu(null) }} className="mt-2 w-full flex items-center justify-center gap-1 py-1 rounded text-[9px] hover:brightness-125" style={{ background: '#2a2a2a', color: '#bbb' }}>
                  <Activity size={10} /> Mixer &amp; effets
                </button>
              </div>
              <button disabled={!canSeparate} onClick={() => { if (canSeparate && workspace && track?.trackId) api.separateStems(workspace.id, track.trackId); setCtxMenu(null) }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-xs" style={item(!canSeparate)} onMouseEnter={hover()} onMouseLeave={out}>
                <Scissors size={11} /> {t('studio_separate_audio')}
              </button>
              <div style={{ height: 1, background: '#2a2a2a', margin: '4px 0' }} />
              <button disabled={!hasBuffer} onClick={() => { api.splitAtPlayhead(ctxMenu.trackId); setCtxMenu(null) }} className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-xs" style={item(!hasBuffer)} onMouseEnter={hover()} onMouseLeave={out}>
                <SplitSquareHorizontal size={11} /> {t('studio_split')}
              </button>
              <button disabled={!hasBuffer} onClick={() => { api.applyEdit(ctxMenu.trackId, 'normalize'); setCtxMenu(null) }} className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-xs" style={item(!hasBuffer)} onMouseEnter={hover()} onMouseLeave={out}>
                <Maximize2 size={11} /> {t('studio_normalize')}
              </button>
              <button disabled={!hasBuffer} onClick={() => { api.applyEdit(ctxMenu.trackId, 'reverse'); setCtxMenu(null) }} className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-xs" style={item(!hasBuffer)} onMouseEnter={hover()} onMouseLeave={out}>
                <FlipHorizontal2 size={11} /> {t('studio_reverse')}
              </button>
              <div style={{ height: 1, background: '#2a2a2a', margin: '4px 0' }} />
              <button onClick={() => { api.resetTrack(ctxMenu.trackId); setCtxMenu(null) }} className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-xs" style={item(false)} onMouseEnter={hover()} onMouseLeave={out}>
                <RotateCcw size={11} /> {t('studio_reset_track')}
              </button>
              <button disabled={!hasCuts} onClick={() => { api.undoCut(ctxMenu.trackId); setCtxMenu(null) }} className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-xs" style={item(!hasCuts)} onMouseEnter={hover()} onMouseLeave={out}>
                <Undo2 size={11} /> {t('shortcut_restore')}
              </button>
              <div style={{ height: 1, background: '#2a2a2a', margin: '4px 0' }} />
              <button disabled={track?.kind !== 'extra'} onClick={() => { api.removeTrack(ctxMenu.trackId); setCtxMenu(null) }} className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-xs" style={item(track?.kind !== 'extra', true)} onMouseEnter={hover(true)} onMouseLeave={out}>
                <Trash2 size={11} /> {t('studio_delete_track')}
              </button>
            </div>
          </>
        )
      })()}

      {api.stemError && (
        <div className="fixed bottom-4 right-4 px-4 py-2 rounded text-xs z-50" style={{ background: '#1a0808', color: '#e74c3c', border: '1px solid #3a1010' }} onClick={() => api.setStemError(null)}>
          {api.stemError}
        </div>
      )}

      {restoring && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.6)' }}>
          <div className="flex items-center gap-2 px-4 py-3 rounded-lg" style={{ background: '#1e1e1e', border: '1px solid #333', color: '#ccc' }}>
            <Loader2 size={16} className="animate-spin" style={{ color: '#4f8ef7' }} />
            <span className="text-xs">Chargement du projet…</span>
          </div>
        </div>
      )}
    </div>
  )
}
