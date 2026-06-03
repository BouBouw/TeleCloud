import { useState, useEffect, useCallback, useRef } from "react"
import {
  Search, Play, Pause,
  Download, Trash2, Music2, Plus,
  CloudDownload, Loader2, Pencil, X, Check, Upload, Send, ChevronDown,
} from "lucide-react"
import { trackApi, wsApi, botApi } from "../lib/api"
import type { Track, Workspace, Bot } from "../lib/api"
import ResourcesTab from "../components/ResourcesTab"
import { playerActions, usePlayerStore } from "../store/playerStore"
import { useI18n } from '../i18n'

/* Shared style tokens (mirrors Studio) */
const S = {
  bg:       '#111',
  panel:    '#1a1a1a',
  panelAlt: '#161616',
  hover:    '#1e1e1e',
  border:   '#2a2a2a',
  borderHi: '#3a3a3a',
  accent:   '#f0a830',
  text:     '#ccc',
  textDim:  '#888',
  textMute: '#555',
  textFade: '#333',
  input:    '#0a0a0a',
  red:      '#e74c3c',
}

const inputCls = "outline-none rounded px-2 py-1 text-xs"
const inputSty: React.CSSProperties = { background: S.input, color: S.text, border: `1px solid ${S.border}` }

/* TrackEditModal */
interface EditModalProps { track: Track; wsId: string; onClose: () => void; onSaved: (t: Track) => void }

function TrackEditModal({ track, wsId, onClose, onSaved }: EditModalProps) {
  const { t } = useI18n()
  const [title,        setTitle]        = useState(track.title)
  const [artist,       setArtist]       = useState(track.artist ?? '')
  const [featuring,    setFeaturing]    = useState(track.featuring ?? '')
  const [album,        setAlbum]        = useState(track.album ?? '')
  const [artworkUrl,   setArtworkUrl]   = useState(track.artworkUrl ?? '')
  const [localPreview, setLocalPreview] = useState<string | null>(null)
  const [uploading,    setUploading]    = useState(false)
  const [saving,       setSaving]       = useState(false)
  const [error,        setError]        = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return
    setLocalPreview(URL.createObjectURL(file)); setUploading(true); setError('')
    try {
      const { artworkUrl: url } = await trackApi.uploadArtwork(wsId, track.id, file)
      setArtworkUrl(url)
    } catch (err) { setError(String(err).replace('Error: ', '')); setLocalPreview(null) }
    finally { setUploading(false) }
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true); setError('')
    try {
      const { track: updated } = await trackApi.update(wsId, track.id, {
        title:      title.trim()      || undefined,
        artist:     artist.trim()     || undefined,
        featuring:  featuring.trim()  || undefined,
        album:      album.trim()      || undefined,
        artworkUrl: artworkUrl.trim() || undefined,
      })
      onSaved(updated); onClose()
    } catch (err) { setError(String(err).replace('Error: ', '')) }
    finally { setSaving(false) }
  }

  const Row = ({ label, value, setter, placeholder = '' }: { label: string; value: string; setter: (v: string) => void; placeholder?: string }) => (
    <div>
      <div className="text-[10px] uppercase mb-1" style={{ color: S.textMute }}>{label}</div>
      <input value={value} onChange={e => setter(e.target.value)} placeholder={placeholder}
        className={`${inputCls} w-full py-1.5`} style={inputSty} />
    </div>
  )

  const coverSrc = localPreview || artworkUrl || null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.75)' }}>
      <div className="rounded w-full max-w-sm mx-4" style={{ background: S.panel, border: `1px solid ${S.border}` }}>
        <div className="flex items-center justify-between px-4 py-2.5 border-b" style={{ borderColor: S.border }}>
          <span className="text-xs font-semibold" style={{ color: S.text }}>{t('edit_modal_title')}</span>
          <button onClick={onClose} style={{ color: S.textMute }} className="hover:brightness-150"><X size={14} /></button>
        </div>
        <form onSubmit={handleSave} className="flex flex-col gap-3 p-4">
          <div>
            <div className="text-[10px] uppercase mb-1" style={{ color: S.textMute }}>{t('field_cover')}</div>
            <div className="flex items-center gap-3">
              <div
                onClick={() => fileRef.current?.click()}
                className="shrink-0 rounded overflow-hidden flex items-center justify-center cursor-pointer"
                style={{ width: 56, height: 56, background: S.input, border: `1px solid ${S.border}` }}
              >
                {uploading
                  ? <Loader2 size={16} className="animate-spin" style={{ color: S.accent }} />
                  : coverSrc
                  ? <img src={coverSrc} alt="" className="w-full h-full object-cover" onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
                  : <Music2 size={18} style={{ color: S.textMute }} />}
              </div>
              <div className="flex-1 flex flex-col gap-1.5">
                <button type="button" onClick={() => fileRef.current?.click()}
                  className="flex items-center gap-1 text-[10px]" style={{ color: S.accent }}>
                  <Upload size={10} />{t('btn_upload_image')}
                </button>
                <input value={artworkUrl} onChange={e => { setArtworkUrl(e.target.value); setLocalPreview(null) }}
                  placeholder={t('placeholder_artwork_url')} className={`${inputCls} w-full`} style={inputSty} />
              </div>
            </div>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
          </div>
          <Row label={t('field_title')}  value={title}  setter={setTitle}  placeholder={t('placeholder_track_title')} />
          <Row label={t('field_artist')} value={artist} setter={setArtist} placeholder={t('placeholder_main_artist')} />
          <div>
            <div className="text-[10px] uppercase mb-1" style={{ color: S.textMute }}>{t('field_featuring')}</div>
            <input value={featuring} onChange={e => setFeaturing(e.target.value)} placeholder={t('placeholder_featuring')}
              className={`${inputCls} w-full py-1.5`} style={inputSty} />
            <div className="text-[9px] mt-0.5" style={{ color: S.textFade }}>{t('hint_separate_commas')}</div>
          </div>
          <Row label={t('field_album')} value={album} setter={setAlbum} placeholder={t('placeholder_album')} />
          {error && <div className="text-[10px] px-1" style={{ color: S.red }}>{error}</div>}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 py-1.5 rounded text-xs"
              style={{ background: S.input, color: S.textDim, border: `1px solid ${S.border}` }}>
              {t('btn_cancel')}
            </button>
            <button type="submit" disabled={saving || uploading}
              className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded text-xs font-semibold disabled:opacity-50"
              style={{ background: S.accent, color: '#000' }}>
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}{t('btn_save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

/* SendModal */
interface SendModalProps { wsId: string; tracks: Track[]; onClose: () => void }

function SendModal({ wsId, tracks, onClose }: SendModalProps) {
  const { t } = useI18n()
  const [bots,          setBots]          = useState<Bot[]>([])
  const [selectedBotId, setSelectedBotId] = useState('')
  const [loading,       setLoading]       = useState(true)
  const [sending,       setSending]       = useState(false)
  const [results,       setResults]       = useState<{ trackId: string; ok: boolean; error?: string }[] | null>(null)

  useEffect(() => {
    botApi.list(wsId)
      .then(d => {
        const r = d.bots.filter(b => b.status === 'running')
        setBots(r)
        if (r.length) setSelectedBotId(r[0].id)
      })
      .catch(() => {}).finally(() => setLoading(false))
  }, [wsId])

  const handleSend = async () => {
    if (!selectedBotId) return
    setSending(true)
    try {
      const { results: r } = await trackApi.sendViaTelegram(wsId, tracks.map(t => t.id), selectedBotId)
      setResults(r)
    } catch (err) {
      setResults(tracks.map(t => ({ trackId: t.id, ok: false, error: String(err).replace('Error: ', '') })))
    } finally { setSending(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.75)' }}>
      <div className="rounded w-full max-w-sm mx-4" style={{ background: S.panel, border: `1px solid ${S.border}` }}>
        <div className="flex items-center justify-between px-4 py-2.5 border-b" style={{ borderColor: S.border }}>
          <span className="text-xs font-semibold" style={{ color: S.text }}>
            {t('send_modal_title', { N: String(tracks.length), s: tracks.length > 1 ? 's' : '' })}
          </span>
          <button onClick={onClose} style={{ color: S.textMute }} className="hover:brightness-150"><X size={14} /></button>
        </div>
        <div className="p-4">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-8" style={{ color: S.textMute }}>
              <Loader2 size={16} className="animate-spin" /><span className="text-xs">{t('send_loading_bots')}</span>
            </div>
          ) : results ? (
            <div className="flex flex-col gap-1.5 max-h-56 overflow-y-auto">
              {results.map(r => {
                const t = tracks.find(tr => tr.id === r.trackId)
                return (
                  <div key={r.trackId} className="flex items-center gap-2 px-2 py-1.5 rounded text-xs"
                    style={{ background: r.ok ? 'rgba(46,184,114,0.1)' : 'rgba(231,76,60,0.1)', color: r.ok ? '#2eb872' : S.red }}>
                    {r.ok ? <Check size={12} /> : <X size={12} />}
                    <span className="truncate flex-1">{t?.title ?? r.trackId}</span>
                    {r.error && <span className="text-[9px] opacity-60 shrink-0 max-w-24 truncate">{r.error}</span>}
                  </div>
                )
              })}
            </div>
          ) : bots.length === 0 ? (
            <div className="flex flex-col items-center py-8 gap-2" style={{ color: S.textMute }}>
              <Send size={20} style={{ opacity: 0.3 }} />
              <p className="text-xs">{t('send_no_running_bots')}</p>
              <p className="text-[10px]" style={{ color: S.textFade }}>{t('send_no_bots_hint')}</p>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {bots.map(bot => (
                <label key={bot.id}
                  className="flex items-center gap-2.5 px-3 py-2 rounded cursor-pointer"
                  style={{
                    background: selectedBotId === bot.id ? `${S.accent}15` : S.input,
                    border: `1px solid ${selectedBotId === bot.id ? S.accent + '60' : S.border}`,
                  }}>
                  <input type="radio" className="accent-orange-400" checked={selectedBotId === bot.id}
                    onChange={() => setSelectedBotId(bot.id)} />
                  <div>
                    <div className="text-xs font-medium" style={{ color: selectedBotId === bot.id ? S.accent : S.text }}>{bot.name}</div>
                    <div className="text-[10px]" style={{ color: S.textMute }}>{bot.channelId}</div>
                  </div>
                </label>
              ))}
            </div>
          )}
          <div className="flex gap-2 mt-4">
            <button onClick={onClose}
              className="flex-1 py-1.5 rounded text-xs"
              style={{ background: S.input, color: S.textDim, border: `1px solid ${S.border}` }}>
              {results ? t('btn_close') : t('btn_cancel')}
            </button>
            {!results && !loading && bots.length > 0 && (
              <button disabled={sending || !selectedBotId} onClick={handleSend}
                className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded text-xs font-semibold disabled:opacity-50"
                style={{ background: S.accent, color: '#000' }}>
                {sending ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                {sending ? t('send_sending') : t('btn_send')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/* Library */
export default function Library() {
  const { t } = useI18n()
  const [query,      setQuery]      = useState("")
  const [selected,   setSelected]   = useState<Set<string>>(new Set())
  const [tracks,     setTracks]     = useState<Track[]>([])
  const [total,      setTotal]      = useState(0)
  const [loading,    setLoading]    = useState(false)
  const [tab,        setTab]        = useState<"library" | "search">("library")
  const [ws,         setWs]         = useState<Workspace | null>(null)
  const [editing,    setEditing]    = useState<Track | null>(null)
  const [sendTracks, setSendTracks] = useState<Track[] | null>(null)
  const [uploading,  setUploading]  = useState(false)
  const [addOpen,    setAddOpen]    = useState(false)
  const uploadRef = useRef<HTMLInputElement>(null)
  const addRef    = useRef<HTMLDivElement>(null)

  const { track: currentTrack, isPlaying } = usePlayerStore()

  useEffect(() => {
    wsApi.list().then(d => { if (d.workspaces.length) setWs(d.workspaces[0]) }).catch(() => {})
  }, [])

  const fetchTracks = useCallback(async () => {
    if (!ws) return
    setLoading(true)
    try {
      const data = await trackApi.list(ws.id, query || undefined)
      setTracks(data.tracks); setTotal(data.total)
    } catch { setTracks([]); setTotal(0) }
    finally { setLoading(false) }
  }, [ws, query])

  useEffect(() => { fetchTracks() }, [fetchTracks])

  const handleDelete = async (id: string) => {
    if (!ws) return
    await trackApi.delete(ws.id, id).catch(() => {})
    fetchTracks()
  }

  const handlePlay = (track: Track) => {
    if (!ws) return
    if (currentTrack?.id === track.id) { playerActions.togglePlay(); return }
    playerActions.setTrack({
      id: track.id, title: track.title, artist: track.artist ?? 'Unknown',
      artwork: track.artworkUrl, url: trackApi.streamUrl(ws.id, track.id), type: 'library',
    })
  }

  const handleTrackSaved = (updated: Track) =>
    setTracks(ts => ts.map(t => t.id === updated.id ? updated : t))

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (addRef.current && !addRef.current.contains(e.target as Node)) setAddOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    if (!ws || files.length === 0) return
    setUploading(true)
    try { await Promise.all(files.map(f => trackApi.uploadTrack(ws.id, f))); fetchTracks() }
    catch {} finally { setUploading(false); if (uploadRef.current) uploadRef.current.value = '' }
  }

  const handleDownload = () => {
    if (!ws) return
    let i = 0
    for (const id of selected) {
      const track = tracks.find(t => t.id === id); if (!track) continue
      setTimeout(() => {
        const a = document.createElement('a')
        a.href = trackApi.streamUrl(ws.id, id)
        a.download = `${track.title ?? 'track'}.mp3`
        document.body.appendChild(a); a.click(); document.body.removeChild(a)
      }, i * 400); i++
    }
  }

  const toggleSelect = (id: string) =>
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  const fmt     = (sec?: number) => sec ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}` : "--:--"
  const fmtSize = (b?: number)   => b   ? `${(b / 1048576).toFixed(1)} MB` : "--"

  const TabBtn = ({ id, label, icon }: { id: 'library' | 'search'; label: string; icon: React.ReactNode }) => (
    <button
      onClick={() => setTab(id)}
      className="flex items-center gap-1.5 px-3 py-1.5 text-xs transition-colors"
      style={{
        color: tab === id ? S.accent : S.textMute,
        borderBottom: `2px solid ${tab === id ? S.accent : 'transparent'}`,
        background: 'transparent',
      }}
    >{icon}<span className="hidden sm:block">{label}</span></button>
  )

  return (
    <>
      <div className="flex flex-col h-full fade-in" style={{ background: S.bg, color: S.text }}>

        {/* Top bar */}
        <div className="flex items-center gap-1 px-4 border-b shrink-0" style={{ borderColor: S.border, height: 36 }}>
          <TabBtn id="library" label={t('tab_library')} icon={<Music2 size={12} />} />
          <TabBtn id="search"  label={t('tab_resources')}   icon={<CloudDownload size={12} />} />
          {ws && (
            <span className="ml-auto text-[10px]" style={{ color: S.textMute }}>
              {ws.name} · <span style={{ color: S.textDim }}>{total}</span>
            </span>
          )}
        </div>

        {tab === "search" ? (
          <div className="flex-1 overflow-auto p-4">
            <ResourcesTab workspaceId={ws?.id ?? "demo"} onScrapeSuccess={fetchTracks} libraryTracks={tracks} />
          </div>
        ) : (
          <>
            {/* Toolbar */}
            <div className="flex items-center gap-2 flex-wrap px-3 sm:px-5 py-2 sm:py-3 border-b shrink-0" style={{ borderColor: S.border, background: S.panelAlt }}>
              <div className="flex items-center gap-2 flex-1 rounded-md px-3 py-2"
                style={{ background: S.input, border: `1px solid ${S.border}` }}>
                <Search size={13} style={{ color: S.textDim, flexShrink: 0 }} />
                <input
                  type="text"
                placeholder={t('search_placeholder')}
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  className="bg-transparent text-sm outline-none flex-1"
                  style={{ color: S.text }}
                />
                {query && (
                  <button onClick={() => setQuery('')} style={{ color: S.textFade }} className="hover:brightness-150">
                    <X size={10} />
                  </button>
                )}
              </div>
              <div ref={addRef} className="relative shrink-0">
                <button
                  onClick={() => setAddOpen(o => !o)}
                  className="flex items-center gap-2 px-4 py-2 rounded-md text-sm font-semibold"
                  style={{ background: S.accent, color: '#000' }}
                >
                  {uploading ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                  {t('btn_add')}
                  <ChevronDown size={12} style={{ transform: addOpen ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
                </button>
                {addOpen && (
                  <div className="absolute right-0 mt-1 w-44 rounded z-30 overflow-hidden"
                    style={{ background: S.panel, border: `1px solid ${S.border}` }}>
                    <button
                      onClick={() => { setAddOpen(false); setTab('search') }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:brightness-125"
                      style={{ color: S.textDim }}
                    >
                      <CloudDownload size={11} style={{ color: S.accent }} />{t('dropdown_resources')}
                    </button>
                    <button
                      disabled={uploading}
                      onClick={() => { setAddOpen(false); uploadRef.current?.click() }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:brightness-125 disabled:opacity-50"
                      style={{ color: S.textDim, borderTop: `1px solid ${S.border}` }}
                    >
                      <Upload size={11} style={{ color: S.accent }} />{t('dropdown_upload_local')}
                    </button>
                  </div>
                )}
              </div>
              <input ref={uploadRef} type="file" accept=".mp3,.wav,.ogg,.flac,.m4a" multiple className="hidden" onChange={handleUpload} />
            </div>

            {/* List header */}
            <div className="flex items-center gap-3 px-5 py-2 border-b shrink-0 select-none"
              style={{ borderColor: S.border, background: S.panelAlt }}>
              <div className="w-5 shrink-0">
                <input type="checkbox" className="accent-orange-400"
                  checked={selected.size === tracks.length && tracks.length > 0}
                  onChange={e => setSelected(e.target.checked ? new Set(tracks.map(t => t.id)) : new Set())} />
              </div>
              <div className="w-12 shrink-0" />
              <div className="flex-1 text-[9px] uppercase tracking-widest" style={{ color: S.textFade }}>{t('col_header_title')}</div>
              <div className="w-40 shrink-0 text-[9px] uppercase tracking-widest hidden md:block" style={{ color: S.textFade }}>{t('col_header_artist')}</div>
              <div className="w-14 shrink-0 text-[9px] uppercase tracking-widest hidden lg:block text-center" style={{ color: S.textFade }}>{t('col_header_format')}</div>
              <div className="w-12 shrink-0 text-[9px] uppercase tracking-widest hidden lg:block text-right font-mono" style={{ color: S.textFade }}>{t('col_header_duration')}</div>
              <div className="w-16 shrink-0 text-[9px] uppercase tracking-widest hidden xl:block text-right font-mono" style={{ color: S.textFade }}>{t('col_header_size')}</div>
              <div className="w-16 shrink-0" />
            </div>

            {/* Track rows */}
            <div className="flex-1 overflow-y-auto">
              {loading ? (
                <div className="flex items-center justify-center gap-2 py-20" style={{ color: S.textMute }}>
                  <Loader2 size={16} className="animate-spin" style={{ color: S.accent }} />
                  <span className="text-xs">{t('loading')}</span>
                </div>
              ) : tracks.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 gap-3">
                  <div className="rounded flex items-center justify-center"
                    style={{ width: 56, height: 56, background: S.panel, border: `1px solid ${S.border}` }}>
                    <Music2 size={24} style={{ color: S.textFade }} />
                  </div>
                  <p className="text-xs" style={{ color: S.textMute }}>{t('empty_library_title')}</p>
                  <p className="text-[10px]" style={{ color: S.textFade }}>{t('empty_library_desc')}</p>
                  <button
                    onClick={() => setTab("search")}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold mt-1"
                    style={{ background: S.accent, color: '#000' }}>
                    <CloudDownload size={11} />{t('btn_browse_resources')}
                  </button>
                </div>
              ) : (
                tracks.map((track, i) => {
                  const isActive      = currentTrack?.id === track.id
                  const isThisPlaying = isActive && isPlaying
                  const isSelected    = selected.has(track.id)
                  return (
                    <div
                      key={track.id}
                      className="flex items-center gap-3 px-5 group transition-colors"
                      style={{
                        height: 58,
                        borderBottom: `1px solid ${S.border}`,
                        background: isSelected
                          ? `${S.accent}10`
                          : isActive
                          ? `${S.accent}07`
                          : undefined,
                      }}
                      onMouseEnter={e => { if (!isSelected && !isActive) (e.currentTarget as HTMLElement).style.background = S.hover }}
                      onMouseLeave={e => { if (!isSelected && !isActive) (e.currentTarget as HTMLElement).style.background = '' }}
                    >
                      {/* Checkbox / index */}
                      <div className="w-5 shrink-0 flex items-center justify-center">
                        {isSelected ? (
                          <input type="checkbox" className="accent-orange-400" checked onChange={() => toggleSelect(track.id)} />
                        ) : (
                          <>
                            <span className="text-[10px] font-mono group-hover:hidden" style={{ color: S.textFade }}>{i + 1}</span>
                            <input type="checkbox" className="accent-orange-400 hidden group-hover:block" checked={false} onChange={() => toggleSelect(track.id)} />
                          </>
                        )}
                      </div>

                      {/* Artwork */}
                      <div
                        className="relative shrink-0 overflow-hidden rounded cursor-pointer"
                        style={{ width: 40, height: 40, background: S.input, border: `1px solid ${S.border}` }}
                        onClick={() => handlePlay(track)}
                      >
                        {track.artworkUrl
                          ? <img src={track.artworkUrl} alt="" className="w-full h-full object-cover" />
                          : <div className="w-full h-full flex items-center justify-center"><Music2 size={14} style={{ color: S.textFade }} /></div>
                        }
                        <div
                          className="absolute inset-0 flex items-center justify-center transition-opacity"
                          style={{ background: 'rgba(0,0,0,0.6)', opacity: isActive ? 1 : 0 }}
                          onMouseEnter={e => (e.currentTarget as HTMLElement).style.opacity = '1'}
                          onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLElement).style.opacity = '0' }}
                        >
                          {isThisPlaying
                            ? <Pause size={12} style={{ color: '#fff' }} />
                            : <Play  size={12} style={{ color: '#fff', transform: 'translateX(1px)' }} />
                          }
                        </div>
                      </div>

                      {/* Title */}
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium truncate leading-tight"
                          style={{ color: isActive ? S.accent : S.text }}>{track.title}</div>
                        <div className="flex items-center gap-1 mt-1">
                          {track.featuring && <span className="text-[10px] truncate" style={{ color: S.textMute }}>feat. {track.featuring}</span>}
                          {track.soundcloudUrl && !track.featuring && (
                            <a href={track.soundcloudUrl} target="_blank" rel="noopener noreferrer"
                              className="text-[10px]" style={{ color: S.textFade }}>SC</a>
                          )}
                        </div>
                      </div>

                      {/* Artist */}
                      <div className="w-40 shrink-0 min-w-0 hidden md:block">
                        <div className="text-xs truncate" style={{ color: S.textMute }}>{track.artist ?? 'Unknown'}</div>
                        {track.album && <div className="text-[10px] truncate" style={{ color: S.textFade }}>{track.album}</div>}
                      </div>

                      {/* Format */}
                      <div className="w-14 shrink-0 hidden lg:flex justify-center">
                        {track.format && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded font-mono font-bold"
                            style={{
                              background: track.format === 'wav' ? 'rgba(0,188,212,0.12)' : `${S.accent}15`,
                              color: track.format === 'wav' ? '#00bcd4' : S.accent,
                              border: `1px solid ${track.format === 'wav' ? 'rgba(0,188,212,0.25)' : S.accent + '30'}`,
                            }}
                          >{track.format.toUpperCase()}</span>
                        )}
                      </div>

                      {/* Duration */}
                      <div className="w-12 shrink-0 hidden lg:block text-right">
                        <span className="text-[10px] tabular-nums font-mono" style={{ color: S.textMute }}>{fmt(track.duration)}</span>
                      </div>

                      {/* Size */}
                      <div className="w-16 shrink-0 hidden xl:block text-right">
                        <span className="text-[10px] tabular-nums font-mono" style={{ color: S.textFade }}>{fmtSize(track.fileSize ?? undefined)}</span>
                      </div>

                      {/* Actions */}
                      <div className="w-16 shrink-0 flex items-center justify-end gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => setEditing(track)}
                          className="p-1.5 rounded hover:brightness-150"
                          style={{ color: S.textMute }}
                          title="Modifier"
                        >
                          <Pencil size={12} />
                        </button>
                        <button
                          onClick={() => handleDelete(track.id)}
                          className="p-1.5 rounded"
                          style={{ color: S.textFade }}
                          onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = S.red}
                          onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = S.textFade}
                          title="Supprimer"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </>
        )}
      </div>

      {/* Floating selection bar */}
      {selected.size > 0 && (
        <div
          className="fixed bottom-20 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 px-4 py-2 rounded"
          style={{ background: S.panel, border: `1px solid ${S.borderHi}`, boxShadow: '0 8px 32px rgba(0,0,0,0.6)' }}
        >
          <span className="text-xs font-semibold tabular-nums" style={{ color: S.accent }}>{t('selection_count', { N: String(selected.size), s: selected.size > 1 ? 's' : '' })}</span>
          <div style={{ width: 1, height: 14, background: S.border }} />
          <button onClick={handleDownload} className="flex items-center gap-1.5 text-xs hover:brightness-150" style={{ color: S.textDim }}>
            <Download size={12} />{t('btn_download')}
          </button>
          <div style={{ width: 1, height: 14, background: S.border }} />
          <button onClick={() => setSendTracks(tracks.filter(t => selected.has(t.id)))}
            className="flex items-center gap-1.5 text-xs hover:brightness-150" style={{ color: S.textDim }}>
            <Send size={12} />{t('btn_send_selected')}
          </button>
          <div style={{ width: 1, height: 14, background: S.border }} />
          <button
            onClick={() => { selected.forEach(id => handleDelete(id)); setSelected(new Set()) }}
            className="flex items-center gap-1.5 text-xs"
            style={{ color: S.textMute }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = S.red}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = S.textMute}
          >
            <Trash2 size={12} />{t('btn_delete_selected')}
          </button>
          <div style={{ width: 1, height: 14, background: S.border }} />
          <button onClick={() => setSelected(new Set())} className="hover:brightness-150" style={{ color: S.textFade }}>
            <X size={12} />
          </button>
        </div>
      )}

      {editing && ws && (
        <TrackEditModal track={editing} wsId={ws.id} onClose={() => setEditing(null)} onSaved={handleTrackSaved} />
      )}
      {sendTracks && ws && (
        <SendModal wsId={ws.id} tracks={sendTracks} onClose={() => setSendTracks(null)} />
      )}
    </>
  )
}
