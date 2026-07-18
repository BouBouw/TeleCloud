/* ─── useStudioEngine ─────────────────────────────────────────────────
 * React binding around StudioEngine. Owns the track list + transport +
 * master state, keeps the engine in sync, and drives the playhead with a
 * single requestAnimationFrame loop.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Track, Selection, StemKind } from './types'
import { StudioEngine, timelineTotal } from './engine'
import { effectiveDuration, addCut, timelineToSource } from './segments'
import { applyBufferOp, type BufferOp } from './bufferOps'
import {
  DEFAULT_EQ, DEFAULT_FX, EXTRA_COLORS, STEM_META, MAIN_COLOR,
  type EQBand, type EffectParams,
} from './constants'
import { encodeWAVFromBuffer, detectBpm } from './wav'

let recCounter = 0

let uid = 0
const nextId = (p: string) => `${p}-${++uid}-${Math.floor(performance.now())}`

function newTrack(partial: Partial<Track> & Pick<Track, 'id' | 'name' | 'color' | 'kind'>): Track {
  return {
    buffer: null, offset: 0, gain: 0.85, pan: 0, muted: false, solo: false,
    cuts: [], selection: null, ...partial,
  }
}

export interface StudioClipboard { srcData: Float32Array; sampleRate: number; duration: number; name: string }

/** One track as persisted in a saved project (audio itself is reloaded from `trackId`). */
export interface SavedStudioTrack {
  name: string; color: string; kind: Track['kind']; stem?: StemKind; trackId?: string
  offset: number; gain: number; pan: number; muted: boolean; solo: boolean
  cuts: Array<{ start: number; end: number }>
}
export interface StudioProjectData {
  version: number
  master: { bpm: number; rate: number; loop: boolean; masterVol: number; eq: EQBand[]; fx: EffectParams }
  tracks: SavedStudioTrack[]
}

export function useStudioEngine() {
  const engine = useMemo(() => new StudioEngine(DEFAULT_EQ), [])

  const [tracks, setTracks] = useState<Track[]>([])
  const tracksRef = useRef<Track[]>([])
  const commit = useCallback((next: Track[]) => { tracksRef.current = next; setTracks(next) }, [])

  const [playing, setPlaying] = useState(false)
  const [playhead, setPlayhead] = useState(0)
  const [rate, setRateState] = useState(1)
  const [loop, setLoop] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [bpm, setBpm] = useState(120)
  const [detectingBpm, setDetectingBpm] = useState(false)

  const [eq, setEq] = useState<EQBand[]>(DEFAULT_EQ)
  const [fx, setFx] = useState<EffectParams>(DEFAULT_FX)
  const [masterVol, setMasterVol] = useState(0.9)

  const [clipboard, setClipboard] = useState<StudioClipboard | null>(null)
  const [separating, setSeparating] = useState(false)
  const [stemError, setStemError] = useState<string | null>(null)

  const [recording, setRecording] = useState(false)
  const [recElapsed, setRecElapsed] = useState(0)

  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)

  const rafRef = useRef(0)
  const loopRef = useRef(loop); useEffect(() => { loopRef.current = loop }, [loop])
  const rateRef = useRef(rate); useEffect(() => { rateRef.current = rate }, [rate])
  const playheadRef = useRef(playhead); useEffect(() => { playheadRef.current = playhead }, [playhead])

  /* ── Undo / redo history (snapshots of the track list) ── */
  const pastRef = useRef<Track[][]>([])
  const futureRef = useRef<Track[][]>([])
  const snapshot = useCallback((): Track[] =>
    tracksRef.current.map(t => ({ ...t, cuts: t.cuts.slice(), selection: t.selection ? { ...t.selection } : null })), [])
  const syncHist = useCallback(() => { setCanUndo(pastRef.current.length > 0); setCanRedo(futureRef.current.length > 0) }, [])
  const pushHistory = useCallback(() => {
    pastRef.current.push(snapshot())
    if (pastRef.current.length > 80) pastRef.current.shift()
    futureRef.current = []
    syncHist()
  }, [snapshot, syncHist])
  const undo = useCallback(() => {
    if (pastRef.current.length === 0) return
    futureRef.current.push(snapshot())
    const prev = pastRef.current.pop()!
    commit(prev); engine.reschedule(prev); syncHist()
  }, [snapshot, syncHist, commit, engine])
  const redo = useCallback(() => {
    if (futureRef.current.length === 0) return
    pastRef.current.push(snapshot())
    const nxt = futureRef.current.pop()!
    commit(nxt); engine.reschedule(nxt); syncHist()
  }, [snapshot, syncHist, commit, engine])

  /* ── Keep engine params in sync ── */
  useEffect(() => { engine.setEQ(eq) }, [engine, eq])
  useEffect(() => { engine.setEffects(fx) }, [engine, fx])
  useEffect(() => { engine.setMasterVolume(masterVol) }, [engine, masterVol])
  useEffect(() => { engine.syncTracks(tracks) }, [engine, tracks])

  useEffect(() => () => {
    cancelAnimationFrame(rafRef.current)
    window.clearInterval(recTimerRef.current)
    try { recRef.current?.stream.getTracks().forEach(t => t.stop()) } catch { /* ignore */ }
    engine.dispose()
  }, [engine])

  const total = timelineTotal(tracks)
  const totalRef = useRef(total); useEffect(() => { totalRef.current = total }, [total])

  /* ── Playhead loop ── */
  const startRaf = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    const tick = () => {
      const head = engine.getPlayhead()
      if (head >= totalRef.current - 1e-3 && totalRef.current > 0) {
        if (loopRef.current) {
          engine.play(tracksRef.current, 0, rateRef.current)
          setPlayhead(0)
        } else {
          engine.stop(); setPlaying(false); setPlayhead(totalRef.current); return
        }
      } else {
        setPlayhead(head)
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [engine])

  /* ── Transport ── */
  const play = useCallback(async () => {
    if (tracksRef.current.every(t => !t.buffer)) return
    // if parked at (or past) the end, replay from the start instead of playing nothing
    const head = engine.getPlayhead()
    const from = head >= totalRef.current - 1e-3 ? 0 : head
    if (from === 0) setPlayhead(0)
    await engine.play(tracksRef.current, from, rateRef.current)
    setPlaying(true); startRaf()
  }, [engine, startRaf])

  const pause = useCallback(() => {
    const head = engine.pause(); setPlaying(false); setPlayhead(head)
    cancelAnimationFrame(rafRef.current)
  }, [engine])

  const togglePlay = useCallback(() => { if (engine.isPlaying) pause(); else play() }, [engine, play, pause])

  const stop = useCallback(() => {
    engine.stop(); setPlaying(false); setPlayhead(0)
    cancelAnimationFrame(rafRef.current)
  }, [engine])

  const seek = useCallback((to: number) => {
    const clamped = Math.max(0, Math.min(totalRef.current || to, to))
    engine.seek(tracksRef.current, clamped); setPlayhead(clamped)
  }, [engine])

  const setRate = useCallback((r: number) => {
    setRateState(r); rateRef.current = r; engine.setRate(tracksRef.current, r)
  }, [engine])

  const toggleLoop = useCallback(() => setLoop(p => !p), [])

  /* ── Track params (live, no reschedule) ── */
  const patchTrack = useCallback((id: string, patch: Partial<Track>) => {
    commit(tracksRef.current.map(t => t.id === id ? { ...t, ...patch } : t))
  }, [commit])

  const setGain = useCallback((id: string, gain: number) => patchTrack(id, { gain }), [patchTrack])
  const setPan = useCallback((id: string, pan: number) => patchTrack(id, { pan }), [patchTrack])
  const toggleMute = useCallback((id: string) => {
    const t = tracksRef.current.find(x => x.id === id); if (t) patchTrack(id, { muted: !t.muted })
  }, [patchTrack])
  const toggleSolo = useCallback((id: string) => {
    commit(tracksRef.current.map(t => ({ ...t, solo: t.id === id ? !t.solo : false })))
  }, [commit])

  /* ── Timing edits (reschedule if playing) ── */
  const setOffset = useCallback((id: string, offset: number) => {
    const next = tracksRef.current.map(t => t.id === id ? { ...t, offset: Math.max(0, offset) } : t)
    commit(next); engine.reschedule(next)
  }, [commit, engine])

  const setSelection = useCallback((id: string, selection: Selection | null) => {
    patchTrack(id, { selection })
  }, [patchTrack])

  /** Ripple-cut the current selection: removes the audio and closes the gap. */
  const cutSelection = useCallback((id: string) => {
    const t = tracksRef.current.find(x => x.id === id)
    if (!t || !t.buffer || !t.selection) return
    const { start, end } = t.selection
    if (end - start < 1e-3) return
    const srcStart = timelineToSource(start, t.cuts)
    const srcEnd = timelineToSource(end, t.cuts)
    const cuts = addCut(t.cuts, { start: srcStart, end: srcEnd }, t.buffer.duration)
    pushHistory()
    const next = tracksRef.current.map(x => x.id === id ? { ...x, cuts, selection: null } : x)
    commit(next); engine.reschedule(next)
  }, [commit, engine, pushHistory])

  const undoCut = useCallback((id: string) => {
    const t = tracksRef.current.find(x => x.id === id)
    if (!t || t.cuts.length === 0) return
    pushHistory()
    const next = tracksRef.current.map(x => x.id === id ? { ...x, cuts: x.cuts.slice(0, -1) } : x)
    commit(next); engine.reschedule(next)
  }, [commit, engine, pushHistory])

  const resetTrack = useCallback((id: string) => {
    pushHistory()
    const next = tracksRef.current.map(x => x.id === id ? { ...x, cuts: [], selection: null, offset: 0 } : x)
    commit(next); engine.reschedule(next)
  }, [commit, engine, pushHistory])

  /** Apply a length-preserving destructive edit over the selection (or whole track). */
  const applyEdit = useCallback((id: string, op: BufferOp, amount?: number) => {
    const t = tracksRef.current.find(x => x.id === id)
    if (!t || !t.buffer) return
    let s0 = 0, s1 = t.buffer.duration
    if (t.selection && t.selection.end - t.selection.start > 1e-3) {
      s0 = timelineToSource(t.selection.start, t.cuts)
      s1 = timelineToSource(t.selection.end, t.cuts)
    }
    const buffer = applyBufferOp(engine.ensureContext(), t.buffer, op, s0, s1, amount)
    pushHistory()
    const next = tracksRef.current.map(x => x.id === id ? { ...x, buffer } : x)
    commit(next); engine.reschedule(next)
  }, [commit, engine, pushHistory])

  /** Split a track in two at the current playhead (both halves share the buffer). */
  const splitAtPlayhead = useCallback((id: string) => {
    const t = tracksRef.current.find(x => x.id === id)
    if (!t || !t.buffer) return
    const eff = effectiveDuration(t.buffer.duration, t.cuts)
    const head = engine.getPlayhead()
    const local = head - t.offset
    if (local <= 1e-3 || local >= eff - 1e-3) return
    const srcCut = timelineToSource(local, t.cuts)
    const aCuts = addCut(t.cuts, { start: srcCut, end: t.buffer.duration }, t.buffer.duration)
    const bCuts = addCut(t.cuts, { start: 0, end: srcCut }, t.buffer.duration)
    const idB = nextId('trk')
    pushHistory()
    const next = tracksRef.current.flatMap(x => x.id === id
      ? [{ ...x, cuts: aCuts, selection: null },
         newTrack({ id: idB, name: `${x.name} (2)`, color: x.color, kind: 'extra', buffer: x.buffer, offset: head, cuts: bCuts })]
      : [x])
    commit(next); engine.reschedule(next)
  }, [commit, engine, pushHistory])

  /** Keep only the selection, ripple-removing everything before and after it. */
  const trimToSelection = useCallback((id: string) => {
    const t = tracksRef.current.find(x => x.id === id)
    if (!t || !t.buffer || !t.selection) return
    const { start, end } = t.selection
    if (end - start < 1e-3) return
    const s0 = timelineToSource(start, t.cuts)
    const s1 = timelineToSource(end, t.cuts)
    let cuts = addCut(t.cuts, { start: 0, end: s0 }, t.buffer.duration)
    cuts = addCut(cuts, { start: s1, end: t.buffer.duration }, t.buffer.duration)
    pushHistory()
    const next = tracksRef.current.map(x => x.id === id ? { ...x, cuts, selection: null } : x)
    commit(next); engine.reschedule(next)
  }, [commit, engine, pushHistory])

  const copySelection = useCallback((id: string) => {
    const t = tracksRef.current.find(x => x.id === id)
    if (!t || !t.buffer || !t.selection) return
    const { start, end } = t.selection
    const srcStart = timelineToSource(start, t.cuts)
    const srcEnd = timelineToSource(end, t.cuts)
    const data = t.buffer.getChannelData(0)
    const sr = t.buffer.sampleRate
    const s0 = Math.floor(srcStart * sr), s1 = Math.min(Math.ceil(srcEnd * sr), data.length)
    if (s1 <= s0) return
    setClipboard({ srcData: data.slice(s0, s1), sampleRate: sr, duration: (s1 - s0) / sr, name: `${t.name} ✂` })
  }, [])

  /* ── Track add / remove ── */
  const removeTrack = useCallback((id: string) => {
    const t = tracksRef.current.find(x => x.id === id)
    if (t?.objectUrl) URL.revokeObjectURL(t.objectUrl)
    pushHistory()
    const next = tracksRef.current.filter(x => x.id !== id)
    commit(next); engine.reschedule(next)
  }, [commit, engine, pushHistory])

  const decodeInto = useCallback(async (id: string, data: ArrayBuffer) => {
    try {
      const buffer = await engine.decode(data)
      const next = tracksRef.current.map(t => t.id === id ? { ...t, buffer } : t)
      commit(next); engine.reschedule(next)
      return buffer
    } catch { return null }
  }, [commit, engine])

  const addTrackFromFile = useCallback(async (file: File) => {
    const id = nextId('trk')
    const objectUrl = URL.createObjectURL(file)
    const color = EXTRA_COLORS[tracksRef.current.length % EXTRA_COLORS.length]
    const name = file.name.replace(/\.[^/.]+$/, '')
    pushHistory()
    commit([...tracksRef.current, newTrack({ id, name, color, kind: 'extra', objectUrl })])
    await decodeInto(id, await file.arrayBuffer())
  }, [commit, decodeInto, pushHistory])

  const addTrackFromUrl = useCallback(async (url: string, name: string, trackId?: string) => {
    const id = nextId('trk')
    const color = EXTRA_COLORS[tracksRef.current.length % EXTRA_COLORS.length]
    // de-dupe display name
    const existing = tracksRef.current.map(t => t.name)
    let display = name, n = 0
    while (existing.includes(display)) display = `${name} (${++n})`
    pushHistory()
    commit([...tracksRef.current, newTrack({ id, name: display, color, kind: 'extra', trackId })])
    const ab = await fetch(url).then(r => r.arrayBuffer())
    await decodeInto(id, ab)
  }, [commit, decodeInto, pushHistory])

  /** Load a track as the timeline's "main" clip (replaces the previous main). */
  const loadMainFromUrl = useCallback(async (url: string, name: string, trackId?: string) => {
    const withoutMain = tracksRef.current.filter(t => t.kind !== 'main' && t.kind !== 'stem')
    const id = nextId('main')
    commit([newTrack({ id, name, color: MAIN_COLOR, kind: 'main', trackId }), ...withoutMain])
    engine.stop(); setPlaying(false); setPlayhead(0)
    const ab = await fetch(url).then(r => r.arrayBuffer())
    const buffer = await decodeInto(id, ab)
    if (buffer) { setDetectingBpm(true); setTimeout(() => { try { setBpm(detectBpm(buffer)) } finally { setDetectingBpm(false) } }, 0) }
  }, [commit, decodeInto, engine])

  const loadMainFromFile = useCallback(async (file: File) => {
    const withoutMain = tracksRef.current.filter(t => t.kind !== 'main' && t.kind !== 'stem')
    const id = nextId('main')
    const objectUrl = URL.createObjectURL(file)
    commit([newTrack({ id, name: file.name.replace(/\.[^/.]+$/, ''), color: MAIN_COLOR, kind: 'main', objectUrl }), ...withoutMain])
    engine.stop(); setPlaying(false); setPlayhead(0)
    const buffer = await decodeInto(id, await file.arrayBuffer())
    if (buffer) { setDetectingBpm(true); setTimeout(() => { try { setBpm(detectBpm(buffer)) } finally { setDetectingBpm(false) } }, 0) }
  }, [commit, decodeInto, engine])

  const pasteClipboard = useCallback(async () => {
    if (!clipboard) return
    const id = nextId('paste')
    const color = EXTRA_COLORS[tracksRef.current.length % EXTRA_COLORS.length]
    const buffer = engine.ensureContext().createBuffer(1, clipboard.srcData.length, clipboard.sampleRate)
    buffer.copyToChannel(new Float32Array(clipboard.srcData), 0)
    pushHistory()
    const next = [...tracksRef.current, newTrack({ id, name: clipboard.name, color, kind: 'extra', buffer, offset: playhead })]
    commit(next); engine.reschedule(next)
  }, [clipboard, engine, commit, playhead, pushHistory])

  /* ── Microphone recording ── */
  const recRef = useRef<{ rec: MediaRecorder; chunks: Blob[]; stream: MediaStream; offset: number; startedAt: number } | null>(null)
  const recTimerRef = useRef(0)

  const stopRecording = useCallback(() => { recRef.current?.rec.stop() }, [])

  const startRecording = useCallback(async () => {
    if (recRef.current) return
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      })
    } catch {
      setStemError('Micro indisponible / permission refusée')
      return
    }
    const rec = new MediaRecorder(stream)
    const chunks: Blob[] = []
    const offset = engine.getPlayhead()
    rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data) }
    rec.onstop = async () => {
      window.clearInterval(recTimerRef.current)
      stream.getTracks().forEach(tr => tr.stop())
      const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' })
      recRef.current = null
      setRecording(false); setRecElapsed(0)
      if (blob.size === 0) return
      const id = nextId('rec')
      const color = EXTRA_COLORS[tracksRef.current.length % EXTRA_COLORS.length]
      pushHistory()
      commit([...tracksRef.current, newTrack({ id, name: `Rec ${++recCounter}`, color, kind: 'extra', offset })])
      await decodeInto(id, await blob.arrayBuffer())
    }
    recRef.current = { rec, chunks, stream, offset, startedAt: performance.now() }
    rec.start()
    setRecording(true); setRecElapsed(0)
    recTimerRef.current = window.setInterval(() => {
      if (recRef.current) setRecElapsed((performance.now() - recRef.current.startedAt) / 1000)
    }, 200)
  }, [engine, commit, decodeInto, pushHistory])

  /* ── Stem separation ── */
  const separateStems = useCallback(async (workspaceId: string, mainTrackDbId: string) => {
    setSeparating(true); setStemError(null)
    try {
      const token = localStorage.getItem('ss_token')
      const res = await fetch(`/api/workspaces/${workspaceId}/tracks/${mainTrackDbId}/separate`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      const q = token ? `?token=${encodeURIComponent(token)}` : ''
      // remove any previous stems, add fresh
      const base = tracksRef.current.filter(t => t.kind !== 'stem')
      const stemTracks: Track[] = (['instrumental', 'vocals'] as StemKind[]).map(stem =>
        newTrack({ id: nextId(stem), name: STEM_META[stem].name, color: STEM_META[stem].color, kind: 'stem', stem, muted: true }))
      commit([...base, ...stemTracks])
      await Promise.all((['instrumental', 'vocals'] as StemKind[]).map(async (stem, i) => {
        const url = `/api/workspaces/${workspaceId}/tracks/${mainTrackDbId}/stems/${stem}${q}`
        const ab = await fetch(url).then(r => r.arrayBuffer())
        await decodeInto(stemTracks[i].id, ab)
      }))
    } catch (err) {
      setStemError(err instanceof Error ? err.message : 'Separation failed')
    } finally { setSeparating(false) }
  }, [commit, decodeInto])

  /* ── Export ── */
  const exportMix = useCallback(async (filename: string) => {
    const buffer = await engine.renderMix(tracksRef.current, eq, fx, masterVol)
    const blob = encodeWAVFromBuffer(buffer)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = filename.endsWith('.wav') ? filename : `${filename}.wav`
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }, [engine, eq, fx, masterVol])

  /* ── Project save / restore ── */
  const serialize = useCallback((): StudioProjectData => {
    const mainTrackId = tracksRef.current.find(t => t.kind === 'main')?.trackId
    return {
      version: 1,
      master: { bpm, rate, loop, masterVol, eq, fx },
      // Only server-backed tracks are restorable (their audio is refetched by trackId).
      tracks: tracksRef.current
        .filter(t => t.trackId || (t.stem && mainTrackId))
        .map(t => ({
          name: t.name, color: t.color, kind: t.kind, stem: t.stem,
          trackId: t.trackId ?? (t.stem ? mainTrackId : undefined),
          offset: t.offset, gain: t.gain, pan: t.pan, muted: t.muted, solo: t.solo,
          cuts: t.cuts.map(c => ({ start: c.start, end: c.end })),
        })),
    }
  }, [bpm, rate, loop, masterVol, eq, fx])

  /** Rebuild the session from a saved project. `resolveUrl` maps a saved track to a fetch URL. */
  const restoreProject = useCallback(async (
    data: StudioProjectData,
    resolveUrl: (t: SavedStudioTrack) => string | null,
  ) => {
    engine.stop(); setPlaying(false); setPlayhead(0)
    cancelAnimationFrame(rafRef.current)
    const m = data.master ?? ({} as StudioProjectData['master'])
    setBpm(m.bpm ?? 120)
    setRateState(m.rate ?? 1); rateRef.current = m.rate ?? 1
    setLoop(!!m.loop)
    setMasterVol(m.masterVol ?? 0.9)
    if (m.eq) setEq(m.eq)
    if (m.fx) setFx(m.fx)
    pastRef.current = []; futureRef.current = []; syncHist()
    const placeholders = (data.tracks ?? []).map(t => newTrack({
      id: nextId(t.kind), name: t.name, color: t.color, kind: t.kind, stem: t.stem, trackId: t.trackId,
      offset: t.offset ?? 0, gain: t.gain ?? 0.85, pan: t.pan ?? 0, muted: !!t.muted, solo: !!t.solo, cuts: t.cuts ?? [],
    }))
    commit(placeholders)
    await Promise.all(placeholders.map(async (ph, i) => {
      const url = resolveUrl(data.tracks[i]); if (!url) return
      try { const ab = await fetch(url).then(r => r.arrayBuffer()); await decodeInto(ph.id, ab) }
      catch { /* skip unreadable track */ }
    }))
  }, [engine, commit, decodeInto, syncHist])

  /* ── EQ / FX setters ── */
  const setEqBand = useCallback((i: number, gain: number) => setEq(p => p.map((b, j) => j === i ? { ...b, gain } : b)), [])
  const resetEq = useCallback(() => setEq(DEFAULT_EQ), [])
  const patchFx = useCallback(<K extends keyof EffectParams>(key: K, patch: Partial<EffectParams[K]>) =>
    setFx(p => ({ ...p, [key]: { ...p[key], ...patch } })), [])

  return {
    // state
    tracks, tracksRef, playing, playhead, rate, loop, zoom, bpm, detectingBpm,
    eq, fx, masterVol, clipboard, separating, stemError, total,
    recording, recElapsed, canUndo, canRedo,
    getPlayhead: () => engine.getPlayhead(),
    analyser: () => engine.getAnalyser(),
    effectiveDuration: (t: Track) => t.buffer ? effectiveDuration(t.buffer.duration, t.cuts) : 0,
    // transport
    play, pause, togglePlay, stop, seek, setRate, toggleLoop, setZoom, setBpm,
    // track params
    setGain, setPan, toggleMute, toggleSolo, setOffset, setSelection,
    // edits
    cutSelection, copySelection, undoCut, resetTrack, pasteClipboard,
    applyEdit, splitAtPlayhead, trimToSelection,
    // history
    undo, redo, pushHistory,
    // add/remove
    addTrackFromFile, addTrackFromUrl, loadMainFromUrl, loadMainFromFile, removeTrack,
    // recording
    startRecording, stopRecording,
    // stems + export
    separateStems, exportMix, setStemError,
    // project save / restore
    serialize, restoreProject,
    // master
    setEqBand, resetEq, patchFx, setMasterVol,
  }
}

export type StudioApi = ReturnType<typeof useStudioEngine>
