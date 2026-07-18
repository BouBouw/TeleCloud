import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Film, Download, Trash2, RefreshCw,
  HardDrive, Loader2, Play, X, LayoutGrid, List, Search,
} from 'lucide-react'
import { galleryApi } from '../lib/api'
import type { VideoFile, Workspace } from '../lib/api'
import { useWorkspaces } from '../store/workspaceStore'
import { useI18n } from '../i18n'

/* ─── Design tokens (mirrors Library / Studio) ─── */
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

const PLATFORM_CONFIG: Record<string, { color: string; bg: string; border: string }> = {
  tiktok:    { color: '#69C9D0', bg: 'rgba(105,201,208,0.1)',  border: 'rgba(105,201,208,0.3)' },
  instagram: { color: '#e1306c', bg: 'rgba(225,48,108,0.1)',   border: 'rgba(225,48,108,0.3)'  },
  twitter:   { color: '#aaa',    bg: 'rgba(170,170,170,0.07)', border: 'rgba(170,170,170,0.2)' },
  snapchat:  { color: '#d4ca00', bg: 'rgba(255,252,0,0.08)',   border: 'rgba(255,252,0,0.25)'  },
}

const PLATFORM_ICON: Record<string, string> = {
  tiktok:    '/platform-icons/tiktok.png',
  instagram: '/platform-icons/instagram.png',
  twitter:   '/platform-icons/x.png',
  x:         '/platform-icons/x.png',
  snapchat:  '/platform-icons/snapchat.png',
  youtube:   '/platform-icons/youtube.png',
  soundcloud:'/platform-icons/soundcloud.png',
}

type ViewMode = 'grid' | 'list'
type SortBy   = 'default' | 'title' | 'duration' | 'size'

/* ─── Helpers ─── */
function fmt(s?: number | null) {
  if (!s) return null
  const m   = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${String(sec).padStart(2, '0')}`
}
function fmtSize(bytes?: number | null) {
  if (!bytes) return null
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`
  if (bytes >= 1_000_000)     return `${(bytes / 1_000_000).toFixed(1)} MB`
  return `${(bytes / 1_000).toFixed(0)} KB`
}

/* ─── PlatformBadge ─── */
function PlatformBadge({ platform, size = 'sm' }: { platform: string; size?: 'sm' | 'xs' }) {
  const px   = size === 'xs' ? 16 : 20
  const icon = PLATFORM_ICON[platform] ?? `/platform-icons/${platform}.png`
  return (
    <img
      src={icon}
      alt={platform}
      width={px}
      height={px}
      className="rounded object-contain shrink-0"
    />
  )
}

/* ─── VideoPlayerModal ─── */
function VideoPlayerModal({ video, wsId, onClose }: {
  video: VideoFile; wsId: string; onClose: () => void
}) {
  const { t } = useI18n()
  const src = galleryApi.streamUrl(wsId, video.id)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-8"
      style={{ background: 'rgba(0,0,0,0.92)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        background: S.panelAlt,
        border: `1px solid ${S.borderHi}`,
        borderRadius: 12,
        overflow: 'hidden',
        width: '100%',
        maxWidth: 900,
        boxShadow: '0 40px 100px rgba(0,0,0,0.85)',
      }}>
        {/* Header */}
        <div
          className="flex items-center gap-3 px-4 shrink-0"
          style={{ height: 44, borderBottom: `1px solid ${S.border}` }}
        >
          <PlatformBadge platform={video.platform} />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold truncate" style={{ color: S.text }}>{video.title}</p>
            {video.artist && (
              <p className="text-[10px] truncate" style={{ color: S.textMute }}>{video.artist}</p>
            )}
          </div>
          {fmt(video.duration) && (
            <span className="text-[10px] font-mono tabular-nums shrink-0" style={{ color: S.textFade }}>
              {fmt(video.duration)}
            </span>
          )}
          {fmtSize(video.fileSize) && (
            <span
              className="text-[10px] shrink-0 hidden sm:flex items-center gap-1"
              style={{ color: S.textFade }}
            >
              <HardDrive size={9} />{fmtSize(video.fileSize)}
            </span>
          )}
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:brightness-150 transition-all shrink-0"
            style={{ color: S.textMute }}
          >
            <X size={14} />
          </button>
        </div>

        {/* Video */}
        <div className="aspect-video bg-black">
          <video src={src} controls autoPlay style={{ width: '100%', height: '100%', display: 'block' }} />
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-end px-4"
          style={{ height: 44, borderTop: `1px solid ${S.border}` }}
        >
          <a
            href={galleryApi.downloadUrl(wsId, video.id)}
            download
            className="flex items-center gap-2 px-4 py-1.5 rounded text-xs font-semibold hover:opacity-85 transition-opacity"
            style={{ background: S.accent, color: '#000', textDecoration: 'none' }}
          >
            <Download size={12} /> {t('btn_download_mp4_modal')}
          </a>
        </div>
      </div>
    </div>
  )
}

/* ─── VideoCard (grid mode) ─── */
function VideoCard({ video, wsId, onDelete, onPlay }: {
  video: VideoFile; wsId: string; onDelete: () => void; onPlay: () => void
}) {
  const { t } = useI18n()
  const [deleting,    setDeleting]    = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [hovered,     setHovered]     = useState(false)

  const handleDelete = async () => {
    setDeleting(true)
    try { await galleryApi.delete(wsId, video.id); onDelete() }
    catch { /* ignore */ }
    finally { setDeleting(false); setShowConfirm(false) }
  }

  return (
    <div
      className="group flex flex-col"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: S.panel,
        border: `1px solid ${hovered ? S.borderHi : S.border}`,
        borderRadius: 8,
        overflow: 'hidden',
        transition: 'border-color 0.18s, box-shadow 0.22s',
        boxShadow: hovered ? '0 8px 28px rgba(0,0,0,0.5)' : 'none',
      }}
    >
      {/* Thumbnail */}
      <div
        className="aspect-video relative overflow-hidden"
        style={{ background: '#000', cursor: 'pointer' }}
        onClick={onPlay}
      >
        <img
          src={galleryApi.thumbnailUrl(wsId, video.id)}
          alt={video.title}
          style={{
            width: '100%', height: '100%', objectFit: 'cover', display: 'block',
            transition: 'transform 0.32s',
            transform: hovered ? 'scale(1.05)' : 'scale(1)',
          }}
        />

        {/* Gradient */}
        <div
          className="absolute inset-0"
          style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.6) 0%, transparent 50%)' }}
        />

        {/* Platform badge */}
        <div className="absolute top-2 left-2">
          <PlatformBadge platform={video.platform} size="xs" />
        </div>

        {/* Duration */}
        {fmt(video.duration) && (
          <span
            className="absolute bottom-2 right-2 font-mono text-[10px] font-bold px-1.5 py-0.5 rounded"
            style={{ background: 'rgba(0,0,0,0.8)', color: '#fff' }}
          >
            {fmt(video.duration)}
          </span>
        )}

        {/* Play button */}
        <div
          className="absolute inset-0 flex items-center justify-center transition-opacity"
          style={{ opacity: hovered ? 1 : 0 }}
        >
          <div
            className="flex items-center justify-center rounded-full"
            style={{
              width: 46, height: 46,
              background: S.accent,
              boxShadow: `0 0 22px rgba(240,168,48,0.55)`,
              transform: hovered ? 'scale(1)' : 'scale(0.8)',
              transition: 'transform 0.2s',
            }}
          >
            <Play size={17} fill="#000" style={{ color: '#000', marginLeft: 2 }} />
          </div>
        </div>
      </div>

      {/* Info */}
      <div className="flex-1 px-3 pt-2.5 pb-2 min-w-0">
        <div className="flex items-start gap-1.5">
          <p
            className="flex-1 text-xs font-medium truncate leading-snug"
            style={{ color: S.text }}
          >
            {video.title}
          </p>
        </div>
        {video.artist && (
          <p className="text-[11px] truncate mt-0.5" style={{ color: S.textMute }}>
            {video.artist}
          </p>
        )}
        {fmtSize(video.fileSize) && (
          <p className="text-[10px] mt-1.5 flex items-center gap-1" style={{ color: S.textFade }}>
            <HardDrive size={8} style={{ flexShrink: 0 }} />{fmtSize(video.fileSize)}
          </p>
        )}
      </div>

      {/* Actions — always visible */}
      <div
        className="flex items-center gap-1.5 px-2.5 pb-2.5"
        style={{ borderTop: `1px solid ${S.border}`, paddingTop: 8, marginTop: 2 }}
      >
        <a
          href={galleryApi.downloadUrl(wsId, video.id)}
          download
          className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded text-[11px] font-medium transition-all"
          style={{
            background: 'rgba(240,168,48,0.1)', border: `1px solid rgba(240,168,48,0.22)`,
            color: S.accent, textDecoration: 'none',
          }}
          onMouseEnter={e => ((e.currentTarget as HTMLElement).style.background = 'rgba(240,168,48,0.2)')}
          onMouseLeave={e => ((e.currentTarget as HTMLElement).style.background = 'rgba(240,168,48,0.1)')}
        >
          <Download size={11} /> {t('btn_download')}
        </a>
        {showConfirm ? (
          <div className="flex gap-1">
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="px-2 py-1.5 rounded text-[11px]"
              style={{ background: 'rgba(231,76,60,0.15)', border: `1px solid rgba(231,76,60,0.35)`, color: S.red, cursor: 'pointer' }}
            >
              {deleting ? <Loader2 size={11} className="animate-spin" /> : t('btn_delete_confirm')}
            </button>
            <button
              onClick={() => setShowConfirm(false)}
              className="px-2 py-1.5 rounded text-[11px]"
              style={{ background: 'transparent', border: `1px solid ${S.border}`, color: S.textMute, cursor: 'pointer' }}
            >
              ✕
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowConfirm(true)}
            className="p-1.5 rounded transition-colors"
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: hovered ? S.textMute : S.textFade,
            }}
            onMouseEnter={e => (e.currentTarget.style.color = S.red)}
            onMouseLeave={e => (e.currentTarget.style.color = hovered ? S.textMute : S.textFade)}
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>
    </div>
  )
}

/* ─── VideoListRow (list mode, mirrors Library track rows) ─── */
function VideoListRow({ video, wsId, onDelete, onPlay, index }: {
  video: VideoFile; wsId: string; onDelete: () => void; onPlay: () => void; index: number
}) {
  const [deleting,    setDeleting]    = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const { t } = useI18n()

  const handleDelete = async () => {
    setDeleting(true)
    try { await galleryApi.delete(wsId, video.id); onDelete() }
    catch { /* ignore */ }
    finally { setDeleting(false); setShowConfirm(false) }
  }

  return (
    <div
      className="flex items-center gap-3 px-5 group transition-colors"
      style={{ height: 58, borderBottom: `1px solid ${S.border}` }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = S.hover }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '' }}
    >
      {/* Index */}
      <div className="w-5 shrink-0 flex items-center justify-center">
        <span className="text-[10px] font-mono group-hover:hidden" style={{ color: S.textFade }}>{index + 1}</span>
        <button
          className="hidden group-hover:flex items-center justify-center"
          onClick={onPlay}
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: S.textMute, padding: 0 }}
        >
          <Play size={11} fill="currentColor" style={{ marginLeft: 1 }} />
        </button>
      </div>

      {/* Thumbnail */}
      <div
        className="relative shrink-0 overflow-hidden rounded cursor-pointer"
        style={{ width: 72, height: 40, background: S.input, border: `1px solid ${S.border}` }}
        onClick={onPlay}
      >
        <img src={galleryApi.thumbnailUrl(wsId, video.id)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        <div
          className="absolute inset-0 flex items-center justify-center transition-opacity opacity-0 group-hover:opacity-100"
          style={{ background: 'rgba(0,0,0,0.5)' }}
        >
          <Play size={12} fill={S.accent} style={{ color: S.accent, marginLeft: 1 }} />
        </div>
      </div>

      {/* Platform */}
      <div className="w-24 shrink-0">
        <PlatformBadge platform={video.platform} size="xs" />
      </div>

      {/* Title / Artist */}
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium truncate leading-tight" style={{ color: S.text }}>
          {video.title}
        </p>
        {video.artist && (
          <p className="text-[10px] truncate mt-0.5" style={{ color: S.textMute }}>{video.artist}</p>
        )}
      </div>

      {/* Duration */}
      <div className="w-12 shrink-0 text-right hidden lg:block">
        <span className="text-[10px] tabular-nums font-mono" style={{ color: S.textMute }}>
          {fmt(video.duration) ?? '—'}
        </span>
      </div>

      {/* Size */}
      <div className="w-16 shrink-0 text-right hidden xl:block">
        <span className="text-[10px] tabular-nums font-mono" style={{ color: S.textFade }}>
          {fmtSize(video.fileSize) ?? '—'}
        </span>
      </div>

      {/* Actions — group-hover */}
      <div className="w-16 shrink-0 flex items-center justify-end gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <a
          href={galleryApi.downloadUrl(wsId, video.id)}
          download
          className="p-1.5 rounded hover:brightness-150"
          style={{ color: S.textMute }}
          title={t('btn_title_download')}
        >
          <Download size={13} />
        </a>
        {showConfirm ? (
          <>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="px-1.5 py-1 rounded text-[10px]"
              style={{ background: 'rgba(231,76,60,0.15)', border: `1px solid rgba(231,76,60,0.3)`, color: S.red, cursor: 'pointer' }}
            >
              {deleting ? <Loader2 size={10} className="animate-spin" /> : '✓'}
            </button>
            <button
              onClick={() => setShowConfirm(false)}
              className="px-1.5 py-1 rounded text-[10px]"
              style={{ background: 'transparent', border: `1px solid ${S.border}`, color: S.textMute, cursor: 'pointer' }}
            >
              ✕
            </button>
          </>
        ) : (
          <button
            onClick={() => setShowConfirm(true)}
            className="p-1.5 rounded"
            style={{ color: S.textFade, background: 'transparent', border: 'none', cursor: 'pointer' }}
            onMouseEnter={e => (e.currentTarget.style.color = S.red)}
            onMouseLeave={e => (e.currentTarget.style.color = S.textFade)}
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>
    </div>
  )
}

/* ─── Gallery Page ─── */
export default function Gallery() {
  const { t } = useI18n()
  const { workspace } = useWorkspaces()
  const [videos,    setVideos]    = useState<VideoFile[]>([])
  const [loading,   setLoading]   = useState(true)
  const [filter,    setFilter]    = useState<string>('all')
  const [search,    setSearch]    = useState('')
  const [playing,   setPlaying]   = useState<VideoFile | null>(null)
  const [viewMode,  setViewMode]  = useState<ViewMode>('grid')
  const [sortBy,    setSortBy]    = useState<SortBy>('default')

  const load = useCallback(async (ws: Workspace) => {
    setLoading(true)
    try {
      const { videos: v } = await galleryApi.list(ws.id)
      setVideos(v)
    } catch { /* ignore */ } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!workspace) return
    load(workspace)
  }, [workspace, load])

  const platforms = useMemo(() =>
    ['all', ...Array.from(new Set(videos.map(v => v.platform)))],
    [videos]
  )

  const displayed = useMemo(() => {
    let list = filter === 'all' ? videos : videos.filter(v => v.platform === filter)
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(v =>
        v.title.toLowerCase().includes(q) ||
        (v.artist ?? '').toLowerCase().includes(q)
      )
    }
    if (sortBy === 'duration') list = [...list].sort((a, b) => (b.duration  ?? 0) - (a.duration  ?? 0))
    if (sortBy === 'size')     list = [...list].sort((a, b) => (b.fileSize  ?? 0) - (a.fileSize  ?? 0))
    if (sortBy === 'title')    list = [...list].sort((a, b) => a.title.localeCompare(b.title))
    return list
  }, [videos, filter, search, sortBy])

  const totalSize = useMemo(() =>
    videos.reduce((acc, v) => acc + (v.fileSize ?? 0), 0),
    [videos]
  )

  return (
    <div className="flex flex-col h-full fade-in" style={{ background: S.bg, color: S.text }}>
      {playing && workspace && (
        <VideoPlayerModal
          video={playing}
          wsId={workspace.id}
          onClose={() => setPlaying(null)}
        />
      )}

      {/* ── Top bar ── */}
      <div
        className="flex items-center gap-3 px-4 border-b shrink-0"
        style={{ borderColor: S.border, height: 36 }}
      >
        <Film size={13} style={{ color: S.accent }} />
        <span className="text-sm font-semibold" style={{ color: S.text }}>{t('page_title_gallery')}</span>
        {videos.length > 0 && (
          <span className="text-[10px]" style={{ color: S.textMute }}>
            {videos.length} vidéo{videos.length !== 1 ? 's' : ''}
            {fmtSize(totalSize) ? ` · ${fmtSize(totalSize)}` : ''}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          {/* View toggle */}
          <div className="flex rounded overflow-hidden" style={{ border: `1px solid ${S.border}` }}>
            {(['grid', 'list'] as ViewMode[]).map(m => (
              <button
                key={m}
                onClick={() => setViewMode(m)}
                className="flex items-center justify-center transition-colors"
                style={{
                  width: 26, height: 22,
                  background: viewMode === m ? S.hover : 'transparent',
                  border: 'none',
                  color: viewMode === m ? S.text : S.textFade,
                  cursor: 'pointer',
                  borderLeft: m === 'list' ? `1px solid ${S.border}` : 'none',
                }}
              >
                {m === 'grid' ? <LayoutGrid size={11} /> : <List size={11} />}
              </button>
            ))}
          </div>
          {/* Refresh */}
          <button
            onClick={() => workspace && load(workspace)}
            className="p-1.5 rounded hover:brightness-150 transition-colors"
            style={{ background: 'transparent', border: 'none', color: S.textMute, cursor: 'pointer' }}
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* ── Toolbar ── */}
      <div
        className="flex items-center gap-2 px-3 sm:px-5 border-b shrink-0 flex-wrap"
        style={{ borderColor: S.border, background: S.panelAlt, minHeight: 44, paddingTop: 8, paddingBottom: 8 }}
      >
        {/* Search */}
        <div
          className="flex items-center gap-2 rounded-md px-3 py-1.5"
          style={{ background: S.input, border: `1px solid ${S.border}`, minWidth: 180, flex: '0 0 auto' }}
        >
          <Search size={12} style={{ color: S.textDim, flexShrink: 0 }} />
          <input
            type="text"
            placeholder="Rechercher..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="bg-transparent text-xs outline-none flex-1"
            style={{ color: S.text, minWidth: 0 }}
          />
          {search && (
            <button onClick={() => setSearch('')} style={{ color: S.textFade, background: 'transparent', border: 'none', cursor: 'pointer' }}>
              <X size={10} />
            </button>
          )}
        </div>

        {/* Platform pills */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {platforms.map(p => {
            const active = filter === p
            const cfg    = PLATFORM_CONFIG[p]
            return (
              <button
                key={p}
                onClick={() => setFilter(p)}
                className="flex items-center gap-1.5 transition-all"
                style={{
                  padding: '3px 9px', borderRadius: 99,
                  border: `1px solid ${active ? (cfg?.border ?? S.accent) : S.border}`,
                  background: active ? (cfg?.bg ?? 'rgba(240,168,48,0.12)') : 'transparent',
                  color: active ? (cfg?.color ?? S.accent) : S.textMute,
                  cursor: 'pointer',
                }}
              >
                {p === 'all' ? (
                  <span className="text-xs" style={{ fontWeight: active ? 600 : 400 }}>{t('filter_all')}</span>
                ) : (
                  <>
                    <img
                      src={PLATFORM_ICON[p] ?? `/platform-icons/${p}.png`}
                      alt={p}
                      width={14}
                      height={14}
                      className="rounded object-contain"
                    />
                    <span className="text-[10px]" style={{ opacity: 0.5 }}>
                      {videos.filter(v => v.platform === p).length}
                    </span>
                  </>
                )}
              </button>
            )
          })}
        </div>

        {/* Spacer + Sort + Count */}
        <div className="ml-auto flex items-center gap-3">
          <select
            value={sortBy}
            onChange={e => setSortBy(e.target.value as SortBy)}
            className="text-xs rounded px-2 py-1 outline-none"
            style={{ background: S.input, border: `1px solid ${S.border}`, color: S.textMute, cursor: 'pointer' }}
          >
            <option value="default">{t('sort_default')}</option>
            <option value="title">{t('sort_title')}</option>
            <option value="duration">{t('sort_duration')}</option>
            <option value="size">{t('sort_size')}</option>
          </select>
          <span className="text-[10px]" style={{ color: S.textMute }}>
            {displayed.length}{displayed.length !== videos.length ? `/${videos.length}` : ''}
          </span>
        </div>
      </div>

      {/* ── List header (list mode only) ── */}
      {viewMode === 'list' && !loading && displayed.length > 0 && (
        <div
          className="flex items-center gap-3 px-5 py-2 border-b shrink-0 select-none"
          style={{ borderColor: S.border, background: S.panelAlt }}
        >
          <div className="w-5 shrink-0" />
          <div className="w-[72px] shrink-0" />
          <div className="w-24 shrink-0 text-[9px] uppercase tracking-widest" style={{ color: S.textFade }}>{t('col_platform')}</div>
          <div className="flex-1 text-[9px] uppercase tracking-widest" style={{ color: S.textFade }}>{t('col_title')}</div>
          <div className="w-12 shrink-0 text-right text-[9px] uppercase tracking-widest hidden lg:block" style={{ color: S.textFade }}>{t('col_duration')}</div>
          <div className="w-16 shrink-0 text-right text-[9px] uppercase tracking-widest hidden xl:block" style={{ color: S.textFade }}>{t('col_size')}</div>
          <div className="w-16 shrink-0" />
        </div>
      )}

      {/* ── Content ── */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-20" style={{ color: S.textMute }}>
            <Loader2 size={16} className="animate-spin" style={{ color: S.accent }} />
            <span className="text-xs">{t('loading')}</span>
          </div>
        ) : displayed.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <div
              className="rounded flex items-center justify-center"
              style={{ width: 56, height: 56, background: S.panel, border: `1px solid ${S.border}` }}
            >
              <Film size={22} style={{ color: S.textFade }} />
            </div>
            <p className="text-xs" style={{ color: S.textMute }}>
              {search || filter !== 'all' ? t('empty_no_results') : t('empty_no_videos')}
            </p>
            {!search && filter === 'all' && (
              <p className="text-[10px]" style={{ color: S.textFade }}>
                {t('empty_videos_hint')}
              </p>
            )}
          </div>
        ) : viewMode === 'grid' ? (
          <div className="p-3 sm:p-5 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {displayed.map(video => (
              <VideoCard
                key={video.id}
                video={video}
                wsId={workspace!.id}
                onDelete={() => setVideos(prev => prev.filter(v => v.id !== video.id))}
                onPlay={() => setPlaying(video)}
              />
            ))}
          </div>
        ) : (
          displayed.map((video, i) => (
            <VideoListRow
              key={video.id}
              video={video}
              index={i}
              wsId={workspace!.id}
              onDelete={() => setVideos(prev => prev.filter(v => v.id !== video.id))}
              onPlay={() => setPlaying(video)}
            />
          ))
        )}
      </div>
    </div>
  )
}
