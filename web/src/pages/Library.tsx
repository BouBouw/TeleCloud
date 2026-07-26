import { useState, useEffect, useCallback, useRef } from "react"
import {
  Search, Play, Pause,
  Download, Trash2, Music2, Plus,
  CloudDownload, Loader2, Pencil, X, Check, Upload, Send, ChevronDown,
  RefreshCw, Bot as BotIcon, CheckCircle2, Wand2, ArrowDownToLine, KeyRound,
} from "lucide-react"
import { trackApi, botApi } from "../lib/api"
import type { Track, Bot, Workspace } from "../lib/api"
import { useWorkspaces, workspaceActions } from '../store/workspaceStore'
import ResourcesTab from "../components/ResourcesTab"
import ConverterTab from "../components/ConverterTab"
import ExportTab from "../components/ExportTab"
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

function Row({ label, value, setter, placeholder = '' }: { label: string; value: string; setter: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase mb-1" style={{ color: S.textMute }}>{label}</div>
      <input value={value} onChange={e => setter(e.target.value)} placeholder={placeholder}
        className={`${inputCls} w-full py-1.5`} style={inputSty} />
    </div>
  )
}

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
  const [recentArtworks, setRecentArtworks] = useState<string[]>([])
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    trackApi.recentArtworks(wsId).then(d => setRecentArtworks(d.artworkUrls)).catch(() => {})
  }, [wsId])

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return
    setLocalPreview(URL.createObjectURL(file)); setUploading(true); setError('')
    try {
      const { artworkUrl: url } = await trackApi.uploadArtwork(wsId, track.id, file)
      setArtworkUrl(url)
      setRecentArtworks(prev => [url, ...prev.filter(u => u !== url)].slice(0, 3))
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
                {recentArtworks.length > 0 && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[9px] shrink-0" style={{ color: S.textFade }}>récents</span>
                    {recentArtworks.map((url, i) => (
                      <button key={i} type="button"
                        onClick={() => { setArtworkUrl(url); setLocalPreview(null) }}
                        className="shrink-0 rounded overflow-hidden"
                        style={{ width: 22, height: 22, padding: 0, border: `1px solid ${artworkUrl === url ? S.accent : S.border}` }}
                        title={url}>
                        <img src={url} alt="" className="w-full h-full object-cover"
                          onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
                      </button>
                    ))}
                  </div>
                )}
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
interface SendModalProps { wsId: string; tracks: Track[]; onClose: () => void; onSent?: (ids: string[]) => void }

type BotEntry = Bot & { wsId: string; wsName: string; canSend: boolean }

function SendModal({ wsId, tracks, onClose, onSent }: SendModalProps) {
  const { t } = useI18n()
  const { workspaces } = useWorkspaces()
  const [bots,          setBots]          = useState<BotEntry[]>([])
  const [selectedBotId, setSelectedBotId] = useState('')
  const [loading,       setLoading]       = useState(true)
  const [sending,       setSending]       = useState(false)
  const [results,       setResults]       = useState<{ trackId: string; ok: boolean; error?: string }[] | null>(null)
  const [message,       setMessage]       = useState('')
  const [groupFiles,    setGroupFiles]    = useState(false)
  const [showMsg,       setShowMsg]       = useState(false)

  useEffect(() => {
    if (!workspaces.length) return
    setLoading(true)
    Promise.all(
      workspaces.map((ws: Workspace) =>
        botApi.list(ws.id)
          .then(d => d.bots
            .filter(b => b.status === 'running')
            .map(b => ({
              ...b,
              wsId: ws.id,
              wsName: ws.name,
              canSend: ws.myLibSend !== false,
            } as BotEntry))
          )
          .catch(() => [] as BotEntry[])
      )
    ).then(results => {
      const all = results.flat()
      setBots(all)
      // pre-select: first bot from current ws that can send, else first enabled
      const preferred = all.find(b => b.wsId === wsId && b.canSend) ?? all.find(b => b.canSend)
      if (preferred) setSelectedBotId(preferred.id)
    }).finally(() => setLoading(false))
  }, [workspaces, wsId])

  const handleSend = async () => {
    if (!selectedBotId) return
    const bot = bots.find(b => b.id === selectedBotId)
    if (!bot) return
    setSending(true)
    try {
      const { results: r } = await trackApi.sendViaTelegram(
        wsId, tracks.map(t => t.id), selectedBotId,
        { message: message.trim() || undefined, groupFiles: groupFiles && tracks.length > 1 },
      )
      setResults(r)
      const okIds = r.filter(x => x.ok).map(x => x.trackId)
      if (okIds.length) onSent?.(okIds)
    } catch (err) {
      setResults(tracks.map(t => ({ trackId: t.id, ok: false, error: String(err).replace('Error: ', '') })))
    } finally { setSending(false) }
  }

  // Group bots by workspace for display
  const grouped = bots.reduce<Record<string, BotEntry[]>>((acc, b) => {
    ;(acc[b.wsId] ??= []).push(b)
    return acc
  }, {})

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
                const tr = tracks.find(tr => tr.id === r.trackId)
                return (
                  <div key={r.trackId} className="flex items-center gap-2 px-2 py-1.5 rounded text-xs"
                    style={{ background: r.ok ? 'rgba(46,184,114,0.1)' : 'rgba(231,76,60,0.1)', color: r.ok ? '#2eb872' : S.red }}>
                    {r.ok ? <Check size={12} /> : <X size={12} />}
                    <span className="truncate flex-1">{tr?.title ?? r.trackId}</span>
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
            <div className="flex flex-col gap-3 max-h-72 overflow-y-auto pr-1">
              {Object.entries(grouped).map(([wid, wBots]) => {
                const wsName = wBots[0].wsName
                const isCurrent = wid === wsId
                return (
                  <div key={wid}>
                    {/* Workspace label */}
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="text-[9px] uppercase tracking-wider font-semibold" style={{ color: isCurrent ? S.accent : S.textFade }}>
                        {wsName}
                      </span>
                      {isCurrent && (
                        <span className="text-[8px] px-1 py-0.5 rounded" style={{ background: `${S.accent}20`, color: S.accent, border: `1px solid ${S.accent}30` }}>actuel</span>
                      )}
                    </div>
                    <div className="flex flex-col gap-1">
                      {wBots.map(bot => (
                        <label key={bot.id}
                          className="flex items-center gap-2.5 px-3 py-2 rounded"
                          style={{
                            cursor: bot.canSend ? 'pointer' : 'not-allowed',
                            opacity: bot.canSend ? 1 : 0.45,
                            background: selectedBotId === bot.id ? `${S.accent}15` : S.input,
                            border: `1px solid ${selectedBotId === bot.id ? S.accent + '60' : S.border}`,
                          }}>
                          <input type="radio" className="accent-orange-400"
                            disabled={!bot.canSend}
                            checked={selectedBotId === bot.id}
                            onChange={() => bot.canSend && setSelectedBotId(bot.id)} />
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-medium" style={{ color: selectedBotId === bot.id ? S.accent : S.text }}>{bot.name}</div>
                            <div className="text-[10px]" style={{ color: S.textMute }}>{bot.channelId}</div>
                          </div>
                          {!bot.canSend && (
                            <span className="text-[9px] shrink-0 px-1.5 py-0.5 rounded" style={{ background: 'rgba(136,136,136,0.15)', color: S.textMute }}>
                              no perm
                            </span>
                          )}
                        </label>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          {/* Optional message + group toggle */}
          {!results && !loading && bots.length > 0 && (
            <div className="flex flex-col gap-2 mt-3">
              {tracks.length > 1 && (
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <div
                    onClick={() => setGroupFiles(g => !g)}
                    className="flex items-center justify-center rounded"
                    style={{ width: 14, height: 14, border: `1px solid ${groupFiles ? S.accent : S.border}`, background: groupFiles ? S.accent : 'transparent', flexShrink: 0 }}
                  >
                    {groupFiles && <Check size={9} style={{ color: '#000' }} />}
                  </div>
                  <span className="text-[11px]" style={{ color: S.textDim }}>Grouper les fichiers (album)</span>
                </label>
              )}
              <button
                onClick={() => setShowMsg(s => !s)}
                className="flex items-center gap-1 text-[10px] w-fit"
                style={{ color: showMsg ? S.accent : S.textMute, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
              >
                <Plus size={10} style={{ transform: showMsg ? 'rotate(45deg)' : 'none', transition: 'transform .15s' }} />
                {showMsg ? 'Masquer le message' : 'Ajouter un message (optionnel)'}
              </button>
              {showMsg && (
                <textarea
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                  placeholder="Message joint au(x) fichier(s)…"
                  rows={3}
                  className="text-xs rounded px-2 py-1.5 outline-none resize-none w-full"
                  style={{ background: S.input, color: S.text, border: `1px solid ${S.border}` }}
                />
              )}
            </div>
          )}
          <div className="flex gap-2 mt-3">
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

/* TelegramSyncModal — full MTProto history sync with SSE progress */
interface SyncModalProps { wsId: string; shown: boolean; onClose: () => void; onSynced: () => void; onBackground: () => void }

type SyncPhase = 'pick' | 'running' | 'done' | 'error'

function TelegramSyncModal({ wsId, shown, onClose, onSynced, onBackground }: SyncModalProps) {
  const [bots,          setBots]          = useState<Bot[]>([])
  const [loadingBots,   setLoadingBots]   = useState(true)
  const [selectedBotId, setSelectedBotId] = useState<string | null>(null)
  const [phase,         setPhase]         = useState<SyncPhase>('pick')
  const [total,         setTotal]         = useState(0)
  const [count,         setCount]         = useState(0)
  const [imported,      setImported]      = useState(0)
  const [skipped,       setSkipped]       = useState(0)
  const [currentTitle,  setCurrentTitle]  = useState('')
  const [error,         setError]         = useState('')
  const esRef = useRef<EventSource | null>(null)

  useEffect(() => {
    botApi.list(wsId)
      .then(d => { setBots(d.bots); if (d.bots.length === 1) setSelectedBotId(d.bots[0].id) })
      .catch(() => {})
      .finally(() => setLoadingBots(false))
  }, [wsId])

  // Clean up SSE on unmount
  useEffect(() => () => { esRef.current?.close() }, [])

  // When hidden but mounted (background mode), render nothing
  if (!shown) return null

  const handleSync = () => {
    if (!selectedBotId) return
    setPhase('running'); setError('')
    setCount(0); setTotal(0); setImported(0); setSkipped(0); setCurrentTitle('')

    const url = trackApi.syncTelegramFullUrl(wsId, selectedBotId)
    const es  = new EventSource(url)
    esRef.current = es

    es.onmessage = (evt) => {
      try {
        const obj = JSON.parse(evt.data) as {
          status: string; total?: number; count?: number; title?: string
          imported?: number; skipped?: number; error?: string
        }
        if (obj.status === 'start') {
          setTotal(obj.total ?? 0)
        } else if (obj.status === 'progress') {
          setCount(obj.count ?? 0)
          setCurrentTitle(obj.title ?? '')
          setImported(obj.imported ?? 0)
          setSkipped(obj.skipped ?? 0)
        } else if (obj.status === 'done') {
          setImported(obj.imported ?? imported)
          setSkipped(obj.skipped ?? skipped)
          setPhase('done')
          es.close()
          if ((obj.imported ?? 0) > 0) onSynced()
        } else if (obj.status === 'error') {
          setError(obj.error ?? 'Erreur inconnue')
          setPhase('error')
          es.close()
        }
      } catch { /* ignore */ }
    }
    es.onerror = () => {
      if (phase === 'running') {
        setError('Connexion SSE interrompue.')
        setPhase('error')
      }
      es.close()
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.75)' }}>
      <div className="rounded-xl w-full max-w-sm mx-4 overflow-hidden" style={{ background: S.panel, border: `1px solid ${S.border}` }}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: S.border }}>
          <div className="flex items-center gap-2">
            <RefreshCw size={13} style={{ color: '#67e8f9', animation: phase === 'running' ? 'spin 1.2s linear infinite' : undefined }} />
            <span className="text-xs font-semibold" style={{ color: S.text }}>Sync Telegram — Historique complet</span>
          </div>
          <button
            onClick={phase === 'running' ? onBackground : onClose}
            title={phase === 'running' ? 'Mettre en arrière-plan' : 'Fermer'}
            style={{ color: S.textMute, background: 'none', border: 'none', cursor: 'pointer' }}
          >
            <X size={14} />
          </button>
        </div>

        <div className="p-4 flex flex-col gap-3">

          {/* Phase: pick bot */}
          {phase === 'pick' && (<>
            <p className="text-[11px]" style={{ color: S.textDim }}>
              Récupère <strong style={{ color: S.text }}>l'intégralité</strong> des fichiers audio du canal Telegram via l'API MTProto (Telethon) — aucune limite de messages.
            </p>

            {loadingBots ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 size={16} className="animate-spin" style={{ color: S.accent }} />
              </div>
            ) : bots.length === 0 ? (
              <div className="text-center py-4">
                <BotIcon size={24} style={{ color: S.textFade, margin: '0 auto 8px' }} />
                <p className="text-xs" style={{ color: S.textMute }}>Aucun bot configuré</p>
                <p className="text-[10px] mt-1" style={{ color: S.textFade }}>Créez un bot dans la section Canaux.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: S.textMute }}>Choisir un bot</div>
                {bots.map(bot => (
                  <label key={bot.id}
                    className="flex items-center gap-2.5 px-3 py-2 rounded cursor-pointer"
                    style={{
                      background: selectedBotId === bot.id ? `${S.accent}15` : S.input,
                      border: `1px solid ${selectedBotId === bot.id ? S.accent + '60' : S.border}`,
                    }}>
                    <input type="radio" className="accent-orange-400" checked={selectedBotId === bot.id}
                      onChange={() => setSelectedBotId(bot.id)} />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium" style={{ color: selectedBotId === bot.id ? S.accent : S.text }}>{bot.name}</div>
                      <div className="text-[10px]" style={{ color: S.textMute }}>{bot.channelId}</div>
                    </div>
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{
                      background: bot.status === 'running' ? 'rgba(74,222,128,0.12)' : 'rgba(136,136,136,0.12)',
                      color: bot.status === 'running' ? '#4ade80' : S.textMute,
                    }}>{bot.status}</span>
                  </label>
                ))}
              </div>
            )}

            <div className="flex gap-2 mt-1">
              <button onClick={onClose} className="flex-1 py-2 rounded text-xs"
                style={{ background: S.input, color: S.textDim, border: `1px solid ${S.border}` }}>
                Annuler
              </button>
              <button
                disabled={!selectedBotId || bots.length === 0}
                onClick={handleSync}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded text-xs font-semibold disabled:opacity-50"
                style={{ background: '#67e8f9', color: '#000' }}
              >
                <RefreshCw size={12} />Synchroniser
              </button>
            </div>
          </>)}

          {/* Phase: running — live progress */}
          {phase === 'running' && (
            <div className="flex flex-col gap-3">
              {/* Progress bar */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px]" style={{ color: S.textDim }}>
                    {count}{total > 0 ? ` / ${total}` : ''} fichier{count !== 1 ? 's' : ''} traité{count !== 1 ? 's' : ''}
                  </span>
                  <span className="text-[10px] font-mono" style={{ color: '#4ade80' }}>
                    {imported} importé{imported !== 1 ? 's' : ''}
                  </span>
                </div>
                <div className="w-full rounded-full overflow-hidden" style={{ height: 4, background: S.input }}>
                  <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{
                      width: total > 0 ? `${Math.min(100, (count / total) * 100)}%` : '100%',
                      background: total > 0 ? '#67e8f9' : undefined,
                      animation: total === 0 ? 'pulse 1.5s ease-in-out infinite' : undefined,
                      backgroundImage: total === 0 ? 'linear-gradient(90deg,#67e8f9 0%,#3b82f6 50%,#67e8f9 100%)' : undefined,
                    }}
                  />
                </div>
              </div>

              {/* Current track */}
              {currentTitle && (
                <div className="flex items-center gap-2 px-3 py-2 rounded" style={{ background: S.input, border: `1px solid ${S.border}` }}>
                  <Loader2 size={11} className="animate-spin shrink-0" style={{ color: '#67e8f9' }} />
                  <span className="text-[11px] truncate" style={{ color: S.textDim }}>{currentTitle}</span>
                </div>
              )}

              <button
                onClick={onBackground}
                className="flex items-center justify-center gap-1.5 py-2 rounded text-xs"
                style={{ background: S.input, color: S.textDim, border: `1px solid ${S.border}`, cursor: 'pointer' }}
              >
                <X size={11} />Mettre en arrière-plan
              </button>
            </div>
          )}

          {/* Phase: done */}
          {phase === 'done' && (
            <div className="flex flex-col gap-3">
              <div className="rounded px-3 py-3 flex items-start gap-2" style={{ background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.2)' }}>
                <CheckCircle2 size={16} style={{ color: '#4ade80', flexShrink: 0, marginTop: 1 }} />
                <div>
                  <p className="text-xs font-semibold" style={{ color: '#4ade80' }}>Synchronisation terminée</p>
                  <p className="text-[11px] mt-0.5" style={{ color: S.textDim }}>
                    <strong style={{ color: S.text }}>{imported}</strong> fichier{imported !== 1 ? 's' : ''} importé{imported !== 1 ? 's' : ''}
                    {skipped > 0 ? `, ${skipped} déjà présent${skipped !== 1 ? 's' : ''}` : ''}
                  </p>
                </div>
              </div>
              <button onClick={onClose} className="py-2 rounded text-xs font-semibold"
                style={{ background: S.accent, color: '#000' }}>Fermer</button>
            </div>
          )}

          {/* Phase: error */}
          {phase === 'error' && (
            <div className="flex flex-col gap-3">
              <div className="rounded px-3 py-2 text-[11px]" style={{ background: 'rgba(231,76,60,0.1)', border: '1px solid rgba(231,76,60,0.3)', color: '#e74c3c' }}>
                {error}
                {error.includes('TELEGRAM_API_ID') && (
                  <p className="mt-1.5 text-[10px]" style={{ color: '#e07070' }}>
                    Ajoutez <code>TELEGRAM_API_ID</code> et <code>TELEGRAM_API_HASH</code> dans le fichier <code>.env</code> du serveur.<br />
                    Obtenez-les sur <strong>my.telegram.org</strong> → API development tools.
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                <button onClick={onClose} className="flex-1 py-2 rounded text-xs"
                  style={{ background: S.input, color: S.textDim, border: `1px solid ${S.border}` }}>Fermer</button>
                <button onClick={() => setPhase('pick')} className="flex-1 py-2 rounded text-xs font-semibold"
                  style={{ background: S.accent, color: '#000' }}>Réessayer</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ── ImportModal: copy tracks from another workspace ── */
interface ImportModalProps { wsId: string; onClose: () => void; onImported: () => void }

function ImportModal({ wsId, onClose, onImported }: ImportModalProps) {
  const { workspaces } = useWorkspaces()
  const other = workspaces.filter(w => w.id !== wsId)

  const [srcWsId,   setSrcWsId]   = useState(other[0]?.id ?? '')
  const [tracks,    setTracks]    = useState<Track[]>([])
  const [loading,   setLoading]   = useState(false)
  const [selected,  setSelected]  = useState<Set<string>>(new Set())
  const [importing, setImporting] = useState(false)
  const [done,      setDone]      = useState<number | null>(null)
  const [error,     setError]     = useState('')

  useEffect(() => {
    if (!srcWsId) return
    setLoading(true); setTracks([]); setSelected(new Set()); setDone(null)
    trackApi.list(srcWsId)
      .then(d => setTracks(d.tracks))
      .catch(() => setTracks([]))
      .finally(() => setLoading(false))
  }, [srcWsId])

  const toggle = (id: string) =>
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  const handleImport = async () => {
    if (!selected.size) return
    setImporting(true); setError('')
    try {
      const res = await trackApi.importFromWorkspace(wsId, srcWsId, [...selected])
      setDone(res.count)
      onImported()
    } catch (e) { setError(String(e).replace('Error: ', '')) }
    finally { setImporting(false) }
  }

  const fmt = (sec?: number) => sec ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}` : '--:--'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.75)' }}>
      <div className="flex flex-col rounded w-full max-w-md mx-4" style={{ background: S.panel, border: `1px solid ${S.border}`, maxHeight: '80vh' }}>
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 shrink-0" style={{ borderBottom: `1px solid ${S.border}` }}>
          <ArrowDownToLine size={14} style={{ color: S.accent }} />
          <span className="text-sm font-semibold flex-1" style={{ color: S.text }}>Importer depuis un workspace</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: S.textMute }}>
            <X size={14} />
          </button>
        </div>

        {/* Source workspace selector */}
        <div className="px-4 py-3 shrink-0" style={{ borderBottom: `1px solid ${S.border}` }}>
          {other.length === 0 ? (
            <p className="text-xs" style={{ color: S.textMute }}>Aucun autre workspace accessible.</p>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-[11px] shrink-0" style={{ color: S.textMute }}>Source :</span>
              <select
                value={srcWsId}
                onChange={e => setSrcWsId(e.target.value)}
                className="flex-1 text-xs rounded px-2 py-1.5 outline-none"
                style={{ background: S.input, color: S.text, border: `1px solid ${S.border}` }}
              >
                {other.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
          )}
        </div>

        {/* Track list */}
        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="flex items-center justify-center py-8"><Loader2 size={18} style={{ color: S.accent }} className="animate-spin" /></div>
          ) : tracks.length === 0 ? (
            <p className="text-xs text-center py-8" style={{ color: S.textMute }}>Aucun son dans ce workspace.</p>
          ) : (
            <div className="flex flex-col">
              {/* Select all */}
              <button
                onClick={() => setSelected(selected.size === tracks.length ? new Set() : new Set(tracks.map(t => t.id)))}
                className="flex items-center gap-2 px-4 py-2 text-[11px] text-left w-full"
                style={{ background: 'transparent', border: 'none', borderBottom: `1px solid ${S.border}`, cursor: 'pointer', color: S.textMute }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = S.hover }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
              >
                <div
                  className="flex items-center justify-center rounded shrink-0"
                  style={{ width: 14, height: 14, border: `1px solid ${selected.size === tracks.length ? S.accent : S.border}`, background: selected.size === tracks.length ? S.accent : 'transparent' }}
                >
                  {selected.size === tracks.length && <Check size={9} style={{ color: '#000' }} />}
                </div>
                Tout sélectionner ({tracks.length})
              </button>
              {tracks.map(t => (
                <button
                  key={t.id}
                  onClick={() => toggle(t.id)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-left"
                  style={{ background: 'transparent', border: 'none', borderBottom: `1px solid ${S.border}`, cursor: 'pointer' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = S.hover }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                >
                  <div
                    className="flex items-center justify-center rounded shrink-0"
                    style={{ width: 14, height: 14, border: `1px solid ${selected.has(t.id) ? S.accent : S.border}`, background: selected.has(t.id) ? S.accent : 'transparent' }}
                  >
                    {selected.has(t.id) && <Check size={9} style={{ color: '#000' }} />}
                  </div>
                  {t.artworkUrl ? (
                    <img src={t.artworkUrl} alt="" className="rounded shrink-0" style={{ width: 32, height: 32, objectFit: 'cover' }} />
                  ) : (
                    <div className="rounded shrink-0 flex items-center justify-center" style={{ width: 32, height: 32, background: S.panelAlt }}>
                      <Music2 size={13} style={{ color: S.textMute }} />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate" style={{ color: S.text }}>{t.title}</p>
                    <p className="text-[10px] truncate" style={{ color: S.textMute }}>{t.artist ?? '—'} · {fmt(t.duration ?? undefined)}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 shrink-0 flex items-center gap-3" style={{ borderTop: `1px solid ${S.border}` }}>
          {error && <p className="flex-1 text-[11px]" style={{ color: S.red }}>{error}</p>}
          {done !== null && <p className="flex-1 text-[11px]" style={{ color: '#4ade80' }}>{done} son{done > 1 ? 's' : ''} importé{done > 1 ? 's' : ''} ✓</p>}
          {!error && done === null && <span className="flex-1" />}
          <button onClick={onClose} className="text-xs px-3 py-1.5 rounded" style={{ background: S.input, color: S.textDim, border: `1px solid ${S.border}`, cursor: 'pointer' }}>
            {done !== null ? 'Fermer' : 'Annuler'}
          </button>
          {done === null && (
            <button
              onClick={handleImport}
              disabled={importing || selected.size === 0}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded font-semibold"
              style={{ background: selected.size > 0 ? S.accent : S.border, color: selected.size > 0 ? '#000' : S.textMute, border: 'none', cursor: selected.size > 0 ? 'pointer' : 'not-allowed' }}
            >
              {importing ? <Loader2 size={11} className="animate-spin" /> : <ArrowDownToLine size={11} />}
              Importer {selected.size > 0 ? `(${selected.size})` : ''}
            </button>
          )}
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
  const [tab,        setTab]        = useState<"library" | "search" | "convert" | "export">("library")
  const { workspace: ws, workspaces, loading: wsLoading } = useWorkspaces()
  const [editing,    setEditing]    = useState<Track | null>(null)
  const [sendTracks, setSendTracks] = useState<Track[] | null>(null)
  const [syncing,    setSyncing]    = useState(false)
  const [syncBg,     setSyncBg]     = useState(false)
  const [uploading,  setUploading]  = useState(false)
  const [addOpen,    setAddOpen]    = useState(false)
  const [importing,  setImporting]  = useState(false)
  const uploadRef = useRef<HTMLInputElement>(null)
  const addRef    = useRef<HTMLDivElement>(null)

  const { track: currentTrack, isPlaying } = usePlayerStore()

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

  const TabBtn = ({ id, label, icon }: { id: 'library' | 'search' | 'convert' | 'export'; label: string; icon: React.ReactNode }) => (
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
          <TabBtn id="convert" label="Convertir" icon={<Wand2 size={12} />} />
          <TabBtn id="export"  label="Exporter"  icon={<KeyRound size={12} />} />
          {ws && (
            <span className="ml-auto text-[10px]" style={{ color: S.textMute }}>
              {ws.name} · <span style={{ color: S.textDim }}>{total}</span>
            </span>
          )}
        </div>

        {/* No-workspace banner */}
        {!wsLoading && !ws && (
          <div className="flex flex-col items-center justify-center flex-1 gap-4 px-6 text-center">
            <div className="flex items-center justify-center rounded-full"
              style={{ width: 52, height: 52, background: '#1a1a1a', border: '1px solid #2a2a2a' }}>
              <Music2 size={22} style={{ color: '#555' }} />
            </div>
            <div>
              <p className="text-sm font-semibold mb-1" style={{ color: S.text }}>Aucun workspace</p>
              <p className="text-xs leading-relaxed" style={{ color: S.textMute }}>
                Tu n'as pas encore accès à un espace de travail.<br />
                Crée le tien ou demande à être invité à un workspace partagé.
              </p>
            </div>
            <div className="flex gap-2">
              <a
                href="/onboarding"
                className="flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-semibold"
                style={{ background: S.accent, color: '#000', textDecoration: 'none' }}
              >
                Créer un workspace
              </a>
              <button
                onClick={() => { workspaceActions.invalidate(); workspaceActions.init() }}
                className="flex items-center gap-1.5 px-4 py-2 rounded-md text-xs"
                style={{ background: S.input, color: S.textDim, border: `1px solid ${S.border}` }}
              >
                <RefreshCw size={11} />Actualiser
              </button>
            </div>
          </div>
        )}

        {(!wsLoading && ws) && (tab === "search" ? (
          <div className="flex-1 overflow-auto p-4">
            <ResourcesTab workspaceId={ws?.id ?? "demo"} onScrapeSuccess={fetchTracks} libraryTracks={tracks} />
          </div>
        ) : tab === "convert" ? (
          <div className="flex-1 overflow-hidden">
            <ConverterTab workspaceId={ws?.id ?? "demo"} />
          </div>
        ) : tab === "export" ? (
          <div className="flex-1 overflow-auto">
            <ExportTab workspaceId={ws?.id ?? ""} />
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
              {/* Standalone sync button */}
              <button
                onClick={() => setSyncing(true)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-semibold shrink-0"
                style={{
                  background: syncBg ? '#67e8f910' : '#67e8f920',
                  color: '#67e8f9',
                  border: '1px solid #67e8f940',
                }}
                title={syncBg ? 'Sync en cours — cliquer pour voir la progression' : 'Synchroniser depuis Telegram'}
              >
                {syncBg
                  ? <Loader2 size={13} className="animate-spin" />
                  : <RefreshCw size={13} />}
                <span className="hidden sm:inline">{syncBg ? 'Sync en cours…' : 'Sync Telegram'}</span>
              </button>
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
                    {workspaces.length > 1 && (
                      <button
                        onClick={() => { setAddOpen(false); setImporting(true) }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:brightness-125"
                        style={{ color: S.textDim, borderTop: `1px solid ${S.border}` }}
                      >
                        <ArrowDownToLine size={11} style={{ color: '#a78bfa' }} />Importer depuis…
                      </button>
                    )}
                  </div>
                )}
              </div>
              <input ref={uploadRef} type="file" accept=".mp3,.wav,.ogg,.flac,.m4a" multiple className="hidden" onChange={handleUpload} />
            </div>

            {/* List header */}
            <div className="flex items-center gap-3 px-5 py-2 border-b shrink-0 select-none"
              style={{ borderColor: S.border, background: S.panelAlt }}>
              <div className="w-8 shrink-0">
                <input type="checkbox" className="accent-orange-400" style={{ width: 15, height: 15 }}
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
                tracks.map((track) => {
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
                      {/* Checkbox — <button> = natively interactive on all mobile browsers */}
                      <button
                        type="button"
                        className="w-8 shrink-0 flex items-center justify-center self-stretch"
                        style={{ cursor: 'pointer', touchAction: 'manipulation', minWidth: 32, background: 'none', border: 'none', padding: 0 }}
                        onClick={e => { e.stopPropagation(); toggleSelect(track.id) }}
                      >
                        <input
                          type="checkbox"
                          className="accent-orange-400"
                          style={{ width: 15, height: 15, cursor: 'pointer', pointerEvents: 'none' }}
                          checked={isSelected}
                          readOnly
                        />
                      </button>

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
                          {track.sent ? (
                            <span className="flex items-center gap-0.5 text-[9px] px-1 py-0.5 rounded" style={{ background: 'rgba(103,232,249,0.12)', color: '#67e8f9', border: '1px solid rgba(103,232,249,0.25)' }}>
                              <Check size={8} />envoyé
                            </span>
                          ) : (track.artworkUrl && track.artist) ? (
                            <span className="text-[9px] px-1 py-0.5 rounded" style={{ background: `${S.accent}12`, color: S.accent, border: `1px solid ${S.accent}25` }}>
                              prêt
                            </span>
                          ) : null}
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

                      {/* Actions — always visible on touch screens, hover-only on desktop */}
                      <div className="w-16 shrink-0 flex items-center justify-end gap-0.5 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
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
        ))}
      </div>
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
        <SendModal wsId={ws.id} tracks={sendTracks} onClose={() => setSendTracks(null)}
        onSent={(ids) => setTracks(ts => ts.map(t => ids.includes(t.id) ? { ...t, sent: true } : t))} />
      )}
      {importing && ws && workspaces.length > 1 && (
        <ImportModal wsId={ws.id} onClose={() => setImporting(false)} onImported={() => { setImporting(false); fetchTracks() }} />
      )}
      {(syncing || syncBg) && ws && (
        <TelegramSyncModal
          wsId={ws.id}
          shown={syncing}
          onClose={() => { setSyncing(false); setSyncBg(false) }}
          onSynced={() => { setSyncBg(false); setSyncing(false); fetchTracks() }}
          onBackground={() => { setSyncing(false); setSyncBg(true) }}
        />
      )}
    </>
  )
}
