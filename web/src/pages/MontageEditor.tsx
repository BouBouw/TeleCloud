import { useState, useEffect, useCallback, useRef, useMemo, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Clapperboard, Music2, Video, Download, Play, Pause,
  Trash2, Loader2, Upload, Link2, Settings2, Volume2, VolumeX,
  CheckCircle2, XCircle, Film, Maximize2, Sparkles, Type, Mic,
  Share2, Calendar, GripVertical, Layers, ZoomIn, ZoomOut,
  Plus, PanelLeft, RefreshCw, Undo2, Redo2, Scissors, Magnet,
} from 'lucide-react'
import { montageApi, trackApi, galleryApi, socialApi } from '../lib/api'
import type { Workspace, MontageProject, MontageStyle, MontageDuration, MontageRatio, MontageClip, BeatData, Track, VideoFile, SocialAccount, SocialPost } from '../lib/api'
import { useWorkspaces } from '../store/workspaceStore'

const S = {
  bg: '#111', panel: '#1a1a1a', panelAlt: '#161616', hover: '#1e1e1e',
  border: '#2a2a2a', borderHi: '#3a3a3a', accent: '#f0a830',
  text: '#ccc', textDim: '#888', textMute: '#555', textFade: '#333',
  input: '#0a0a0a', red: '#e74c3c', green: '#4ade80', yellow: '#facc15', cyan: '#67e8f9',
}

type Tab = 'audio' | 'videos'

const STYLE_LABELS: Record<string, string> = {
  DARK_TRAP: '🖤 Dark Trap', CLEAN_MINIMAL: '⬜ Clean Minimal', HYPER_POP: '🌈 Hyper Pop',
  FAST_CUTS: '⚡ Fast Cuts', SLOW_MOTION: '🎬 Slow Motion', CINEMATIC: '🎥 Cinematic',
  AMBIENT: '🌅 Ambient', LYRIC_VIDEO: '🎵 Lyric Video', EQ_VISUALIZER: '🌀 EQ Visualizer',
}
const DURATION_LABELS: Record<string, string> = { AUTO: 'Auto', SECONDS_15: '15s', SECONDS_30: '30s', SECONDS_60: '60s', FULL_SONG: 'Full Song' }
const RATIO_LABELS: Record<string, string> = { LANDSCAPE: '16:9', PORTRAIT: '9:16', SQUARE: '1:1' }

const STYLES_LIST: MontageStyle[] = ['DARK_TRAP', 'CLEAN_MINIMAL', 'HYPER_POP', 'FAST_CUTS', 'SLOW_MOTION', 'CINEMATIC', 'AMBIENT', 'LYRIC_VIDEO', 'EQ_VISUALIZER']
const DURATIONS_LIST: MontageDuration[] = ['AUTO', 'SECONDS_15', 'SECONDS_30', 'SECONDS_60', 'FULL_SONG']
const RATIOS_LIST: MontageRatio[] = ['LANDSCAPE', 'PORTRAIT', 'SQUARE']

const STYLE_DESCRIPTIONS: Record<string, string> = {
  DARK_TRAP: 'Cuts rapides, ambiance sombre', CLEAN_MINIMAL: 'Épuré, transitions douces',
  HYPER_POP: 'Flashs et couleurs saturées', FAST_CUTS: 'Montage ultra-rapide',
  SLOW_MOTION: 'Ralentis dramatiques', CINEMATIC: 'Zooms cinématographiques',
  AMBIENT: 'Lent, contemplatif', LYRIC_VIDEO: 'Centré sur les paroles', EQ_VISUALIZER: 'Visualiseur audio',
}

const TRANSITIONS = [
  { id: 'cut',         label: 'Coupe',    desc: 'Instantané' },
  { id: 'fade',        label: 'Fondu',    desc: 'En noir' },
  { id: 'zoom_in',     label: 'Zoom +',   desc: 'Vers l\'avant' },
  { id: 'zoom_out',    label: 'Zoom −',   desc: 'Vers l\'arrière' },
  { id: 'slow_motion', label: 'Ralenti',  desc: 'Effet temporel' },
  { id: 'flash',       label: 'Flash',    desc: 'Éclat blanc' },
]

// Per-clip transitions the render pipeline actually supports (backend: cut|fade|dip_to_black)
const CLIP_TRANSITIONS = [
  { id: 'cut',          label: 'Coupe', color: '#8899aa' },
  { id: 'fade',         label: 'Fondu', color: '#4f8ef7' },
  { id: 'dip_to_black', label: 'Fondu noir', color: '#9b59e2' },
] as const

/** Recompute cumulative outputStart from each clip's outputDuration (ripple). */
function recalcStarts(clips: MontageClip[]): MontageClip[] {
  let cursor = 0
  return clips.map(c => { const nc = { ...c, outputStart: cursor }; cursor += c.outputDuration; return nc })
}

const SUBTITLE_EFFECTS = [
  { id: 'NONE',       label: 'Aucun' },
  { id: 'FADE',       label: 'Fondu' },
  { id: 'SLIDE_UP',   label: '↑ Montée' },
  { id: 'SLIDE_DOWN', label: '↓ Descente' },
  { id: 'POP',        label: '● Pop' },
  { id: 'BOUNCE',     label: '⊛ Rebond' },
  { id: 'KARAOKE',    label: 'Karaoké' },
  { id: 'TYPEWRITER', label: '⌨ Machine' },
  { id: 'GLOW',       label: '✦ Lueur' },
  { id: 'NEON',       label: '⚡ Néon' },
  { id: 'OUTLINE',    label: '□ Contour' },
  { id: 'SHADOW',     label: '▪ Ombre' },
]

// Each font has a CSS font-family string; gfont entries are loaded from Google Fonts.
const SUBTITLE_FONTS: { id: string; label: string; css: string; gfont?: string }[] = [
  { id: 'Inter',          label: 'Inter',       css: 'Inter, sans-serif' },
  { id: 'Impact',         label: 'Impact',      css: 'Impact, Haettenschweiler, sans-serif' },
  { id: 'Anton',          label: 'Anton',       css: "'Anton', sans-serif",           gfont: 'Anton' },
  { id: 'Bebas Neue',     label: 'Bebas',       css: "'Bebas Neue', sans-serif",      gfont: 'Bebas+Neue' },
  { id: 'Oswald',         label: 'Oswald',      css: "'Oswald', sans-serif",          gfont: 'Oswald:wght@600' },
  { id: 'Montserrat',     label: 'Montserrat',  css: "'Montserrat', sans-serif",      gfont: 'Montserrat:wght@700' },
  { id: 'Bangers',        label: 'Bangers',     css: "'Bangers', cursive",            gfont: 'Bangers' },
  { id: 'Pacifico',       label: 'Pacifico',    css: "'Pacifico', cursive",           gfont: 'Pacifico' },
  { id: 'Dancing Script', label: 'Dancing',     css: "'Dancing Script', cursive",     gfont: 'Dancing+Script:wght@700' },
  { id: 'Press Start 2P', label: 'Retro',       css: "'Press Start 2P', monospace",  gfont: 'Press+Start+2P' },
  { id: 'Courier New',    label: 'Mono',        css: "'Courier New', monospace" },
  { id: 'Georgia',        label: 'Georgia',     css: 'Georgia, serif' },
]

const CLIP_COLORS = ['#4f8ef7', '#e67e22', '#9b59e2', '#2eb872', '#e74c3c', '#f0a830', '#00bcd4', '#ff5722']

function fmt(s: number) {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

function statusColor(s: string) {
  return s === 'COMPLETED' ? S.green : s === 'PROCESSING' ? S.cyan : s === 'QUEUED' ? S.yellow : s === 'FAILED' ? S.red : S.textDim
}
function StatusBadge({ status }: { status: string }) {
  const labels: Record<string, string> = { DRAFT: 'Brouillon', QUEUED: 'File d\'attente', PROCESSING: 'En cours', COMPLETED: 'Terminé', FAILED: 'Erreur' }
  return (
    <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
      style={{ color: statusColor(status), background: statusColor(status) + '20', border: `1px solid ${statusColor(status)}40` }}>
      {labels[status] ?? status}
    </span>
  )
}

// ── Social publish modal ───────────────────────────────────────────────────────
type SocialPlatform = 'TIKTOK' | 'INSTAGRAM' | 'YOUTUBE' | 'TWITTER' | 'FACEBOOK' | 'SNAPCHAT' | 'LINKEDIN' | 'PINTEREST'
const PLATFORM_CONFIG: Record<SocialPlatform, { label: string; emoji: string; color: string }> = {
  TIKTOK:    { label: 'TikTok',    emoji: '🎵', color: '#69C9D0' },
  INSTAGRAM: { label: 'Instagram', emoji: '📸', color: '#e1306c' },
  YOUTUBE:   { label: 'YouTube',   emoji: '▶️', color: '#ff0000' },
  TWITTER:   { label: 'X',         emoji: '🐦', color: '#1da1f2' },
  FACEBOOK:  { label: 'Facebook',  emoji: '👤', color: '#1877F2' },
  SNAPCHAT:  { label: 'Snapchat',  emoji: '👻', color: '#FFFC00' },
  LINKEDIN:  { label: 'LinkedIn',  emoji: '💼', color: '#0A66C2' },
  PINTEREST: { label: 'Pinterest', emoji: '📌', color: '#E60023' },
}

interface PublishModalProps {
  project: MontageProject
  workspace: Workspace
  accounts: SocialAccount[]
  onClose: () => void
}
function PublishModal({ project, workspace, accounts, onClose }: PublishModalProps) {
  const [platform, setPlatform] = useState<SocialPlatform>('INSTAGRAM')
  const [selectedAccountId, setSelectedAccountId] = useState<string>('')
  const [caption, setCaption] = useState('')
  const [hashtags, setHashtags] = useState('#montage #video #trending')
  const [scheduled, setScheduled] = useState(false)
  const [schedDate, setSchedDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [schedTime, setSchedTime] = useState(() => {
    const d = new Date(Date.now() + 3_600_000)
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
  })
  const [publishing, setPublishing] = useState(false)
  const [publishedPost, setPublishedPost] = useState<SocialPost | null>(null)
  const [pubError, setPubError] = useState<string | null>(null)

  const cfg = PLATFORM_CONFIG[platform]
  const platformAccounts = accounts.filter(a => a.platform === platform)

  // Auto-select first account when platform changes
  useEffect(() => {
    setSelectedAccountId(platformAccounts[0]?.id ?? '')
  }, [platform]) // eslint-disable-line react-hooks/exhaustive-deps

  const selectedAccount = platformAccounts.find(a => a.id === selectedAccountId)

  const handlePublish = async () => {
    if (!selectedAccount) return
    setPublishing(true); setPubError(null)
    try {
      let scheduledAt: string | undefined
      if (scheduled) {
        scheduledAt = new Date(`${schedDate}T${schedTime}:00`).toISOString()
      }
      const { post } = await montageApi.publish(workspace.id, project.id, {
        accountId: selectedAccount.id,
        platform,
        caption: caption || undefined,
        hashtags: hashtags || undefined,
        scheduledAt,
      })
      setPublishedPost(post)
    } catch (e: unknown) { setPubError((e as Error).message) }
    finally { setPublishing(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.82)' }} onClick={onClose}>
      <div className="relative rounded-xl flex flex-col" style={{ width: 480, maxHeight: '92vh', background: '#161616', border: '1px solid #2a2a2a', overflow: 'hidden' }}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b shrink-0" style={{ borderColor: '#222' }}>
          <div className="flex items-center gap-2">
            <Share2 size={13} style={{ color: S.accent }} />
            <span className="text-sm font-semibold" style={{ color: '#ddd' }}>Publier le montage</span>
          </div>
          <button onClick={onClose} style={{ color: '#555' }}><XCircle size={14} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
          {publishedPost ? (
            <div className="flex flex-col items-center py-10 gap-3">
              <CheckCircle2 size={40} style={{ color: S.green }} />
              <span className="text-sm font-semibold" style={{ color: S.green }}>
                {publishedPost.scheduledAt ? 'Publication programmée !' : 'Publié avec succès !'}
              </span>
              {publishedPost.scheduledAt && (
                <p className="text-xs text-center" style={{ color: '#888' }}>
                  Votre montage sera publié le {new Date(publishedPost.scheduledAt).toLocaleString('fr-FR')}.
                </p>
              )}
            </div>
          ) : (
            <>
              {/* Platform selector */}
              <div>
                <div className="text-[9px] uppercase tracking-wider mb-2" style={{ color: '#555' }}>Plateforme</div>
                <div className="grid gap-1.5" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
                  {(Object.keys(PLATFORM_CONFIG) as SocialPlatform[]).map(p => {
                    const c = PLATFORM_CONFIG[p]
                    const count = accounts.filter(a => a.platform === p).length
                    const sel = platform === p
                    return (
                      <button key={p} onClick={() => setPlatform(p)}
                        className="flex flex-col items-center gap-1 py-2 px-1 rounded text-center"
                        style={{
                          background: sel ? c.color + '18' : '#111',
                          border: `1px solid ${sel ? c.color + '60' : '#222'}`,
                        }}>
                        <span className="text-base">{c.emoji}</span>
                        <span className="text-[8px] font-semibold" style={{ color: sel ? c.color : '#666' }}>{c.label}</span>
                        <span className="text-[7px]" style={{ color: count > 0 ? S.green : '#444' }}>
                          {count > 0 ? `${count} cpte${count > 1 ? 's' : ''}` : '—'}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Account selector */}
              {platformAccounts.length === 0 ? (
                <div className="rounded p-3 text-xs" style={{ background: '#1a1000', border: `1px solid ${S.accent}40`, color: S.accent }}>
                  ⚠ Aucun compte {cfg.label} connecté. Rendez-vous dans Paramètres → Comptes connectés.
                </div>
              ) : (
                <div>
                  <div className="text-[9px] uppercase tracking-wider mb-1.5" style={{ color: '#555' }}>Compte</div>
                  <div className="flex flex-col gap-1">
                    {platformAccounts.map(acc => (
                      <button key={acc.id}
                        onClick={() => setSelectedAccountId(acc.id)}
                        className="flex items-center gap-2.5 px-3 py-2 rounded text-left"
                        style={{
                          background: selectedAccountId === acc.id ? cfg.color + '15' : '#0f0f0f',
                          border: `1px solid ${selectedAccountId === acc.id ? cfg.color + '50' : '#1e1e1e'}`,
                        }}>
                        <span className="text-sm">{cfg.emoji}</span>
                        <div className="min-w-0">
                          <p className="text-xs font-semibold truncate" style={{ color: '#ccc' }}>{acc.accountName}</p>
                          {acc.accountLabel && (
                            <p className="text-[9px] truncate" style={{ color: '#555' }}>{acc.accountLabel}</p>
                          )}
                        </div>
                        {selectedAccountId === acc.id && (
                          <CheckCircle2 size={12} className="ml-auto shrink-0" style={{ color: cfg.color }} />
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Caption */}
              <div>
                <div className="text-[9px] uppercase tracking-wider mb-1.5" style={{ color: '#555' }}>Légende</div>
                <textarea value={caption} onChange={e => setCaption(e.target.value)} rows={3}
                  placeholder="Décrivez votre montage…"
                  className="w-full px-3 py-2 rounded text-xs outline-none resize-none"
                  style={{ background: S.input, border: '1px solid #2e2e2e', color: '#ccc', fontFamily: 'monospace' }} />
                <div className="text-right text-[9px] mt-0.5" style={{ color: '#444' }}>{caption.length}/2200</div>
              </div>

              {/* Hashtags */}
              <div>
                <div className="text-[9px] uppercase tracking-wider mb-1.5" style={{ color: '#555' }}>Hashtags</div>
                <input value={hashtags} onChange={e => setHashtags(e.target.value)}
                  placeholder="#montage #video #trending"
                  className="w-full px-3 py-1.5 rounded text-xs outline-none"
                  style={{ background: S.input, border: '1px solid #2e2e2e', color: '#ccc', fontFamily: 'monospace' }} />
              </div>

              {/* Schedule toggle */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <div className="text-[9px] uppercase tracking-wider" style={{ color: '#555' }}>Publication</div>
                  <div className="flex items-center gap-1 ml-auto">
                    <button onClick={() => setScheduled(false)}
                      className="px-2 py-1 rounded text-[9px] font-semibold"
                      style={{ background: !scheduled ? S.accent + '20' : '#111', border: `1px solid ${!scheduled ? S.accent + '60' : '#222'}`, color: !scheduled ? S.accent : '#555' }}>
                      Maintenant
                    </button>
                    <button onClick={() => setScheduled(true)}
                      className="flex items-center gap-1 px-2 py-1 rounded text-[9px] font-semibold"
                      style={{ background: scheduled ? S.accent + '20' : '#111', border: `1px solid ${scheduled ? S.accent + '60' : '#222'}`, color: scheduled ? S.accent : '#555' }}>
                      <Calendar size={9} />Programmer
                    </button>
                  </div>
                </div>
                {scheduled && (
                  <div className="flex gap-2 mb-1.5">
                    <input type="date" value={schedDate} onChange={e => setSchedDate(e.target.value)}
                      className="flex-1 px-2 py-1.5 rounded text-xs outline-none"
                      style={{ background: S.input, border: '1px solid #2e2e2e', color: '#ccc', colorScheme: 'dark' }} />
                    <input type="time" value={schedTime} onChange={e => setSchedTime(e.target.value)}
                      className="flex-1 px-2 py-1.5 rounded text-xs outline-none"
                      style={{ background: S.input, border: '1px solid #2e2e2e', color: '#ccc', colorScheme: 'dark' }} />
                  </div>
                )}
              </div>

              {pubError && (
                <div className="rounded p-2.5 text-xs" style={{ background: '#1a0000', border: `1px solid ${S.red}40`, color: S.red }}>{pubError}</div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {!publishedPost ? (
          <div className="flex items-center justify-between px-4 py-3 border-t shrink-0" style={{ borderColor: '#222' }}>
            <button onClick={onClose} className="text-xs" style={{ color: '#555' }}>Annuler</button>
            <button onClick={handlePublish}
              disabled={!selectedAccount || publishing}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold disabled:opacity-40"
              style={{ background: cfg.color, color: platform === 'SNAPCHAT' ? '#000' : '#fff' }}>
              {publishing ? <Loader2 size={11} className="animate-spin" /> : <Share2 size={11} />}
              {scheduled ? 'Programmer' : 'Publier maintenant'}
            </button>
          </div>
        ) : (
          <div className="flex justify-center px-4 py-3 border-t shrink-0" style={{ borderColor: '#222' }}>
            <button onClick={onClose} className="px-4 py-1.5 rounded text-xs font-semibold"
              style={{ background: S.accent, color: '#000' }}>Fermer</button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Draggable / Resizable floating panel ──────────────────────────────────────
function DraggableModal({
  title, icon, onClose, children, defaultPos, defaultSize,
}: {
  title: string
  icon: React.ReactNode
  onClose: () => void
  children: React.ReactNode
  defaultPos?: { x: number; y: number }
  defaultSize?: { w: number; h: number }
}) {
  const [pos,  setPos]  = useState(defaultPos  ?? { x: 200, y: 80 })
  const [size, setSize] = useState(defaultSize ?? { w: 330, h: 500 })
  const dragRef = useRef({ active: false, ox: 0, oy: 0, px: 0, py: 0 })
  const resRef  = useRef({ active: false, ox: 0, oy: 0, sw: 0, sh: 0 })
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (dragRef.current.active) {
        setPos({ x: dragRef.current.px + e.clientX - dragRef.current.ox, y: dragRef.current.py + e.clientY - dragRef.current.oy })
      }
      if (resRef.current.active) {
        setSize({
          w: Math.max(260, resRef.current.sw + e.clientX - resRef.current.ox),
          h: Math.max(200, resRef.current.sh + e.clientY - resRef.current.oy),
        })
      }
    }
    const onUp = () => { dragRef.current.active = false; resRef.current.active = false }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
  }, [])

  // On mobile: full-screen bottom sheet
  if (isMobile) {
    return (
      <>
        <div className="fixed inset-0 z-40" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={onClose} />
        <div className="fixed bottom-0 left-0 right-0 z-50 flex flex-col rounded-t-2xl overflow-hidden"
          style={{ background: '#141414', border: '1px solid #2e2e2e', maxHeight: '80vh', boxShadow: '0 -8px 32px rgba(0,0,0,0.75)' }}>
          {/* Handle */}
          <div className="flex justify-center pt-2 pb-1 shrink-0">
            <div style={{ width: 36, height: 4, borderRadius: 2, background: '#333' }} />
          </div>
          {/* Title bar */}
          <div className="shrink-0 flex items-center gap-2 px-4 pb-3">
            <span style={{ color: S.accent }}>{icon}</span>
            <span className="text-sm font-semibold flex-1" style={{ color: '#ccc' }}>{title}</span>
            <button onClick={onClose} style={{ color: '#444' }}><XCircle size={16} /></button>
          </div>
          {/* Content */}
          <div className="flex-1 overflow-y-auto px-4 pb-6">
            {children}
          </div>
        </div>
      </>
    )
  }

  return (
    <div className="fixed z-40 flex flex-col rounded-xl overflow-hidden"
      style={{ left: pos.x, top: pos.y, width: size.w, height: size.h, background: '#141414', border: '1px solid #2e2e2e', boxShadow: '0 16px 48px rgba(0,0,0,0.75)', userSelect: 'none' }}>
      {/* Title bar */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-2.5 cursor-grab active:cursor-grabbing"
        style={{ background: '#1a1a1a', borderBottom: '1px solid #222' }}
        onMouseDown={e => { dragRef.current = { active: true, ox: e.clientX, oy: e.clientY, px: pos.x, py: pos.y } }}>
        <span style={{ color: S.accent }}>{icon}</span>
        <span className="text-xs font-semibold flex-1" style={{ color: '#ccc' }}>{title}</span>
        <button onClick={onClose} onMouseDown={e => e.stopPropagation()} className="hover:brightness-200" style={{ color: '#444' }}>
          <XCircle size={13} />
        </button>
      </div>
      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3">
        {children}
      </div>
      {/* Resize handle */}
      <div className="absolute bottom-0 right-0 cursor-se-resize"
        style={{ width: 16, height: 16, background: 'linear-gradient(135deg, transparent 50%, #333 50%)', borderRadius: '0 0 12px 0' }}
        onMouseDown={e => { e.preventDefault(); resRef.current = { active: true, ox: e.clientX, oy: e.clientY, sw: size.w, sh: size.h } }}
      />
    </div>
  )
}

// ── Settings panel content (shared between desktop side panel and mobile bottom sheet) ──
function SettingsPanelContent({
  settingStyle, setSettingStyle,
  settingDuration, setSettingDuration,
  settingRatio, setSettingRatio,
  savingSettings, handleSaveSettings,
  socialAccounts,
}: {
  settingStyle: MontageStyle; setSettingStyle: (v: MontageStyle) => void
  settingDuration: MontageDuration; setSettingDuration: (v: MontageDuration) => void
  settingRatio: MontageRatio; setSettingRatio: (v: MontageRatio) => void
  savingSettings: boolean; handleSaveSettings: () => void
  socialAccounts: Array<{ platform: string }>
}) {
  return (
    <div className="flex flex-col gap-4 p-3 flex-1 overflow-y-auto">
      <div>
        <div className="text-[9px] uppercase tracking-wider mb-1.5" style={{ color: '#555' }}>Style</div>
        <select value={settingStyle} onChange={e => setSettingStyle(e.target.value as MontageStyle)}
          className="w-full px-2 py-1.5 rounded text-xs outline-none"
          style={{ background: '#0a0a0a', border: '1px solid #222', color: '#ccc' }}>
          {STYLES_LIST.map(k => <option key={k} value={k}>{STYLE_LABELS[k]}</option>)}
        </select>
      </div>
      <div>
        <div className="text-[9px] uppercase tracking-wider mb-1.5" style={{ color: '#555' }}>Durée</div>
        <div className="flex gap-1 flex-wrap">
          {DURATIONS_LIST.map(k => (
            <button key={k} onClick={() => setSettingDuration(k)}
              className="py-1 rounded text-[9px] font-semibold px-1.5"
              style={{
                background: settingDuration === k ? S.accent + '20' : '#0a0a0a',
                border: `1px solid ${settingDuration === k ? S.accent + '60' : '#222'}`,
                color: settingDuration === k ? S.accent : '#555',
              }}>
              {DURATION_LABELS[k]}
            </button>
          ))}
        </div>
      </div>
      <div>
        <div className="text-[9px] uppercase tracking-wider mb-1.5" style={{ color: '#555' }}>Format</div>
        <div className="flex gap-1">
          {RATIOS_LIST.map(k => (
            <button key={k} onClick={() => setSettingRatio(k)}
              className="flex-1 py-1.5 rounded text-[9px] font-semibold"
              style={{
                background: settingRatio === k ? S.accent + '20' : '#0a0a0a',
                border: `1px solid ${settingRatio === k ? S.accent + '60' : '#222'}`,
                color: settingRatio === k ? S.accent : '#555',
              }}>
              {RATIO_LABELS[k]}
            </button>
          ))}
        </div>
      </div>
      <button onClick={handleSaveSettings} disabled={savingSettings}
        className="flex items-center justify-center gap-1.5 w-full py-1.5 rounded text-xs font-semibold disabled:opacity-40"
        style={{ background: S.accent, color: '#000' }}>
        {savingSettings ? <Loader2 size={11} className="animate-spin" /> : null} Sauvegarder
      </button>
      <div>
        <div className="text-[9px] uppercase tracking-wider mb-1" style={{ color: '#555' }}>Comptes sociaux</div>
        <p className="text-[9px] mb-2" style={{ color: '#444' }}>
          Gérez vos comptes dans <span style={{ color: S.accent }}>Paramètres → Comptes connectés</span>
        </p>
        <div className="flex flex-col gap-1">
          {(Object.keys(PLATFORM_CONFIG) as SocialPlatform[]).map(pl => {
            const cfg = PLATFORM_CONFIG[pl]
            const accs = socialAccounts.filter(a => a.platform === pl)
            return (
              <div key={pl} className="flex items-center gap-2 px-2 py-1.5 rounded" style={{ background: '#0e0e0e', border: '1px solid #1e1e1e' }}>
                <span style={{ fontSize: 11 }}>{cfg.emoji}</span>
                <span className="text-[9px] font-semibold flex-1" style={{ color: '#999' }}>{cfg.label}</span>
                {accs.length > 0 ? (
                  <span className="text-[8px] px-1.5 py-0.5 rounded" style={{ background: '#4ade8015', color: '#4ade80', border: '1px solid #4ade8030' }}>
                    {accs.length} compte{accs.length > 1 ? 's' : ''}
                  </span>
                ) : (
                  <span className="text-[8px]" style={{ color: '#333' }}>—</span>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export default function MontageEditor() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const { workspace } = useWorkspaces()
  const [project, setProject]       = useState<MontageProject | null>(null)
  const [loading, setLoading]       = useState(true)
  const [tab, setTab]               = useState<Tab>('audio')
  const [error, setError]           = useState<string | null>(null)

  const [audioUploading, setAudioUploading] = useState(false)
  const audioInputRef = useRef<HTMLInputElement>(null)
  const [libTracks, setLibTracks]       = useState<Track[]>([])
  const [libSearch, setLibSearch]       = useState('')
  const [usingTrack, setUsingTrack]     = useState<string | null>(null)
  const [galleryVideos, setGalleryVideos] = useState<VideoFile[]>([])
  const [gallerySearch, setGallerySearch] = useState('')
  const [addingFromGallery, setAddingFromGallery] = useState<string | null>(null)
  const [urlInput, setUrlInput]     = useState('')
  const [addingUrl, setAddingUrl]   = useState(false)
  const [videoUploading, setVideoUploading] = useState(false)
  const videoInputRef = useRef<HTMLInputElement>(null)
  const [removingVid, setRemovingVid] = useState<string | null>(null)
  const [extractingAudio, setExtractingAudio] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const pollRef   = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dlPollRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  // matchMedia = exact same logic as CSS @media queries, more reliable than window.innerWidth
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 767px)').matches : false
  )
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])
  const [settingStyle, setSettingStyle] = useState<MontageStyle>('DARK_TRAP')
  const [settingDuration, setSettingDuration] = useState<MontageDuration>('AUTO')
  const [settingRatio, setSettingRatio] = useState<MontageRatio>('LANDSCAPE')
  const [savingSettings, setSavingSettings] = useState(false)

  // ── Video player ──────────────────────────────────────────────────
  const videoRef = useRef<HTMLVideoElement>(null)
  const subtitleContainerRef = useRef<HTMLDivElement>(null)
  const subtitleDragStateRef  = useRef<{ active: boolean; startX: number; startY: number; startPx: number; startPy: number }>({ active: false, startX: 0, startY: 0, startPx: 50, startPy: 85 })
  const subtitleResizeStateRef = useRef<{ active: boolean; startX: number; startSz: number }>({ active: false, startX: 0, startSz: 100 })
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const currentTimeRef = useRef(0)
  const [vidDuration, setVidDuration] = useState(0)
  const [vol, setVol] = useState(1)
  const [muted, setMuted] = useState(false)
  const [showControls, setShowControls] = useState(true)

  // ── Effects / Lyrics ──────────────────────────────────────────────
  const [selectedTransition, setSelectedTransition] = useState('cut')
  const [subtitleEffect, setSubtitleEffect] = useState('NONE')
  const [subtitlePos, setSubtitlePos] = useState('BOTTOM')
  const [subtitleColor, setSubtitleColor] = useState('#FFFFFF')
  const [subtitleFont, setSubtitleFont] = useState('Inter')
  const [subtitleBgColor, setSubtitleBgColor] = useState('#000000')
  const [subtitleBgOpacity, setSubtitleBgOpacity] = useState(42)  // 0–100
  const [subtitleCustomX, setSubtitleCustomX] = useState(50)      // % left
  const [subtitleCustomY, setSubtitleCustomY] = useState(85)      // % top
  const [subtitleFontSize, setSubtitleFontSize] = useState(100)   // relative %, 40–220
  const [subtitleIsDragging, setSubtitleIsDragging] = useState(false)
  const [subtitleEffectColor, setSubtitleEffectColor] = useState('#000000') // shadow/glow/outline accent
  const [transcriptLang, setTranscriptLang]   = useState('fr')
  const [transcriptModel, setTranscriptModel] = useState('small')
  const [transcribing, setTranscribing] = useState(false)
  const [transcriptSegments, setTranscriptSegments] = useState<Array<{ start: number; end: number; text: string }> | null>(null)

  // ── Social / Publish ──────────────────────────────────────────────
  const [showPublish, setShowPublish] = useState(false)
  const [socialAccounts, setSocialAccounts] = useState<SocialAccount[]>([])

  // ── Floating modals ───────────────────────────────────────────────
  const [showEffectsModal,  setShowEffectsModal]  = useState(false)
  const [showLyricsModal,   setShowLyricsModal]   = useState(false)
  const [showLibraryModal,  setShowLibraryModal]  = useState(false)
  const [lyricsTab,         setLyricsTab]         = useState<'segments' | 'style'>('segments')
  const [pasteText,         setPasteText]         = useState('')
  const [effectAnimKeys,    setEffectAnimKeys]     = useState<Record<string, number>>({})

  // ── Audio player ──────────────────────────────────────────────────
  const audioPlayerRef = useRef<HTMLAudioElement>(null)
  const [audioPlaying, setAudioPlaying] = useState(false)
  const [audioTime, setAudioTime] = useState(0)
  const [audioDurState, setAudioDurState] = useState(0)

  // ── Mobile panel toggle ──────────────────────────────────────────
  const [showMobilePanel, setShowMobilePanel] = useState(false)

  // ── Timeline ──────────────────────────────────────────────────────
  const [timelineHeight, setTimelineHeight] = useState(160)
  const tlResizeRef = useRef<{ active: boolean; startY: number; startH: number }>({ active: false, startY: 0, startH: 160 })
  const [dragClipIdx, setDragClipIdx] = useState<number | null>(null)
  const [dropClipIdx, setDropClipIdx] = useState<number | null>(null)
  const [localClipOrder, setLocalClipOrder] = useState<string[]>([])
  const waveformCanvasRef = useRef<HTMLCanvasElement>(null)
  const waveformDataRef = useRef<number[]>([])
  const [waveformVersion, setWaveformVersion] = useState(0) // bumped when real waveform decodes → triggers redraw
  const [tlZoom, setTlZoom] = useState(1)
  const tlScrollRef = useRef<HTMLDivElement>(null)
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null)
  const [clipboardClipId, setClipboardClipId] = useState<string | null>(null)
  const clipboardCutRef = useRef(false) // true = cut mode (remove after paste)
  // Scrub and zoom refs (used in non-passive event handlers → stable refs avoid stale closures)
  const scrubRef       = useRef(false)
  const pxPerSecRef    = useRef(40)
  const tlDurationRef  = useRef(60)
  // Prevents onTimeUpdate from overriding seek position while the user drags the seek bar
  const isSeekingRef   = useRef(false)
  // Touch drag state for mobile timeline reordering
  const touchDragRef   = useRef<{ clipIdx: number } | null>(null)

  // ── Scene frames (Library modal) ──────────────────────────────────
  const [sceneFrames, setSceneFrames]   = useState<Array<{ id: string; videoId: string; time: number; url: string }>>([])
  const [loadingFrames, setLoadingFrames] = useState(false)

  // ── Generated timeline clips + beat map (loaded after COMPLETED) ──
  const [generatedClips, setGeneratedClips] = useState<MontageClip[]>([])
  const [beatData, setBeatData] = useState<BeatData | null>(null)
  const [selectedRendClipId, setSelectedRendClipId] = useState<string | null>(null)
  const [selectedRendIds, setSelectedRendIds] = useState<string[]>([]) // multi-select (bulk ops)

  // ── Timeline editing (trim / split / ripple / transitions) state ──
  const FPS = 30
  const [editsDirty, setEditsDirty] = useState(false)     // unsaved clip edits pending a re-render
  const [applyingEdits, setApplyingEdits] = useState(false)
  const [snapEnabled, setSnapEnabled] = useState(true)
  const editHistoryRef = useRef<MontageClip[][]>([])
  const editFutureRef  = useRef<MontageClip[][]>([])
  const dbClipIdsRef   = useRef<Set<string>>(new Set()) // ids that exist server-side (to diff deletions)
  const tmpClipCounter = useRef(0)
  const [canUndoEdits, setCanUndoEdits] = useState(false)
  const [canRedoEdits, setCanRedoEdits] = useState(false)
  const [generatingMulti, setGeneratingMulti] = useState(false)

  // Deterministic waveform decoration bars
  const waveformBars = useMemo(() =>
    Array.from({ length: 64 }, (_, i) =>
      15 + Math.abs(Math.sin(i * 0.47) * 45 + Math.sin(i * 1.33) * 25 + Math.sin(i * 3.7) * 15)
    ), [])

  // Ordered clips (drag-to-reorder)
  const orderedClips = useMemo(() => {
    if (!project || localClipOrder.length === 0) return project?.sourceVideos ?? []
    const clipMap = new Map(project.sourceVideos.map(sv => [sv.id, sv]))
    return localClipOrder.map(id => clipMap.get(id)).filter(Boolean) as typeof project.sourceVideos
  }, [localClipOrder, project])


  useEffect(() => {
    if (!workspace) return
    trackApi.list(workspace.id).then(({ tracks }) => setLibTracks(tracks)).catch(() => {})
    galleryApi.list(workspace.id).then(({ videos }) => setGalleryVideos(videos)).catch(() => {})
    socialApi.listAccounts(workspace.id).then(({ accounts }) => setSocialAccounts(accounts)).catch(() => {})
    if (!id) { setLoading(false); return }
    montageApi.get(workspace.id, id).then(({ project: p }) => {
      setProject(p); setSettingStyle(p.style); setSettingDuration(p.durationMode); setSettingRatio(p.ratio)
      // Restore previously saved transcription + style so the user doesn't need to
      // re-run Whisper. The backend stores { segments, style } (older data may be a
      // bare array), so parse defensively — otherwise the whole object was fed in as
      // "segments" and the lyrics silently vanished on reload.
      if (p.subtitleData) {
        try {
          const d = JSON.parse(p.subtitleData)
          const segs = Array.isArray(d) ? d : d?.segments
          if (Array.isArray(segs)) setTranscriptSegments(segs)
          const st = Array.isArray(d) ? null : d?.style
          if (st && typeof st === 'object') {
            if (st.color) setSubtitleColor(st.color)
            if (st.bgColor) setSubtitleBgColor(st.bgColor)
            if (typeof st.bgOpacity === 'number') setSubtitleBgOpacity(st.bgOpacity)
            if (st.position) setSubtitlePos(st.position)
            if (typeof st.customX === 'number') setSubtitleCustomX(st.customX)
            if (typeof st.customY === 'number') setSubtitleCustomY(st.customY)
            if (typeof st.fontSize === 'number') setSubtitleFontSize(st.fontSize)
            if (st.effect) setSubtitleEffect(st.effect)
            if (st.effectColor) setSubtitleEffectColor(st.effectColor)
          }
        } catch { /* ignore corrupt data */ }
      }
      if (p.status === 'QUEUED' || p.status === 'PROCESSING') startPolling(workspace.id, id)
      if (p.sourceVideos.some(sv => !sv.localPath && !sv.source.startsWith('ERROR:'))) startDlPolling(workspace.id, id)
      // Load generated clips and beat data if project is already completed
      if (p.status === 'COMPLETED') {
        montageApi.getClips(workspace.id, id).then(({ clips }) => { setGeneratedClips(recalcStarts(clips)); dbClipIdsRef.current = new Set(clips.map(c => c.id)) }).catch(() => {})
        montageApi.getBeatData(workspace.id, id).then(({ beatData: bd }) => setBeatData(bd)).catch(() => {})
      }
    }).catch(e => setError((e as Error).message)).finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace, id])

  const startPolling = useCallback((wsId: string, projId: string) => {
    if (pollRef.current) return
    // Exponential backoff: starts at 3s, grows ×1.5 each tick, caps at 20s.
    // A 5-min render fires ~25 requests instead of ~150 with a fixed 2s interval,
    // keeping the session well under the global rate limit.
    let delay = 3000
    const poll = async () => {
      try {
        const { job, status, outputPath } = await montageApi.status(wsId, projId)
        setProject(prev => {
          if (!prev) return prev
          return { ...prev, status: (status as MontageProject['status']) ?? prev.status, outputPath: outputPath ?? prev.outputPath, renderJob: job ?? prev.renderJob }
        })
        if (status === 'COMPLETED' || status === 'FAILED') {
          pollRef.current = null; setGenerating(false)
          if (status === 'COMPLETED') {
            montageApi.getClips(wsId, projId).then(({ clips }) => { setGeneratedClips(recalcStarts(clips)); dbClipIdsRef.current = new Set(clips.map(c => c.id)); editHistoryRef.current = []; editFutureRef.current = []; setEditsDirty(false); setCanUndoEdits(false); setCanRedoEdits(false) }).catch(() => {})
            montageApi.getBeatData(wsId, projId).then(({ beatData: bd }) => setBeatData(bd)).catch(() => {})
          }
          return // stop scheduling
        }
      } catch { /* ignore network hiccups */ }
      delay = Math.min(Math.round(delay * 1.5), 20000)
      pollRef.current = setTimeout(poll, delay)
    }
    pollRef.current = setTimeout(poll, delay)
  }, [])

  useEffect(() => () => {
    if (pollRef.current)   clearTimeout(pollRef.current)
    if (dlPollRef.current) clearTimeout(dlPollRef.current)
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current)
  }, [])

  // ── Sync localClipOrder when source videos change ─────────────────
  const sourceVideoKey = useMemo(
    () => project?.sourceVideos.map(sv => sv.id).join(',') ?? '',
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project?.sourceVideos.length]
  )
  useEffect(() => {
    if (project) setLocalClipOrder(project.sourceVideos.map(sv => sv.id))
  }, [sourceVideoKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load real waveform data from audio file ───────────────────────
  useEffect(() => {
    waveformDataRef.current = [] // reset → use decorative fallback until loaded
    if (!project?.audioPath || !workspace) return
    const url = montageApi.audioUrl(workspace.id, project.id)
    let cancelled = false
    ;(async () => {
      try {
        const resp = await fetch(url)
        if (!resp.ok || cancelled) return
        const buf = await resp.arrayBuffer()
        if (cancelled) return
        const audioCtx = new AudioContext()
        const decoded = await audioCtx.decodeAudioData(buf)
        audioCtx.close()
        if (cancelled) return
        const ch = decoded.getChannelData(0)
        const numSamples = 1200
        const sPerSample = Math.floor(ch.length / numSamples)
        const bars: number[] = []
        for (let i = 0; i < numSamples; i++) {
          let peak = 0
          const s = i * sPerSample
          const end = Math.min(s + sPerSample, ch.length)
          for (let j = s; j < end; j++) {
            const v = Math.abs(ch[j] ?? 0)
            if (v > peak) peak = v
          }
          bars.push(Math.max(1, Math.min(100, peak * 200)))
        }
        waveformDataRef.current = bars
        setWaveformVersion(v => v + 1) // trigger a canvas redraw now that real data is in
      } catch { /* keep decorative fallback */ }
    })()
    return () => { cancelled = true }
  }, [project?.audioPath, project?.id, workspace]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Canvas waveform redraw on playhead move ───────────────────────
  useEffect(() => {
    const canvas = waveformCanvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const dpr = window.devicePixelRatio || 1
    const w = canvas.offsetWidth || 300
    const h = canvas.offsetHeight || 32
    canvas.width = w * dpr; canvas.height = h * dpr
    ctx.scale(dpr, dpr)

    const bars = waveformDataRef.current.length > 0 ? waveformDataRef.current : waveformBars
    const n    = bars.length
    const mid  = h / 2
    const pxPerSec = 40 * tlZoom
    const playX = currentTime * pxPerSec

    ctx.clearRect(0, 0, w, h)

    // Build the waveform closed path (top half then mirrored bottom)
    const buildWavePath = (c: CanvasRenderingContext2D) => {
      c.beginPath()
      c.moveTo(0, mid)
      for (let i = 0; i < n; i++) {
        c.lineTo((i / n) * w, mid - (bars[i] / 100) * mid * 0.92)
      }
      c.lineTo(w, mid)
      for (let i = n - 1; i >= 0; i--) {
        c.lineTo((i / n) * w, mid + (bars[i] / 100) * mid * 0.92)
      }
      c.closePath()
    }

    // Unplayed portion — dim blue
    ctx.save()
    ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip()
    buildWavePath(ctx)
    ctx.fillStyle = '#1a3a7a99'
    ctx.fill()
    ctx.restore()

    // Played portion — bright blue
    if (playX > 0) {
      ctx.save()
      ctx.beginPath(); ctx.rect(0, 0, Math.min(playX, w), h); ctx.clip()
      buildWavePath(ctx)
      ctx.fillStyle = '#3d8bffdd'
      ctx.fill()
      ctx.restore()
    }

    // Playhead line
    if (playX > 0 && playX < w) {
      ctx.fillStyle = 'rgba(255,255,255,0.9)'
      ctx.fillRect(playX - 0.5, 0, 1, h)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTime, vidDuration, waveformBars, tlZoom, waveformVersion])

  // Release the "seeking" latch even if the mouse is let go off the slider thumb
  // (otherwise onTimeUpdate stays blocked and playback appears frozen).
  useEffect(() => {
    const clear = () => { isSeekingRef.current = false }
    window.addEventListener('pointerup', clear)
    window.addEventListener('mouseup', clear)
    return () => { window.removeEventListener('pointerup', clear); window.removeEventListener('mouseup', clear) }
  }, [])

  // ── Load scene frames when Library modal opens ───────────────────
  // Frames are cached per project — only re-fetched when project changes
  useEffect(() => { setSceneFrames([]); setLoadingFrames(false) }, [id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!showLibraryModal || !workspace || !id || sceneFrames.length > 0) return
    setLoadingFrames(true)
    montageApi.frames(workspace.id, id)
      .then(({ frames }) => setSceneFrames(frames))
      .catch(() => {})
      .finally(() => setLoadingFrames(false))
  }, [showLibraryModal]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-scroll timeline to keep playhead visible ─────────────────
  useEffect(() => {
    const container = tlScrollRef.current
    if (!container || vidDuration <= 0) return
    const pxPerSec = 40 * tlZoom
    const playX = currentTime * pxPerSec
    const { scrollLeft, clientWidth } = container
    const margin = clientWidth * 0.25
    if (playX > scrollLeft + clientWidth - margin || playX < scrollLeft + margin * 0.5) {
      container.scrollLeft = Math.max(0, playX - clientWidth / 2)
    }
  }, [currentTime]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Timeline wheel: Ctrl+Wheel→zoom, Wheel→horizontal scroll ─────
  useEffect(() => {
    const el = tlScrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        const rect = el.getBoundingClientRect()
        const mouseX = e.clientX - rect.left + el.scrollLeft
        const currentPxPerSec = pxPerSecRef.current
        const timeAtMouse = mouseX / currentPxPerSec
        const factor = e.deltaY < 0 ? 1.25 : 1 / 1.25
        setTlZoom(z => {
          const newZoom = Math.max(0.15, Math.min(15, z * factor))
          const newPxPerSec = 40 * newZoom
          requestAnimationFrame(() => {
            if (tlScrollRef.current) {
              tlScrollRef.current.scrollLeft = Math.max(0, timeAtMouse * newPxPerSec - (e.clientX - rect.left))
            }
          })
          return newZoom
        })
      } else {
        // Convert vertical scroll to horizontal (shift-less horizontal panning)
        if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
          e.preventDefault()
          el.scrollLeft += e.deltaY * 0.8
        }
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, []) // stable: uses refs + functional setTlZoom

  // ── Ruler scrub: click/drag to seek ──────────────────────────────
  useEffect(() => {
    const seek = (e: MouseEvent) => {
      // No longer guards on videoRef — timeline playhead moves even without a generated video
      if (!tlScrollRef.current) return
      const rect = tlScrollRef.current.getBoundingClientRect()
      const x = e.clientX - rect.left + tlScrollRef.current.scrollLeft
      const t = snapValueRef.current(Math.max(0, Math.min(tlDurationRef.current, x / pxPerSecRef.current)))
      setCurrentTime(t)
      if (videoRef.current) videoRef.current.currentTime = t
      if (audioPlayerRef.current) audioPlayerRef.current.currentTime = t
    }
    const onMove = (e: MouseEvent) => { if (scrubRef.current) seek(e) }
    const onUp   = () => { scrubRef.current = false }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Timeline resize mouse events ──────────────────────────────────
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!tlResizeRef.current.active) return
      const dy = tlResizeRef.current.startY - e.clientY
      setTimelineHeight(Math.max(60, Math.min(320, tlResizeRef.current.startH + dy)))
    }
    const onUp = () => { tlResizeRef.current.active = false }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
  }, [])

  // ── Load Google Fonts for subtitle font picker ────────────────────
  useEffect(() => {
    const gfonts = SUBTITLE_FONTS.flatMap(f => f.gfont ? [f.gfont] : []).join('&family=')
    if (!gfonts) return
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = `https://fonts.googleapis.com/css2?family=${gfonts}&display=swap`
    document.head.appendChild(link)
    return () => { if (document.head.contains(link)) document.head.removeChild(link) }
  }, [])

  // ── Subtitle drag-to-reposition (click+drag subtitle on video) ────
  useEffect(() => {
    const SNAP_THRESHOLD = 2.5  // % — snap to center when within this distance
    const onMove = (e: MouseEvent) => {
      const d = subtitleDragStateRef.current
      if (!d.active || !subtitleContainerRef.current) return
      e.preventDefault()
      const rect = subtitleContainerRef.current.getBoundingClientRect()
      let newX = Math.max(5, Math.min(95, d.startPx + ((e.clientX - d.startX) / rect.width)  * 100))
      let newY = Math.max(5, Math.min(95, d.startPy + ((e.clientY - d.startY) / rect.height) * 100))
      // Snap to horizontal / vertical center
      if (Math.abs(newX - 50) < SNAP_THRESHOLD) newX = 50
      if (Math.abs(newY - 50) < SNAP_THRESHOLD) newY = 50
      setSubtitleCustomX(newX)
      setSubtitleCustomY(newY)
      setSubtitlePos('CUSTOM')
      setSubtitleIsDragging(true)
    }
    const onUp = () => { subtitleDragStateRef.current.active = false; setSubtitleIsDragging(false) }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
  }, [])

  // ── Subtitle resize (drag corner handle on video overlay) ───────────
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const r = subtitleResizeStateRef.current
      if (!r.active) return
      e.preventDefault()
      const delta = (e.clientX - r.startX) / 2  // px→relative
      const next = Math.max(40, Math.min(220, r.startSz + delta))
      setSubtitleFontSize(next)
    }
    const onUp = () => { subtitleResizeStateRef.current.active = false }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
  }, [])

  const startDlPolling = useCallback((wsId: string, projId: string) => {
    if (dlPollRef.current) return
    // Downloads finish in seconds to minutes — backoff from 3s to 10s cap.
    let delay = 3000
    const poll = async () => {
      try {
        const { project: p } = await montageApi.get(wsId, projId)
        setProject(prev => prev ? { ...prev, sourceVideos: p.sourceVideos } : prev)
        const stillPending = p.sourceVideos.some(sv => !sv.localPath && !sv.source.startsWith('ERROR:'))
        if (!stillPending) { dlPollRef.current = null; return }
      } catch { /* ignore */ }
      delay = Math.min(Math.round(delay * 1.5), 10000)
      dlPollRef.current = setTimeout(poll, delay)
    }
    dlPollRef.current = setTimeout(poll, delay)
  }, [])

  const handleAudioUpload = useCallback(async (file: File) => {
    if (!workspace || !id) return
    setAudioUploading(true)
    try {
      const { project: p } = await montageApi.uploadAudio(workspace.id, id, file)
      setProject(p)
    } catch (e: unknown) { alert((e as Error).message) }
    finally { setAudioUploading(false) }
  }, [workspace, id])

  const handleUseTrack = useCallback(async (trackId: string) => {
    if (!workspace || !id) return
    setUsingTrack(trackId)
    try {
      const { project: p } = await montageApi.audioFromTrack(workspace.id, id, trackId)
      setProject(p)
    } catch (e: unknown) { alert((e as Error).message) }
    finally { setUsingTrack(null) }
  }, [workspace, id])

  const handleAddFrameAsClip = useCallback(async (frame: { id: string; videoId: string; time: number }) => {
    if (!workspace || !id) return
    const clipDuration = 3 // seconds
    try {
      const { clip } = await montageApi.addClip(workspace.id, id, frame.videoId, frame.time, frame.time + clipDuration)
      setGeneratedClips(prev => [...prev, clip])
    } catch (e: unknown) { alert((e as Error).message) }
  }, [workspace, id])

  const handleAddUrl = useCallback(async () => {
    if (!workspace || !id || !urlInput.trim()) return
    setAddingUrl(true)
    try {
      const { sourceVideo } = await montageApi.addVideoUrl(workspace.id, id, urlInput.trim())
      setProject(prev => prev ? { ...prev, sourceVideos: [...prev.sourceVideos, sourceVideo] } : prev)
      setUrlInput('')
      startDlPolling(workspace.id, id)
    } catch (e: unknown) { alert((e as Error).message) }
    finally { setAddingUrl(false) }
  }, [workspace, id, urlInput, startDlPolling])

  const handleVideoUpload = useCallback(async (file: File) => {
    if (!workspace || !id) return
    setVideoUploading(true)
    try {
      const { sourceVideo } = await montageApi.uploadVideo(workspace.id, id, file)
      setProject(prev => prev ? { ...prev, sourceVideos: [...prev.sourceVideos, sourceVideo] } : prev)
    } catch (e: unknown) { alert((e as Error).message) }
    finally { setVideoUploading(false) }
  }, [workspace, id])

  const handleRemoveVideo = useCallback(async (svId: string) => {
    if (!workspace || !id) return
    setRemovingVid(svId)
    try {
      await montageApi.removeVideo(workspace.id, id, svId)
      setProject(prev => prev ? { ...prev, sourceVideos: prev.sourceVideos.filter(sv => sv.id !== svId) } : prev)
    } catch (e: unknown) { alert((e as Error).message) }
    finally { setRemovingVid(null) }
  }, [workspace, id])

  const handleUseVideoAudio = useCallback(async (svId: string) => {
    if (!workspace || !id) return
    setExtractingAudio(svId)
    try {
      const { project: p } = await montageApi.audioFromVideo(workspace.id, id, svId)
      setProject(p)
    } catch (e: unknown) { alert((e as Error).message) }
    finally { setExtractingAudio(null) }
  }, [workspace, id])

  const handleRemoveAudio = useCallback(async () => {
    if (!workspace || !id) return
    try {
      const { project: p } = await montageApi.patch(workspace.id, id, { audioPath: null })
      setProject(p)
    } catch (e: unknown) { alert((e as Error).message) }
  }, [workspace, id])

  const handleAddFromGallery = useCallback(async (videoFileId: string) => {
    if (!workspace || !id) return
    setAddingFromGallery(videoFileId)
    try {
      const { sourceVideo } = await montageApi.videoFromGallery(workspace.id, id, videoFileId)
      setProject(prev => prev ? { ...prev, sourceVideos: [...prev.sourceVideos, sourceVideo] } : prev)
    } catch (e: unknown) { alert((e as Error).message) }
    finally { setAddingFromGallery(null) }
  }, [workspace, id])

  const handleGenerate = useCallback(async () => {
    if (!workspace || !id) return
    setGenerating(true)
    try {
      const { job } = await montageApi.generate(workspace.id, id)
      setProject(prev => prev ? { ...prev, status: 'QUEUED', renderJob: job } : prev)
      startPolling(workspace.id, id)
    } catch (e: unknown) { alert((e as Error).message); setGenerating(false) }
  }, [workspace, id, startPolling])

  const handleSaveSettings = useCallback(async () => {
    if (!workspace || !id) return
    setSavingSettings(true)
    try {
      const { project: p } = await montageApi.patch(workspace.id, id, { style: settingStyle, durationMode: settingDuration, ratio: settingRatio })
      setProject(p); setShowSettings(false)
    } catch (e: unknown) { alert((e as Error).message) }
    finally { setSavingSettings(false) }
  }, [workspace, id, settingStyle, settingDuration, settingRatio])

  const handleSelectStyle = useCallback(async (style: MontageStyle) => {
    if (!workspace || !id) return
    setSettingStyle(style)
    try {
      const { project: p } = await montageApi.patch(workspace.id, id, { style })
      setProject(p)
    } catch (e: unknown) { alert((e as Error).message) }
  }, [workspace, id])

  const handleTranscribe = useCallback(async () => {
    if (!workspace || !id) return
    setTranscribing(true)
    try {
      const res = await montageApi.transcribe(workspace.id, id, {
        language: transcriptLang || undefined,
        model:    transcriptModel,
      })
      setTranscriptSegments(res.segments)
      // Auto-save immediately so the transcription survives page reloads.
      // Errors are silenced — the segments are already in state.
      try { await montageApi.saveSubtitles(workspace.id, id, res.segments) } catch { /* non-blocking */ }
    } catch (e: unknown) { alert((e as Error).message) }
    finally { setTranscribing(false) }
  }, [workspace, id, transcriptLang, transcriptModel])

  // ── Timeline editing engine (local, applied on "re-render") ──────────
  const syncEditHist = useCallback(() => {
    setCanUndoEdits(editHistoryRef.current.length > 0)
    setCanRedoEdits(editFutureRef.current.length > 0)
  }, [])

  /** Apply a transform to the clip list, snapshot history, ripple output starts. */
  const mutateClips = useCallback((fn: (clips: MontageClip[]) => MontageClip[]) => {
    setGeneratedClips(prev => {
      editHistoryRef.current.push(prev.map(c => ({ ...c })))
      if (editHistoryRef.current.length > 80) editHistoryRef.current.shift()
      editFutureRef.current = []
      return recalcStarts(fn(prev.map(c => ({ ...c }))))
    })
    setEditsDirty(true)
    syncEditHist()
  }, [syncEditHist])

  const undoEdits = useCallback(() => {
    if (editHistoryRef.current.length === 0) return
    setGeneratedClips(prev => {
      editFutureRef.current.push(prev.map(c => ({ ...c })))
      return editHistoryRef.current.pop()!
    })
    setEditsDirty(true); syncEditHist()
  }, [syncEditHist])

  const redoEdits = useCallback(() => {
    if (editFutureRef.current.length === 0) return
    setGeneratedClips(prev => {
      editHistoryRef.current.push(prev.map(c => ({ ...c })))
      return editFutureRef.current.pop()!
    })
    setEditsDirty(true); syncEditHist()
  }, [syncEditHist])

  /** Local ripple-delete of clips (persisted on re-render). */
  const rippleDeleteClips = useCallback((ids: string[]) => {
    if (ids.length === 0) return
    mutateClips(clips => clips.filter(c => !ids.includes(c.id)))
    setSelectedRendClipId(prev => prev && ids.includes(prev) ? null : prev)
    setSelectedRendIds(prev => prev.filter(x => !ids.includes(x)))
  }, [mutateClips])

  const handleDeleteRendClip = useCallback((clipId: string) => rippleDeleteClips([clipId]), [rippleDeleteClips])

  const setClipTransition = useCallback((clipId: string, transition: string) => {
    mutateClips(clips => clips.map(c => c.id === clipId ? { ...c, transition } : c))
  }, [mutateClips])

  /** Split the clip under the playhead into two at the current time. */
  const splitAtPlayhead = useCallback(() => {
    const t = currentTimeRef.current
    setGeneratedClips(prev => {
      const idx = prev.findIndex(c => t > c.outputStart + 0.1 && t < c.outputStart + c.outputDuration - 0.1)
      if (idx < 0) return prev
      editHistoryRef.current.push(prev.map(c => ({ ...c }))); editFutureRef.current = []
      const c = prev[idx]
      const firstDur = t - c.outputStart
      const secondDur = c.outputDuration - firstDur
      const srcSplit = c.clipStart + firstDur // source second-half start
      const first  = { ...c, outputDuration: firstDur, clipEnd: srcSplit }
      const second = { ...c, id: `tmp_${++tmpClipCounter.current}`, clipStart: srcSplit, outputDuration: secondDur, transition: 'cut' }
      const next = [...prev.slice(0, idx), first, second, ...prev.slice(idx + 1)]
      return recalcStarts(next)
    })
    setEditsDirty(true); syncEditHist()
  }, [syncEditHist])

  /** Persist all local clip edits to the server, then trigger a re-render from them. */
  const applyEditsAndRender = useCallback(async () => {
    if (!workspace || !id) return
    setApplyingEdits(true)
    try {
      const clips = generatedClips
      // 1) deletions: db ids no longer present locally
      const presentIds = new Set(clips.map(c => c.id))
      const toDelete = [...dbClipIdsRef.current].filter(did => !presentIds.has(did))
      for (const did of toDelete) { await montageApi.deleteClip(workspace.id, id, did).catch(() => {}) }
      // 2) creates (tmp_ ids) + 3) updates (existing)
      const updates: Array<{ id: string; position: number; transition: string; clipStart: number; clipEnd: number; outputDuration: number }> = []
      const idRemap: Record<string, string> = {}
      for (let i = 0; i < clips.length; i++) {
        const c = clips[i]
        if (c.id.startsWith('tmp_')) {
          const { clip } = await montageApi.addClip(workspace.id, id, c.sourceVideoId, c.clipStart, c.clipEnd, {
            position: i, outputStart: c.outputStart, outputDuration: c.outputDuration, transition: c.transition,
            scoreOverall: c.scoreOverall, scoreMotion: c.scoreMotion, scoreBrightness: c.scoreBrightness, scoreSharpness: c.scoreSharpness, effects: c.effects,
          })
          idRemap[c.id] = clip.id
        } else {
          updates.push({ id: c.id, position: i, transition: c.transition, clipStart: c.clipStart, clipEnd: c.clipEnd, outputDuration: c.outputDuration })
        }
      }
      if (updates.length) await montageApi.updateClips(workspace.id, id, updates)
      // reflect new ids locally + refresh the db-id set
      if (Object.keys(idRemap).length) setGeneratedClips(prev => prev.map(c => idRemap[c.id] ? { ...c, id: idRemap[c.id] } : c))
      dbClipIdsRef.current = new Set(clips.map(c => idRemap[c.id] ?? c.id))
      editHistoryRef.current = []; editFutureRef.current = []
      setCanUndoEdits(false); setCanRedoEdits(false); setEditsDirty(false)
      // 4) re-render from the edited clips
      await montageApi.renderEdits(workspace.id, id)
      setGenerating(true)
      startPolling(workspace.id, id)
    } catch (e: unknown) { alert((e as Error).message) }
    finally { setApplyingEdits(false) }
  }, [workspace, id, generatedClips, startPolling])

  /** Snap a timeline time to nearby beats or clip edges (magnetic timeline). */
  const snapValue = useCallback((t: number): number => {
    if (!snapEnabled) return t
    const pps = pxPerSecRef.current || 40
    const threshold = 8 / pps // 8px magnetic radius, expressed in seconds
    let best = t, bestDist = threshold
    const consider = (cand: number) => { const d = Math.abs(cand - t); if (d < bestDist) { bestDist = d; best = cand } }
    beatData?.beats?.forEach(consider)
    for (const c of generatedClips) { consider(c.outputStart); consider(c.outputStart + c.outputDuration) }
    return best
  }, [snapEnabled, beatData, generatedClips])
  const snapValueRef = useRef(snapValue); snapValueRef.current = snapValue

  // ── Clip trim drag (one history entry per drag, live preview) ──────────
  const clipTrimRef = useRef<{ id: string; side: 'start' | 'end'; startX: number; startDur: number; startClipStart: number; startClipEnd: number } | null>(null)
  const beginEditHistory = useCallback(() => {
    editHistoryRef.current.push(generatedClips.map(c => ({ ...c })))
    if (editHistoryRef.current.length > 80) editHistoryRef.current.shift()
    editFutureRef.current = []
    syncEditHist()
  }, [generatedClips, syncEditHist])
  const liveUpdateClips = useCallback((fn: (clips: MontageClip[]) => MontageClip[]) => {
    setGeneratedClips(prev => recalcStarts(fn(prev.map(c => ({ ...c })))))
    setEditsDirty(true)
  }, [])
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = clipTrimRef.current; if (!d) return
      const pps = pxPerSecRef.current || 40
      const delta = (e.clientX - d.startX) / pps
      liveUpdateClips(clips => clips.map(c => {
        if (c.id !== d.id) return c
        if (d.side === 'end') {
          const dur = Math.max(0.2, d.startDur + delta)
          return { ...c, outputDuration: dur, clipEnd: d.startClipStart + dur }
        }
        const dur = Math.max(0.2, d.startDur - delta)
        return { ...c, outputDuration: dur, clipStart: Math.max(0, d.startClipEnd - dur) }
      }))
    }
    const onUp = () => { clipTrimRef.current = null }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [liveUpdateClips])

  // ── Editor keyboard shortcuts: undo/redo, split, frame-step ──────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target as HTMLElement)?.isContentEditable) return
      const ctrl = e.ctrlKey || e.metaKey
      if (ctrl && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); if (e.shiftKey) redoEdits(); else undoEdits(); return }
      if (ctrl && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); redoEdits(); return }
      if (!ctrl && (e.key === 'b' || e.key === 'B')) { e.preventDefault(); splitAtPlayhead(); return }
      if ((e.key === 'Delete' || e.key === 'Backspace') && !ctrl) {
        const ids = selectedRendIds.length ? selectedRendIds : (selectedRendClipId ? [selectedRendClipId] : [])
        if (ids.length) { e.preventDefault(); rippleDeleteClips(ids) }
        return
      }
      if (e.key === ',' || e.key === '.') {
        e.preventDefault()
        const step = (e.key === '.' ? 1 : -1) / FPS
        const nt = Math.max(0, Math.min(tlDurationRef.current, currentTimeRef.current + step))
        setCurrentTime(nt)
        if (videoRef.current) videoRef.current.currentTime = nt
        if (audioPlayerRef.current) audioPlayerRef.current.currentTime = nt
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undoEdits, redoEdits, splitAtPlayhead, rippleDeleteClips, selectedRendIds, selectedRendClipId])

  const handleGenerateMulti = useCallback(async () => {
    if (!workspace || !id) return
    setGeneratingMulti(true)
    try {
      await montageApi.generateMulti(workspace.id, id)
      alert('Génération multi-format lancée en arrière-plan !')
    } catch (e: unknown) { alert((e as Error).message) }
    finally { setGeneratingMulti(false) }
  }, [workspace, id])

  // ── Player controls ───────────────────────────────────────────────
  const togglePlay = useCallback(() => {
    const v = videoRef.current; if (!v) return
    if (playing) v.pause(); else v.play()
  }, [playing])

  const toggleMute = useCallback(() => {
    const v = videoRef.current; if (!v) return
    const n = !muted
    v.muted = n
    if (!n && vol === 0) { setVol(0.5); v.volume = 0.5 }
    setMuted(n)
  }, [muted, vol])

  const handleFullscreen = useCallback(() => {
    const el = videoRef.current?.parentElement
    if (!el) return
    if (document.fullscreenElement) document.exitFullscreen()
    else el.requestFullscreen?.()
  }, [])

  const handlePlayerMouseMove = useCallback(() => {
    setShowControls(true)
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current)
    if (playing) {
      controlsTimerRef.current = setTimeout(() => setShowControls(false), 3000)
    }
  }, [playing])

  // ── Keyboard shortcuts ────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ignore when focus is on an input / textarea / select / contenteditable
      const tag = (e.target as HTMLElement)?.tagName
      const isEditing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' ||
        (e.target as HTMLElement)?.isContentEditable
      if (isEditing) return

      const ctrl = e.ctrlKey || e.metaKey

      // ─ Space: play / pause ──────────────────────────────────────
      if (e.key === ' ' && !ctrl) {
        e.preventDefault()
        const v = videoRef.current
        if (v) { if (v.paused) v.play(); else v.pause() }
        return
      }

      // ─ Arrow seek ──────────────────────────────────────────────
      if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !ctrl) {
        e.preventDefault()
        const v = videoRef.current
        if (v) {
          const delta = e.shiftKey ? 1 : 5
          v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + (e.key === 'ArrowRight' ? delta : -delta)))
        }
        return
      }

      // ─ Escape: deselect clip ────────────────────────────────────
      if (e.key === 'Escape') {
        setSelectedClipId(null)
        setClipboardClipId(null)
        return
      }

      if (!selectedClipId || !workspace || !id) return

      // ─ Delete / Backspace: remove selected source clip (with confirm) ─
      if ((e.key === 'Delete' || e.key === 'Backspace') && !ctrl) {
        e.preventDefault()
        const toRemove = selectedClipId
        if (!window.confirm('Retirer cette vidéo source du projet ?')) return
        setSelectedClipId(null)
        setClipboardClipId(prev => prev === toRemove ? null : prev)
        montageApi.removeVideo(workspace.id, id, toRemove)
          .then(() => setProject(prev => prev ? { ...prev, sourceVideos: prev.sourceVideos.filter(sv => sv.id !== toRemove) } : prev))
          .catch((err: unknown) => alert((err as Error).message))
        return
      }

      // ─ Ctrl+C: copy ─────────────────────────────────────────────
      if (ctrl && e.key === 'c') {
        e.preventDefault()
        clipboardCutRef.current = false
        setClipboardClipId(selectedClipId)
        return
      }

      // ─ Ctrl+X: cut ──────────────────────────────────────────────
      if (ctrl && e.key === 'x') {
        e.preventDefault()
        clipboardCutRef.current = true
        setClipboardClipId(selectedClipId)
        return
      }

      // ─ Ctrl+D: duplicate selected ───────────────────────────────
      if (ctrl && e.key === 'd') {
        e.preventDefault()
        montageApi.duplicateVideo(workspace.id, id, selectedClipId)
          .then(({ sourceVideo }) => setProject(prev => prev ? { ...prev, sourceVideos: [...prev.sourceVideos, sourceVideo] } : prev))
          .catch((err: unknown) => alert((err as Error).message))
        return
      }
    }

    // ─ Ctrl+V: paste (executed outside onKey for clipboard access) ──
    const onKeyV = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      const isEditing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' ||
        (e.target as HTMLElement)?.isContentEditable
      if (isEditing || !(e.ctrlKey || e.metaKey) || e.key !== 'v') return
      if (!clipboardClipId || !workspace || !id) return
      e.preventDefault()
      const srcId = clipboardClipId
      const wasCut = clipboardCutRef.current
      if (wasCut) { setClipboardClipId(null); clipboardCutRef.current = false }
      montageApi.duplicateVideo(workspace.id, id, srcId)
        .then(({ sourceVideo }) => {
          setProject(prev => prev ? { ...prev, sourceVideos: [...prev.sourceVideos, sourceVideo] } : prev)
          if (wasCut) {
            setSelectedClipId(null)
            montageApi.removeVideo(workspace.id, id, srcId)
              .then(() => setProject(prev => prev ? { ...prev, sourceVideos: prev.sourceVideos.filter(sv => sv.id !== srcId) } : prev))
              .catch((err: unknown) => alert((err as Error).message))
          }
        })
        .catch((err: unknown) => alert((err as Error).message))
    }

    window.addEventListener('keydown', onKey)
    window.addEventListener('keydown', onKeyV)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keydown', onKeyV)
    }
  }, [selectedClipId, clipboardClipId, workspace, id])

  if (loading) return (
    <div className="flex flex-1 items-center justify-center gap-2" style={{ background: S.bg, color: S.textDim }}>
      <Loader2 size={16} className="animate-spin" style={{ color: S.accent }} />
      <span className="text-xs">Chargement…</span>
    </div>
  )
  if (error || !project) return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3" style={{ background: S.bg }}>
      <XCircle size={32} style={{ color: S.red }} />
      <p className="text-xs" style={{ color: S.textDim }}>{error ?? 'Projet introuvable'}</p>
      <button onClick={() => navigate('/montage')} className="text-xs" style={{ color: S.accent }}>← Retour</button>
    </div>
  )

  const isRunning = project.status === 'QUEUED' || project.status === 'PROCESSING'
  const job = project.renderJob
  const canGenerate = !!(project.audioPath && project.sourceVideos.some(sv => sv.localPath))
  // Use the /stream endpoint (supports HTTP Range requests / 206 Partial Content)
  // so the <video> element can seek. /download is kept for the download button only.
  const videoUrl = workspace ? montageApi.streamUrl(workspace.id, project.id) : ''
  const aspectRatio = project.ratio === 'PORTRAIT' ? '9/16' : project.ratio === 'SQUARE' ? '1/1' : '16/9'
  const totalClipDuration = project.sourceVideos.reduce((s, sv) => s + (sv.duration ?? 10), 0)
  const timelineDuration = (project.audioDuration ?? totalClipDuration) || 60
  const pxPerSec = 40 * tlZoom
  const totalTlW = Math.max(timelineDuration * pxPerSec, 600)
  // Keep refs up-to-date for non-React event handlers (no stale closures)
  pxPerSecRef.current   = pxPerSec
  tlDurationRef.current = timelineDuration
  currentTimeRef.current = currentTime

  return (
    <>
    <div className="flex flex-col fade-in" style={{ height: 'calc(100vh - 48px)', background: '#0e0e0e', fontFamily: 'monospace' }}>

      {/* ══ TOOLBAR ═══════════════════════════════════════════════════════ */}
      <div className="shrink-0 flex items-center gap-2 px-3 border-b overflow-x-auto" style={{ height: 44, background: '#1c1c1c', borderColor: '#2a2a2a', minWidth: 0 }}>
        <button onClick={() => navigate('/montage')} className="flex items-center gap-1 px-2 py-1.5 rounded text-xs hover:bg-white/10" style={{ color: '#aaa' }}>
          <ArrowLeft size={13} /> Montage
        </button>
        <div className="w-px h-5" style={{ background: '#333' }} />
        <Clapperboard size={13} style={{ color: S.accent }} />
        <span className="text-xs font-semibold truncate max-w-44" style={{ color: '#ddd' }}>{project.title}</span>
        <StatusBadge status={project.status} />
        <div className="w-px h-5" style={{ background: '#333' }} />

        {/* Mobile: toggle left panel */}
        <button
          className="md:hidden flex items-center justify-center p-1.5 rounded"
          style={{ color: showMobilePanel ? S.accent : '#666', background: showMobilePanel ? S.accent + '15' : 'transparent', border: 'none', cursor: 'pointer' }}
          onClick={() => setShowMobilePanel(v => !v)}
        >
          <PanelLeft size={14} />
        </button>
        <div className="w-px h-5 md:hidden" style={{ background: '#333' }} />

        {/* Panel toggle buttons */}
        {([
          ['effects',  <Sparkles size={10} />, 'Effets',        showEffectsModal,  setShowEffectsModal ],
          ['lyrics',   <Type     size={10} />, 'Paroles',       showLyricsModal,   setShowLyricsModal  ],
          ['library',  <Layers   size={10} />, 'Bibliothèque',  showLibraryModal,  setShowLibraryModal ],
        ] as const).map(([key, icon, label, active, setter]) => (
          <button key={key} onClick={() => setter((v: boolean) => !v)}
            className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold"
            style={{
              color: active ? S.accent : '#666',
              background: active ? S.accent + '15' : 'transparent',
              border: `1px solid ${active ? S.accent + '50' : 'transparent'}`,
            }}>
            {icon} {label}
          </button>
        ))}

        <div className="flex-1" />

        {isRunning && (
          <div className="flex items-center gap-2 px-2 py-1 rounded" style={{ background: '#141414', border: '1px solid #2a2a2a' }}>
            <Loader2 size={11} className="animate-spin" style={{ color: S.cyan }} />
            <span className="text-xs tabular-nums font-mono" style={{ color: S.cyan }}>{job?.progress ?? 0}%</span>
            <span className="text-[10px] max-w-28 truncate" style={{ color: '#555' }}>{job?.currentStep ?? '…'}</span>
          </div>
        )}

        <div className="w-px h-5" style={{ background: '#333' }} />
        <button onClick={() => setShowSettings(v => !v)} className="p-1.5 rounded hover:bg-white/10"
          style={{ color: showSettings ? S.accent : '#666', background: showSettings ? S.accent + '15' : 'transparent' }}>
          <Settings2 size={14} />
        </button>

        {project.status === 'COMPLETED' && workspace && (
          <>
            <a href={montageApi.downloadUrl(workspace.id, project.id)} download
              className="flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-semibold"
              style={{ background: '#2eb872', color: '#000', textDecoration: 'none' }}>
              <Download size={12} /> Télécharger
            </a>
            <button onClick={handleGenerateMulti} disabled={generatingMulti}
              title="Générer les versions Portrait (9:16) et Carré (1:1)"
              className="flex items-center gap-1 px-2 py-1.5 rounded text-xs font-semibold disabled:opacity-40"
              style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', color: '#aaa' }}>
              {generatingMulti ? <Loader2 size={11} className="animate-spin" /> : <Layers size={11} />}
              Multi-format
            </button>
            <button onClick={handleGenerate} disabled={generating}
              title="Regénérer entièrement la vidéo (nouvelle analyse des frames)"
              className="flex items-center gap-1 px-2 py-1.5 rounded text-xs font-semibold disabled:opacity-40"
              style={{ background: '#1a1a1a', border: '1px solid #333', color: '#888' }}>
              {generating ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
              Regénérer
            </button>
            <button onClick={() => setShowPublish(true)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-semibold"
              style={{ background: '#6366f1', color: '#fff' }}>
              <Share2 size={12} /> Publier
            </button>
          </>
        )}
        {(project.status === 'DRAFT' || project.status === 'FAILED') && !isRunning && (
          <button onClick={handleGenerate} disabled={!canGenerate || generating}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-semibold disabled:opacity-40"
            style={{ background: S.accent, color: '#000' }}>
            {generating ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
            Générer
          </button>
        )}
      </div>

      {/* ══ MAIN AREA ═════════════════════════════════════════════════════ */}
      <div className="flex flex-1 min-h-0 relative">

        {/* Mobile left panel backdrop */}
        {showMobilePanel && (
          <div
            className="fixed inset-0 z-30 md:hidden"
            style={{ background: 'rgba(0,0,0,0.6)' }}
            onClick={() => setShowMobilePanel(false)}
          />
        )}

        {/* ── Left panel ── */}
        <div
          className={`flex flex-col border-r shrink-0 md:translate-x-0 md:relative md:inset-auto md:z-auto fixed inset-y-0 left-0 z-40 transition-transform duration-200 ${showMobilePanel ? 'translate-x-0' : '-translate-x-full'}`}
          style={{ width: 280, background: '#161616', borderColor: '#222' }}
        >
          {/* Tab bar */}
          <div className="grid shrink-0 border-b" style={{ gridTemplateColumns: 'repeat(2, 1fr)', borderColor: '#222' }}>
            {([
              ['audio',  <Music2 size={11} />, 'Audio'],
              ['videos', <Video  size={11} />, 'Vidéos'],
            ] as const).map(([key, icon, label]) => (
              <button key={key} onClick={() => setTab(key as Tab)}
                className="flex flex-col items-center gap-0.5 py-2 text-[9px] font-semibold uppercase tracking-wider"
                style={{
                  color: tab === key ? S.accent : '#444',
                  borderBottom: tab === key ? `2px solid ${S.accent}` : '2px solid transparent',
                }}>
                {icon} {label}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-3">
            {/* ── Audio tab ── */}
            {tab === 'audio' && (
              <div className="flex flex-col gap-3">
                <p className="text-[10px]" style={{ color: '#555' }}>Chargez un fichier audio (MP3, WAV, etc.) sur lequel synchroniser le montage.</p>

                {project.audioPath ? (
                  <div className="rounded p-3" style={{ background: '#141414', border: '1px solid #2e2e2e' }}>
                    <div className="flex items-center gap-2 mb-2">
                      <Music2 size={13} style={{ color: S.accent }} />
                      <span className="text-xs font-medium truncate" style={{ color: '#ddd' }}>
                        {project.audioPath.split(/[/\\]/).pop()}
                      </span>
                    </div>
                    {project.audioDuration != null && (
                      <span className="text-[10px]" style={{ color: '#555' }}>{Math.round(project.audioDuration)}s</span>
                    )}
                    <div className="mt-2">
                      <button onClick={() => audioInputRef.current?.click()} disabled={audioUploading}
                        className="flex items-center gap-1 px-2 py-1 rounded text-[10px] hover:bg-white/10 disabled:opacity-40"
                        style={{ color: '#888', border: '1px solid #2e2e2e' }}>
                        {audioUploading ? <Loader2 size={10} className="animate-spin" /> : <Upload size={10} />} Remplacer
                      </button>
                    </div>
                  </div>
                ) : (
                  <div
                    onClick={() => audioInputRef.current?.click()}
                    className="rounded flex flex-col items-center justify-center gap-1 py-8 cursor-pointer"
                    style={{ border: '2px dashed #2e2e2e', color: '#555' }}
                    onMouseEnter={e => (e.currentTarget.style.borderColor = S.accent + '60')}
                    onMouseLeave={e => (e.currentTarget.style.borderColor = '#2e2e2e')}
                  >
                    {audioUploading
                      ? <Loader2 size={18} className="animate-spin" style={{ color: S.accent }} />
                      : <Music2 size={18} style={{ color: '#333' }} />
                    }
                    <p className="text-[10px] mt-1">{audioUploading ? 'Upload…' : 'Cliquer pour choisir un fichier audio'}</p>
                    <p className="text-[9px]" style={{ color: '#333' }}>MP3, WAV, OGG, FLAC, M4A</p>
                  </div>
                )}

                {/* ── Audio player ── */}
                {project.audioPath && workspace && (
                  <div className="rounded flex flex-col gap-2 p-3" style={{ background: '#0f0f0f', border: '1px solid #2e2e2e' }}>
                    <audio
                      key={project.audioPath}
                      ref={audioPlayerRef}
                      src={montageApi.audioUrl(workspace.id, project.id)}
                      onPlay={() => setAudioPlaying(true)}
                      onPause={() => setAudioPlaying(false)}
                      onEnded={() => setAudioPlaying(false)}
                      onTimeUpdate={() => {
                        const t = audioPlayerRef.current?.currentTime ?? 0
                        setAudioTime(t)
                        // Drive the shared timeline clock so the playhead + live lyric
                        // overlay follow the music (real-time lyric-timing preview).
                        setCurrentTime(t)
                      }}
                      onLoadedMetadata={() => setAudioDurState(audioPlayerRef.current?.duration ?? 0)}
                    />
                    <input
                      type="range" min={0} max={audioDurState || 1} step={0.05} value={audioTime}
                      onChange={e => {
                        const t = Number(e.target.value)
                        if (audioPlayerRef.current) audioPlayerRef.current.currentTime = t
                        setAudioTime(t)
                        setCurrentTime(t)
                      }}
                      className="w-full cursor-pointer"
                      style={{ accentColor: S.accent, height: 3 }}
                    />
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => audioPlaying ? audioPlayerRef.current?.pause() : audioPlayerRef.current?.play()}
                        className="p-1.5 rounded"
                        style={{ background: S.accent + '22', color: S.accent }}>
                        {audioPlaying ? <Pause size={10} /> : <Play size={10} />}
                      </button>
                      <span className="text-[9px] font-mono tabular-nums" style={{ color: '#555' }}>
                        {fmt(audioTime)} / {fmt(audioDurState)}
                      </span>
                    </div>
                  </div>
                )}
                <input ref={audioInputRef} type="file" accept=".mp3,.wav,.ogg,.flac,.m4a,.aac" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleAudioUpload(f); e.target.value = '' }} />

                {/* ── Library ── */}
                {libTracks.length > 0 && (
                  <div>
                    <div className="text-[9px] uppercase tracking-wider mb-1.5 mt-1" style={{ color: '#555' }}>Bibliothèque ({libTracks.length})</div>
                    <input
                      value={libSearch}
                      onChange={e => setLibSearch(e.target.value)}
                      placeholder="Rechercher…"
                      className="w-full px-2 py-1.5 rounded text-[10px] outline-none mb-2"
                      style={{ background: '#0a0a0a', border: '1px solid #2e2e2e', color: '#ccc' }}
                    />
                    <div className="flex flex-col gap-0.5 overflow-y-auto" style={{ maxHeight: 590, WebkitUserSelect: 'none', userSelect: 'none' }}>
                      {libTracks
                        .filter(t => !libSearch || `${t.title} ${t.artist ?? ''}`.toLowerCase().includes(libSearch.toLowerCase()))
                        .map(t => {
                          const isActive = project.audioPath?.includes(t.id) || project.audioPath === t.filePath
                          const isLoading = usingTrack === t.id
                          return (
                            <button
                              key={t.id}
                              onClick={() => isActive ? handleRemoveAudio() : (!usingTrack && handleUseTrack(t.id))}
                              title={isActive ? 'Retirer cet audio' : undefined}
                              className="flex items-center gap-2 px-2 py-1.5 rounded text-left w-full"
                              style={{
                                background: isActive ? S.accent + '18' : '#141414',
                                border: `1px solid ${isActive ? S.accent + '50' : '#2e2e2e'}`,
                                opacity: usingTrack && !isLoading ? 0.5 : 1,
                                cursor: usingTrack && !isActive ? 'default' : 'pointer',
                                WebkitTapHighlightColor: 'transparent',
                              }}
                            >
                              {t.artworkUrl
                                ? <img src={t.artworkUrl} className="shrink-0 rounded" style={{ width: 28, height: 28, objectFit: 'cover' }} />
                                : <div className="shrink-0 rounded flex items-center justify-center" style={{ width: 28, height: 28, background: '#2a2a2a' }}><Music2 size={11} style={{ color: '#555' }} /></div>
                              }
                              <div className="flex-1 min-w-0">
                                <div className="text-[10px] font-medium truncate" style={{ color: isActive ? S.accent : '#ccc' }}>{t.title}</div>
                                {t.artist && <div className="text-[9px] truncate" style={{ color: '#555' }}>{t.artist}</div>}
                              </div>
                              {isLoading
                                ? <Loader2 size={10} className="animate-spin shrink-0" style={{ color: S.accent }} />
                                : isActive
                                  ? <XCircle size={10} className="shrink-0" style={{ color: S.accent }} />
                                  : <span className="text-[9px] shrink-0" style={{ color: S.accent + '80' }}>▶</span>
                              }
                            </button>
                          )
                        })
                      }
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── Videos tab ── */}
            {tab === 'videos' && (
              <div className="flex flex-col gap-3">
                <p className="text-[10px]" style={{ color: '#555' }}>Ajoutez des vidéos sources par URL ou en uploadant des fichiers.</p>

                {/* URL */}
                <div>
                  <div className="text-[9px] uppercase tracking-wider mb-1.5" style={{ color: '#555' }}>Ajouter par URL</div>
                  <div className="flex gap-1.5">
                    <input
                      value={urlInput}
                      onChange={e => setUrlInput(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleAddUrl()}
                      placeholder="https://youtube.com/…"
                      className="flex-1 px-2 py-1.5 rounded text-[10px] outline-none"
                      style={{ background: '#0a0a0a', border: '1px solid #2e2e2e', color: '#ccc' }}
                    />
                    <button onClick={handleAddUrl} disabled={!urlInput.trim() || addingUrl}
                      className="p-1.5 rounded hover:bg-white/10 disabled:opacity-40"
                      style={{ color: '#888', border: '1px solid #2e2e2e' }}>
                      {addingUrl ? <Loader2 size={12} className="animate-spin" /> : <Link2 size={12} />}
                    </button>
                  </div>
                </div>

                {/* Upload */}
                <button onClick={() => videoInputRef.current?.click()} disabled={videoUploading}
                  className="flex items-center gap-1.5 px-2 py-1.5 rounded text-[10px] hover:bg-white/10 disabled:opacity-40 w-full"
                  style={{ color: '#888', border: '1px solid #2e2e2e' }}>
                  {videoUploading ? <Loader2 size={10} className="animate-spin" /> : <Upload size={10} />} Uploader un fichier
                </button>
                <input ref={videoInputRef} type="file" accept=".mp4,.mov,.mkv,.webm,.avi" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleVideoUpload(f); e.target.value = '' }} />

                {/* Video list */}
                {project.sourceVideos.length > 0 && (
                  <div className="flex flex-col gap-1 mt-1">
                    <div className="text-[9px] uppercase tracking-wider mb-1" style={{ color: '#555' }}>Sources ({project.sourceVideos.length})</div>
                    {project.sourceVideos.map(sv => {
                      const isError = sv.source.startsWith('ERROR:')
                      const isDone  = !!sv.localPath
                      const isPending = !isDone && !isError
                      const isAudioActive = project.audioPath?.includes(sv.id)
                      const isExtracting = extractingAudio === sv.id
                      return (
                        <div key={sv.id} className="flex items-center gap-2 px-2 py-1.5 rounded group"
                          style={{ background: '#141414', border: `1px solid ${isError ? S.red + '40' : '#2e2e2e'}` }}>
                          {isPending
                            ? <Loader2 size={10} className="animate-spin shrink-0" style={{ color: S.accent }} />
                            : isError
                              ? <XCircle size={10} className="shrink-0" style={{ color: S.red }} />
                              : <CheckCircle2 size={10} className="shrink-0" style={{ color: S.green }} />
                          }
                          <div className="flex-1 min-w-0">
                            <div className="text-[10px] font-medium truncate"
                              style={{ color: isError ? S.red : '#ccc' }}>
                              {isError
                                ? 'Échec du téléchargement'
                                : sv.type === 'URL'
                                  ? sv.source
                                  : (sv.source || sv.localPath?.split(/[/\\]/).pop() || 'Vidéo')}
                            </div>
                            <div className="text-[9px]" style={{ color: '#555' }}
                              title={isError ? sv.source.replace('ERROR: ', '') : undefined}>
                              {isError
                                ? sv.source.replace('ERROR: ', '').slice(0, 80)
                                : isPending
                                  ? 'Téléchargement en cours…'
                                  : sv.duration != null ? `${Math.round(sv.duration)}s · prêt` : 'Prêt'}
                            </div>
                          </div>
                          {/* Extract audio from this video */}
                          {isDone && (
                            <button
                              onClick={() => !extractingAudio && handleUseVideoAudio(sv.id)}
                              disabled={!!extractingAudio}
                              title={isAudioActive ? 'Audio de cette vidéo utilisé' : 'Utiliser l\'audio de cette vidéo'}
                              className="opacity-0 group-hover:opacity-100 p-1 rounded shrink-0"
                              style={{ color: isAudioActive ? S.accent : '#666', border: `1px solid ${isAudioActive ? S.accent + '50' : 'transparent'}` }}
                              onMouseEnter={e => { if (!isAudioActive) (e.currentTarget as HTMLElement).style.color = S.cyan }}
                              onMouseLeave={e => { if (!isAudioActive) (e.currentTarget as HTMLElement).style.color = '#666' }}
                            >
                              {isExtracting ? <Loader2 size={10} className="animate-spin" /> : <Music2 size={10} />}
                            </button>
                          )}
                          <button onClick={() => handleRemoveVideo(sv.id)} disabled={removingVid === sv.id}
                            className="opacity-0 group-hover:opacity-100 p-1 rounded"
                            style={{ color: '#555' }}
                            onMouseEnter={e => (e.currentTarget.style.color = S.red)}
                            onMouseLeave={e => (e.currentTarget.style.color = '#555')}>
                            {removingVid === sv.id ? <Loader2 size={10} className="animate-spin" /> : <Trash2 size={10} />}
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* ── Gallery ── */}
                {galleryVideos.length > 0 && (
                  <div>
                    <div className="text-[9px] uppercase tracking-wider mb-1.5 mt-1" style={{ color: '#555' }}>Galerie ({galleryVideos.length})</div>
                    <input
                      value={gallerySearch}
                      onChange={e => setGallerySearch(e.target.value)}
                      placeholder="Rechercher…"
                      className="w-full px-2 py-1.5 rounded text-[10px] outline-none mb-2"
                      style={{ background: '#0a0a0a', border: '1px solid #2e2e2e', color: '#ccc' }}
                    />
                    <div className="flex flex-col gap-0.5 overflow-y-auto" style={{ maxHeight: 590 }}>
                      {galleryVideos
                        .filter(v => !gallerySearch || `${v.title} ${v.artist ?? ''}`.toLowerCase().includes(gallerySearch.toLowerCase()))
                        .map(v => {
                          const alreadyAdded = project.sourceVideos.some(sv => sv.localPath === v.filePath)
                          const addedSvId = project.sourceVideos.find(sv => sv.localPath === v.filePath)?.id
                          const isLoading = addingFromGallery === v.id
                          return (
                            <button
                              key={v.id}
                              onClick={() => {
                                if (alreadyAdded && addedSvId) { handleRemoveVideo(addedSvId); return }
                                if (!addingFromGallery) handleAddFromGallery(v.id)
                              }}
                              disabled={alreadyAdded ? removingVid === addedSvId : !!addingFromGallery}
                              className="flex items-center gap-2 px-2 py-1.5 rounded text-left w-full group disabled:opacity-60"
                              style={{
                                background: alreadyAdded ? S.accent + '12' : '#141414',
                                border: `1px solid ${alreadyAdded ? S.accent + '40' : '#2e2e2e'}`,
                                cursor: 'pointer',
                              }}
                            >
                              {v.thumbnailUrl
                                ? <img src={v.thumbnailUrl} className="shrink-0 rounded" style={{ width: 36, height: 24, objectFit: 'cover' }} />
                                : <div className="shrink-0 rounded flex items-center justify-center" style={{ width: 36, height: 24, background: '#2a2a2a' }}><Video size={10} style={{ color: '#555' }} /></div>
                              }
                              <div className="flex-1 min-w-0">
                                <div className="text-[10px] font-medium truncate" style={{ color: alreadyAdded ? S.accent : '#ccc' }}>{v.title}</div>
                                <div className="text-[9px]" style={{ color: '#555' }}>
                                  {v.platform}{v.duration != null ? ` · ${Math.round(v.duration)}s` : ''}
                                </div>
                              </div>
                              {isLoading
                                ? <Loader2 size={10} className="animate-spin shrink-0" style={{ color: S.accent }} />
                                : removingVid === addedSvId
                                  ? <Loader2 size={10} className="animate-spin shrink-0" style={{ color: S.red }} />
                                  : alreadyAdded
                                    ? <span className="shrink-0 opacity-60 group-hover:opacity-100 flex items-center" title="Retirer"><XCircle size={10} style={{ color: S.red }} /></span>
                                    : <span className="text-[9px] opacity-0 group-hover:opacity-100 shrink-0" style={{ color: S.accent }}>Ajouter</span>
                              }
                            </button>
                          )
                        })
                      }
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Center column ── */}
        <div className="flex-1 flex flex-col min-h-0 min-w-0">

          {/* Video player area */}
          <div className="flex-1 flex items-center justify-center p-4 min-h-0" style={{ background: '#0e0e0e' }}>
            <div className="flex flex-col items-center gap-3 w-full h-full">
              {/* Frame wrapper */}
              <div
                ref={subtitleContainerRef}
                className="relative rounded overflow-hidden group"
                style={{
                  aspectRatio,
                  maxWidth: project.ratio === 'PORTRAIT' ? 210 : project.ratio === 'SQUARE' ? 380 : '100%',
                  maxHeight: 'calc(100% - 56px)',
                  width: project.ratio === 'PORTRAIT' ? 210 : '100%',
                  background: '#000',
                  border: '1px solid #222',
                  cursor: project.status === 'COMPLETED' ? 'pointer' : 'default',
                  flexShrink: 0,
                }}
                onMouseMove={handlePlayerMouseMove}
                onClick={project.status === 'COMPLETED' ? togglePlay : undefined}
              >
                {project.status === 'COMPLETED' ? (
                  <>
                    <video
                      ref={videoRef}
                      src={videoUrl}
                      style={{ width: '100%', height: '100%',
                        // 'fill' stretches to fill the container. Since the container
                        // already enforces the correct aspect ratio via CSS aspectRatio,
                        // this never distorts the video. Using 'contain' would add
                        // CSS-level black bars when the browser rounds the container size.
                        objectFit: 'fill', display: 'block' }}
                      onPlay={() => setPlaying(true)}
                      onPause={() => setPlaying(false)}
                      onTimeUpdate={() => {
                        // Skip state update while the user is dragging the seek bar
                        // — prevents React from snapping the range thumb back mid-drag.
                        if (!isSeekingRef.current)
                          setCurrentTime(videoRef.current?.currentTime ?? 0)
                      }}
                      onLoadedMetadata={() => setVidDuration(videoRef.current?.duration ?? 0)}
                    />
                    {/* Play icon overlay */}
                    {!playing && (
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <div className="rounded-full flex items-center justify-center"
                          style={{ width: 44, height: 44, background: 'rgba(0,0,0,0.55)', border: '1.5px solid rgba(255,255,255,0.25)' }}>
                          <Play size={18} fill="white" style={{ color: 'white', marginLeft: 2 }} />
                        </div>
                      </div>
                    )}
                    {/* Controls overlay */}
                    <div className="absolute bottom-0 left-0 right-0 transition-opacity"
                      style={{ opacity: (showControls || !playing) ? 1 : 0, background: 'linear-gradient(transparent, rgba(0,0,0,0.88))', padding: '28px 10px 8px', pointerEvents: (showControls || !playing) ? 'auto' : 'none' }}>
                      {/* Seek bar */}
                      <input type="range" min={0} max={vidDuration || 1} step={0.05} value={currentTime}
                        onMouseDown={e => { e.stopPropagation(); isSeekingRef.current = true }}
                        onMouseUp={() => { isSeekingRef.current = false }}
                        onChange={e => {
                          const t = Number(e.target.value)
                          setCurrentTime(t)
                          if (videoRef.current) videoRef.current.currentTime = t
                        }}
                        className="w-full mb-1.5 cursor-pointer"
                        style={{ accentColor: S.accent, height: 3 }}
                      />
                      <div className="flex items-center gap-2">
                        <button onClick={e => { e.stopPropagation(); togglePlay() }} style={{ color: 'white' }}>
                          {playing ? <Pause size={14} /> : <Play size={14} />}
                        </button>
                        <span className="text-[10px] font-mono tabular-nums select-none" style={{ color: '#ddd' }}>
                          {fmt(currentTime)} / {fmt(vidDuration)}
                        </span>
                        <div className="flex-1" />
                        <button onClick={e => { e.stopPropagation(); toggleMute() }} style={{ color: 'white' }}>
                          {muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
                        </button>
                        <input type="range" min={0} max={1} step={0.05} value={muted ? 0 : vol}
                          onChange={e => { const v = Number(e.target.value); setVol(v); if (videoRef.current) videoRef.current.volume = v; setMuted(v === 0) }}
                          onClick={e => e.stopPropagation()}
                          className="cursor-pointer" style={{ accentColor: S.accent, height: 2, width: 52 }}
                        />
                        <button onClick={e => { e.stopPropagation(); handleFullscreen() }} style={{ color: 'white' }}>
                          <Maximize2 size={13} />
                        </button>
                      </div>
                    </div>
                  </>
                ) : isRunning ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3" style={{ color: '#555' }}>
                    <Loader2 size={26} className="animate-spin" style={{ color: S.cyan }} />
                    <p className="text-xs font-mono" style={{ color: S.cyan }}>{job?.progress ?? 0}%</p>
                    <p className="text-[10px]">{job?.currentStep ?? 'En cours…'}</p>
                  </div>
                ) : (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2" style={{ color: '#2a2a2a' }}>
                    <Film size={30} />
                    <p className="text-[10px]">Rendu requis</p>
                  </div>
                )}

                {/* ── Live subtitle overlay — HTML overlay synced to currentTime ── */}
                <style>{`
                  @keyframes subFadeIn    { from { opacity:0 } to { opacity:1 } }
                  @keyframes subSlideUp   { from { opacity:0; transform:translateY(14px) } to { opacity:1; transform:translateY(0) } }
                  @keyframes subSlideDown { from { opacity:0; transform:translateY(-14px) } to { opacity:1; transform:translateY(0) } }
                  @keyframes subPop       { 0% { opacity:0; transform:scale(0.4) } 65% { transform:scale(1.08) } 100% { opacity:1; transform:scale(1) } }
                  @keyframes subBounce    { 0%,100% { transform:translateY(0) } 35% { transform:translateY(-8px) } 65% { transform:translateY(-3px) } }
                  @keyframes subNeon      { 0%,100% { filter:brightness(1) } 50% { filter:brightness(1.5) } }
                `}</style>

                {/* ── Snap guide lines — shown while dragging subtitle ── */}
                {subtitleIsDragging && subtitleCustomX === 50 && (
                  <div className="absolute pointer-events-none" style={{ top: 0, bottom: 0, left: '50%', width: 1, background: 'rgba(240,168,48,0.75)', zIndex: 20, transform: 'translateX(-50%)' }} />
                )}
                {subtitleIsDragging && subtitleCustomY === 50 && (
                  <div className="absolute pointer-events-none" style={{ left: 0, right: 0, top: '50%', height: 1, background: 'rgba(240,168,48,0.75)', zIndex: 20, transform: 'translateY(-50%)' }} />
                )}

                {(() => {
                  if (!transcriptSegments?.length) return null
                  const segIdx = transcriptSegments.findIndex(s => currentTime >= s.start && currentTime < s.end)
                  if (segIdx === -1) return null
                  const seg = transcriptSegments[segIdx]
                  const progress = Math.max(0, Math.min(1, (currentTime - seg.start) / Math.max(seg.end - seg.start, 0.001)))

                  // ── Position ─────────────────────────────────────────────────
                  const posStyle: CSSProperties = subtitlePos === 'CUSTOM'
                    ? { position: 'absolute', left: `${subtitleCustomX}%`, top: `${subtitleCustomY}%`, transform: 'translate(-50%,-50%)' }
                    : subtitlePos === 'TOP'
                    ? { position: 'absolute', top: '8%',  left: 0, right: 0, display: 'flex', justifyContent: 'center' }
                    : subtitlePos === 'CENTER'
                    ? { position: 'absolute', top: '50%', left: 0, right: 0, display: 'flex', justifyContent: 'center', transform: 'translateY(-50%)' }
                    : { position: 'absolute', bottom: '10%', left: 0, right: 0, display: 'flex', justifyContent: 'center' }

                  // ── Font ─────────────────────────────────────────────────────
                  const fontEntry = SUBTITLE_FONTS.find(f => f.id === subtitleFont)
                  const fontFamily = fontEntry?.css ?? 'Inter, sans-serif'
                  // Base size: 2.8% of container width, scaled by the user's size slider.
                  const fontSize = `clamp(0.45rem, calc(2.8cqw * ${(subtitleFontSize / 100).toFixed(2)}), calc(1.1rem * ${(subtitleFontSize / 100).toFixed(2)}))`

                  // ── Background ───────────────────────────────────────────────
                  const bgAlpha = Math.round(subtitleBgOpacity * 2.55).toString(16).padStart(2, '0')
                  const bgStyle = subtitleBgOpacity > 0 ? subtitleBgColor + bgAlpha : 'transparent'

                  // ── Text content (effect-specific) ───────────────────────────
                  let textContent: ReactNode
                  if (subtitleEffect === 'TYPEWRITER') {
                    textContent = seg.text.slice(0, Math.ceil(progress * seg.text.length))
                  } else if (subtitleEffect === 'KARAOKE') {
                    const chars = Math.ceil(progress * seg.text.length)
                    textContent = (
                      <>
                        <span style={{ color: subtitleColor }}>{seg.text.slice(0, chars)}</span>
                        <span style={{ color: subtitleColor + '55' }}>{seg.text.slice(chars)}</span>
                      </>
                    )
                  } else {
                    textContent = seg.text
                  }

                  // ── Animation ────────────────────────────────────────────────
                  const animStyle: CSSProperties =
                    subtitleEffect === 'FADE'       ? { animation: 'subFadeIn 0.25s ease' } :
                    subtitleEffect === 'SLIDE_UP'   ? { animation: 'subSlideUp 0.28s ease' } :
                    subtitleEffect === 'SLIDE_DOWN' ? { animation: 'subSlideDown 0.28s ease' } :
                    subtitleEffect === 'POP'        ? { animation: 'subPop 0.32s cubic-bezier(.36,.07,.19,.97)' } :
                    subtitleEffect === 'BOUNCE'     ? { animation: 'subBounce 0.45s ease' } :
                    subtitleEffect === 'NEON'       ? { animation: 'subNeon 1.2s ease infinite' } : {}

                  // ── Text shadow / special rendering ──────────────────────────
                  let textShadow = '0 1px 4px rgba(0,0,0,0.95), 0 0 10px rgba(0,0,0,0.8)'
                  let extraStyle: CSSProperties = {}
                  if (subtitleEffect === 'GLOW') {
                    textShadow = `0 0 8px ${subtitleEffectColor}, 0 0 22px ${subtitleEffectColor}cc, 0 0 44px ${subtitleEffectColor}66`
                  } else if (subtitleEffect === 'NEON') {
                    textShadow = `0 0 4px #fff, 0 0 11px #fff, 0 0 22px ${subtitleEffectColor}, 0 0 44px ${subtitleEffectColor}, 0 0 88px ${subtitleEffectColor}77`
                  } else if (subtitleEffect === 'OUTLINE') {
                    textShadow = 'none'
                    extraStyle = { WebkitTextStroke: `2px ${subtitleEffectColor}`, color: 'transparent' }
                  } else if (subtitleEffect === 'SHADOW') {
                    textShadow = `3px 3px 0 ${subtitleEffectColor}f0, 5px 5px 12px ${subtitleEffectColor}80`
                  }

                  return (
                    <div
                      className="absolute z-10"
                      style={{ ...posStyle, padding: subtitlePos === 'CUSTOM' ? 0 : '0 6%', maxWidth: '88%', cursor: 'grab', position: 'absolute' }}
                      onMouseDown={e => {
                        e.stopPropagation()
                        // Base the drag on the CURRENT position, else a subtitle already
                        // moved to a custom X snaps back toward centre on the first drag.
                        const px = subtitlePos === 'CUSTOM' ? subtitleCustomX : 50
                        const py = subtitlePos === 'CUSTOM' ? subtitleCustomY : subtitlePos === 'TOP' ? 8 : subtitlePos === 'CENTER' ? 50 : 85
                        subtitleDragStateRef.current = { active: true, startX: e.clientX, startY: e.clientY, startPx: px, startPy: py }
                      }}
                    >
                      <span
                        key={segIdx}
                        className="inline-block text-center leading-snug rounded px-2 py-0.5"
                        style={{
                          fontFamily,
                          fontSize,
                          fontWeight: 700,
                          color: subtitleEffect === 'OUTLINE' ? 'transparent' : subtitleColor,
                          textShadow,
                          background: bgStyle,
                          maxWidth: '100%',
                          wordBreak: 'break-word',
                          ...extraStyle,
                          ...animStyle,
                        }}>
                        {textContent}
                      </span>
                      {/* Resize handle — drag right/left to grow/shrink font size */}
                      <div
                        title="Redimensionner la police"
                        className="absolute flex items-center justify-center rounded-sm"
                        style={{ bottom: -7, right: -7, width: 14, height: 14, background: S.accent, cursor: 'ew-resize', zIndex: 20, opacity: 0.88 }}
                        onMouseDown={e => {
                          e.stopPropagation()
                          subtitleResizeStateRef.current = { active: true, startX: e.clientX, startSz: subtitleFontSize }
                        }}
                      >
                        <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                          <path d="M1 4h6M5 2l2 2-2 2" stroke="#000" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </div>
                    </div>
                  )
                })()}
              </div>

              {/* Badges + CTA */}
              <div className="flex flex-col items-center gap-2 shrink-0">
                <div className="flex gap-1.5 flex-wrap justify-center">
                  {[STYLE_LABELS[project.style], DURATION_LABELS[project.durationMode], RATIO_LABELS[project.ratio]].map(label => (
                    <span key={label} className="text-[9px] px-1.5 py-0.5 rounded font-mono"
                      style={{ background: '#151515', border: '1px solid #222', color: '#444' }}>
                      {label}
                    </span>
                  ))}
                </div>
                {(project.status === 'DRAFT' || project.status === 'FAILED') && (
                  <button onClick={handleGenerate} disabled={!canGenerate || generating}
                    className="flex items-center gap-1.5 px-4 py-1.5 rounded text-xs font-semibold disabled:opacity-40"
                    style={{ background: S.accent, color: '#000' }}>
                    {generating ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
                    Générer le montage
                  </button>
                )}
                {!project.audioPath && <p className="text-[9px] font-mono" style={{ color: '#444' }}>⚠ Ajoutez un fichier audio</p>}
                {!project.sourceVideos.some(sv => sv.localPath) && <p className="text-[9px] font-mono" style={{ color: '#444' }}>⚠ Ajoutez au moins une vidéo source</p>}
              </div>
            </div>
          </div>

          {/* ── Timeline ── */}
          {project.sourceVideos.length > 0 && (
            <div className="shrink-0 border-t flex flex-col" style={{ background: '#070707', borderColor: '#1a1a1a', height: timelineHeight, minHeight: 80, maxHeight: 400 }}>

              {/* ── Resize handle ── */}
              <div className="shrink-0 flex items-center justify-between px-2 cursor-ns-resize select-none"
                style={{ height: 8, background: '#0f0f0f', borderBottom: '1px solid #1a1a1a' }}
                onMouseDown={e => { tlResizeRef.current = { active: true, startY: e.clientY, startH: timelineHeight } }}>
                <GripVertical size={10} style={{ color: '#2e2e2e', transform: 'rotate(90deg)' }} />
                {/* Mobile: quick-add + panel toggle button */}
                <button className="md:hidden flex items-center gap-1 text-[8px] px-1.5 rounded"
                  style={{ color: '#555', lineHeight: 1 }}
                  onMouseDown={e => e.stopPropagation()}
                  onClick={e => { e.stopPropagation(); setTab('videos'); setShowMobilePanel(true) }}>
                  <Plus size={8} /> Ajouter
                </button>
                {/* Keyboard shortcuts hint — not a drag handle, stop propagation */}
                <div className="relative" onMouseDown={e => e.stopPropagation()}>
                  <button title="Raccourcis clavier"
                    className="flex items-center gap-0.5 text-[7px] font-mono px-1 rounded hover:brightness-200"
                    style={{ color: '#333', lineHeight: 1 }}>⌨ ?</button>
                  {/* tooltip on hover via CSS group */}
                </div>
              </div>

              {/* ── Editing toolbar (trim/split/transitions/undo — needs generated clips) ── */}
              {generatedClips.length > 0 && (() => {
                const selRendClip = selectedRendIds.length === 0 ? generatedClips.find(c => c.id === selectedRendClipId) : null
                const ff = Math.floor((currentTime % 1) * FPS)
                const mm = Math.floor(currentTime / 60), ss = Math.floor(currentTime % 60)
                const tc = `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}:${String(ff).padStart(2, '0')}`
                return (
                  <div className="shrink-0 flex items-center gap-1 px-2 overflow-x-auto" style={{ height: 26, background: '#0b0b0b', borderBottom: '1px solid #1a1a1a' }}>
                    <span className="text-[9px] font-mono tabular-nums px-1 rounded" style={{ background: '#0a0a0a', color: '#4f8ef7', border: '1px solid #1e1e1e' }} title="mm:ss:frames">{tc}</span>
                    <div className="w-px h-3.5" style={{ background: '#222' }} />
                    <button onClick={undoEdits} disabled={!canUndoEdits} title="Annuler (Ctrl+Z)" className="p-0.5 rounded disabled:opacity-25 hover:bg-white/10" style={{ color: '#aaa' }}><Undo2 size={12} /></button>
                    <button onClick={redoEdits} disabled={!canRedoEdits} title="Rétablir (Ctrl+Shift+Z)" className="p-0.5 rounded disabled:opacity-25 hover:bg-white/10" style={{ color: '#aaa' }}><Redo2 size={12} /></button>
                    <div className="w-px h-3.5" style={{ background: '#222' }} />
                    <button onClick={splitAtPlayhead} title="Diviser au curseur (B)" className="flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] hover:bg-white/10" style={{ color: '#ccc' }}><Scissors size={11} /> Diviser</button>
                    <button onClick={() => setSnapEnabled(s => !s)} title="Aimantation (beats + bords)" className="p-0.5 rounded hover:bg-white/10" style={{ color: snapEnabled ? '#f0a830' : '#555', background: snapEnabled ? 'rgba(240,168,48,0.12)' : 'transparent' }}><Magnet size={12} /></button>
                    {selectedRendIds.length > 1 && (
                      <>
                        <div className="w-px h-3.5" style={{ background: '#222' }} />
                        <span className="text-[9px]" style={{ color: '#888' }}>{selectedRendIds.length} sél.</span>
                        <button onClick={() => rippleDeleteClips(selectedRendIds)} className="flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px]" style={{ color: '#e74c3c', background: '#e74c3c15' }}><Trash2 size={10} /> Suppr.</button>
                      </>
                    )}
                    {selRendClip && (
                      <>
                        <div className="w-px h-3.5" style={{ background: '#222' }} />
                        <span className="text-[8px] uppercase" style={{ color: '#555' }}>Transition</span>
                        {CLIP_TRANSITIONS.map(tr => (
                          <button key={tr.id} onClick={() => setClipTransition(selRendClip.id, tr.id)}
                            className="px-1 py-0.5 rounded text-[9px]"
                            style={{ color: selRendClip.transition === tr.id ? '#000' : tr.color, background: selRendClip.transition === tr.id ? tr.color : tr.color + '18' }}>
                            {tr.label}
                          </button>
                        ))}
                      </>
                    )}
                    <div className="flex-1" />
                    {editsDirty && (
                      <button onClick={applyEditsAndRender} disabled={applyingEdits}
                        className="flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-semibold shrink-0 disabled:opacity-50"
                        style={{ background: S.accent, color: '#000' }}>
                        {applyingEdits ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />}
                        Appliquer &amp; re-render
                      </button>
                    )}
                  </div>
                )
              })()}

              <div className="flex flex-1 min-h-0 overflow-hidden">
                {/* ── Left track labels + zoom controls ── */}
                <div className="shrink-0 flex flex-col" style={{ width: 52, background: '#0c0c0c', borderRight: '1px solid #1a1a1a' }}>
                  {/* Zoom */}
                  <div className="flex items-center justify-center gap-1 shrink-0" style={{ height: 20, borderBottom: '1px solid #111' }}>
                    <button onClick={() => setTlZoom(z => Math.min(8, +(z * 1.4).toFixed(2)))}
                      className="hover:brightness-200" style={{ color: '#444', lineHeight: 1 }}>
                      <ZoomIn size={9} />
                    </button>
                    <span className="text-[7px] font-mono tabular-nums" style={{ color: '#333' }}>{tlZoom.toFixed(1)}x</span>
                    <button onClick={() => setTlZoom(z => Math.max(0.2, +(z / 1.4).toFixed(2)))}
                      className="hover:brightness-200" style={{ color: '#444', lineHeight: 1 }}>
                      <ZoomOut size={9} />
                    </button>
                  </div>
                  {/* Audio label */}
                  {project.audioPath && (
                    <div className="flex items-center justify-center shrink-0" style={{ height: 32, borderBottom: '1px solid #111' }}>
                      <Music2 size={9} style={{ color: '#333' }} />
                    </div>
                  )}
                  {/* Generated clips label */}
                  {generatedClips.length > 0 && (
                    <div className="flex flex-col items-center justify-center gap-0.5 shrink-0 px-0.5"
                      style={{ height: 34, borderBottom: '1px solid #111' }}>
                      <Film size={8} style={{ color: '#4ade8066' }} />
                      <span className="text-[5px] font-mono text-center leading-none" style={{ color: '#4ade8066' }}>{generatedClips.length}</span>
                    </div>
                  )}
                  {/* Lyrics label */}
                  {transcriptSegments && transcriptSegments.length > 0 && (
                    <div className="flex flex-col items-center justify-center gap-0.5 shrink-0 px-1"
                      style={{ height: 30, borderBottom: '1px solid #111' }}>
                      <Type size={8} style={{ color: '#6a5acd' }} />
                      <span className="text-[5px] font-mono" style={{ color: '#444' }}>SUB</span>
                    </div>
                  )}
                  {/* Video label */}
                  <div className="flex items-center justify-center flex-1">
                    <Film size={9} style={{ color: '#333' }} />
                  </div>
                </div>

                {/* ── Scrollable timeline content ── */}
                <div ref={tlScrollRef} className="flex-1 overflow-x-auto overflow-y-hidden relative"
                  style={{ scrollbarWidth: 'thin', scrollbarColor: '#2a2a2a transparent' }}>
                  <div style={{ width: totalTlW + 48, minWidth: '100%', position: 'relative' }}>

                    {/* Ruler — click/drag/touch to scrub */}
                    <div className="flex items-end sticky top-0 z-10 cursor-col-resize select-none"
                      style={{ height: 20, background: '#0a0a0a', borderBottom: '1px solid #111' }}
                      onMouseDown={e => {
                        scrubRef.current = true
                        const rect = tlScrollRef.current!.getBoundingClientRect()
                        const x = e.clientX - rect.left + (tlScrollRef.current?.scrollLeft ?? 0)
                        const t = snapValue(Math.max(0, Math.min(tlDurationRef.current, x / pxPerSecRef.current)))
                        setCurrentTime(t)
                        if (videoRef.current) videoRef.current.currentTime = t
                        if (audioPlayerRef.current) audioPlayerRef.current.currentTime = t
                      }}
                      onTouchStart={e => {
                        scrubRef.current = true
                        const rect = tlScrollRef.current!.getBoundingClientRect()
                        const x = e.touches[0].clientX - rect.left + (tlScrollRef.current?.scrollLeft ?? 0)
                        const t = snapValue(Math.max(0, Math.min(tlDurationRef.current, x / pxPerSecRef.current)))
                        setCurrentTime(t)
                        if (videoRef.current) videoRef.current.currentTime = t
                        if (audioPlayerRef.current) audioPlayerRef.current.currentTime = t
                      }}
                      onTouchMove={e => {
                        if (!scrubRef.current) return
                        e.preventDefault()
                        const rect = tlScrollRef.current!.getBoundingClientRect()
                        const x = e.touches[0].clientX - rect.left + (tlScrollRef.current?.scrollLeft ?? 0)
                        const t = snapValue(Math.max(0, Math.min(tlDurationRef.current, x / pxPerSecRef.current)))
                        setCurrentTime(t)
                        if (videoRef.current) videoRef.current.currentTime = t
                        if (audioPlayerRef.current) audioPlayerRef.current.currentTime = t
                      }}
                      onTouchEnd={() => { scrubRef.current = false }}>
                      {Array.from({ length: Math.ceil(timelineDuration ?? 0) + 1 }, (_, i) => {
                        const x = i * pxPerSec
                        if (x > totalTlW + 8) return null
                        const step = Math.max(1, Math.ceil(4 / tlZoom))
                        const showLabel = i % step === 0
                        return (
                          <div key={i} className="absolute flex flex-col items-center" style={{ left: x }}>
                            <div style={{ width: 1, height: showLabel ? 8 : 3, background: showLabel ? '#2e2e2e' : '#1a1a1a' }} />
                            {showLabel && (
                              <span className="text-[7px] font-mono" style={{ color: '#2e2e2e', transform: 'translateX(-50%)', whiteSpace: 'nowrap' }}>
                                {fmt(i)}
                              </span>
                            )}
                          </div>
                        )
                      })}
                      {/* Beat markers on ruler */}
                      {beatData?.beats?.map((beat, bi) => {
                        const bx = beat * pxPerSec
                        if (bx > totalTlW + 4) return null
                        const isDrop = beatData.drops?.includes(beat)
                        return (
                          <div key={bi} className="absolute pointer-events-none"
                            style={{ left: bx, top: isDrop ? 0 : 6, width: 1, height: isDrop ? 20 : 12, background: isDrop ? '#f0a83066' : '#3a3a3a66' }} />
                        )
                      })}
                    </div>

                    {/* ── Audio waveform track ── */}
                    {project.audioPath && (
                      <div className="relative" style={{ height: 32, borderBottom: '1px solid #111', background: '#080808' }}>
                        <canvas ref={waveformCanvasRef} style={{ width: totalTlW, height: 32, display: 'block' }} />
                        {timelineDuration > 0 && (
                          <div className="absolute top-0 bottom-0 w-px pointer-events-none"
                            style={{ left: currentTime * pxPerSec, background: 'rgba(255,255,255,0.8)', boxShadow: '0 0 3px rgba(255,255,255,0.5)' }} />
                        )}
                      </div>
                    )}

                    {/* ── Generated clips track (shown after COMPLETED render) ── */}
                    {generatedClips.length > 0 && (
                      <div className="relative" style={{ height: 34, borderBottom: '1px solid #111', background: '#040408' }}>
                        {/* Section backgrounds from beat data */}
                        {beatData?.sections?.map((sec, si) => {
                          const sectionColors: Record<string, string> = { chorus: '#f0a83008', drop: '#e74c3c10', intro: '#4f8ef708', verse: '#00000000', bridge: '#9b59e208', outro: '#4f8ef706' }
                          const bg = sectionColors[sec.type] ?? 'transparent'
                          return (
                            <div key={si} className="absolute pointer-events-none"
                              style={{ left: sec.start * pxPerSec, width: (sec.end - sec.start) * pxPerSec, top: 0, bottom: 0, background: bg }} />
                          )
                        })}
                        {generatedClips.map((clip) => {
                          const x = clip.outputStart * pxPerSec
                          const w = Math.max(4, clip.outputDuration * pxPerSec - 1)
                          const score = clip.scoreOverall
                          const clipColor = score >= 0.7 ? '#4ade80' : score >= 0.4 ? '#facc15' : '#e74c3c'
                          const isSel = selectedRendClipId === clip.id || selectedRendIds.includes(clip.id)
                          const trans = CLIP_TRANSITIONS.find(t => t.id === clip.transition)
                          return (
                            <div key={clip.id}
                              onClick={e => {
                                if (e.shiftKey || e.ctrlKey || e.metaKey) {
                                  // multi-select toggle
                                  setSelectedRendIds(prev => prev.includes(clip.id) ? prev.filter(x2 => x2 !== clip.id) : [...prev, clip.id])
                                  setSelectedRendClipId(clip.id)
                                } else {
                                  setSelectedRendIds([])
                                  setSelectedRendClipId(isSel && selectedRendIds.length === 0 ? null : clip.id)
                                  setCurrentTime(clip.outputStart)
                                  if (videoRef.current) videoRef.current.currentTime = clip.outputStart
                                  if (audioPlayerRef.current) audioPlayerRef.current.currentTime = clip.outputStart
                                }
                              }}
                              className="absolute flex items-center justify-between cursor-pointer group"
                              style={{
                                left: x, top: 3, bottom: 3, width: w,
                                background: `linear-gradient(135deg, ${clipColor}18, ${clipColor}08)`,
                                border: `1px solid ${isSel ? clipColor : clipColor + '40'}`,
                                borderRadius: 2,
                                boxShadow: isSel ? `0 0 6px ${clipColor}40` : 'none',
                              }}>
                              {/* Trim handles (drag to change duration) */}
                              <div title="Rogner le début"
                                onMouseDown={e => { e.stopPropagation(); beginEditHistory(); clipTrimRef.current = { id: clip.id, side: 'start', startX: e.clientX, startDur: clip.outputDuration, startClipStart: clip.clipStart, startClipEnd: clip.clipEnd } }}
                                className="absolute left-0 top-0 bottom-0 z-10"
                                style={{ width: 6, cursor: 'ew-resize', background: isSel ? clipColor + '55' : 'transparent' }} />
                              <div title="Rogner la fin"
                                onMouseDown={e => { e.stopPropagation(); beginEditHistory(); clipTrimRef.current = { id: clip.id, side: 'end', startX: e.clientX, startDur: clip.outputDuration, startClipStart: clip.clipStart, startClipEnd: clip.clipEnd } }}
                                className="absolute right-0 top-0 bottom-0 z-10"
                                style={{ width: 6, cursor: 'ew-resize', background: isSel ? clipColor + '55' : 'transparent' }} />
                              {/* Score badge */}
                              {w > 20 && (
                                <span className="absolute right-1.5 top-0.5 text-[5px] font-bold font-mono" style={{ color: clipColor + 'cc' }}>
                                  {Math.round(score * 100)}
                                </span>
                              )}
                              {/* Transition badge */}
                              {clip.transition !== 'cut' && w > 24 && trans && (
                                <span className="absolute left-1.5 bottom-0.5 text-[5px] font-mono uppercase" style={{ color: trans.color }}>
                                  {trans.label.slice(0, 4)}
                                </span>
                              )}
                              {/* Delete button (on selected clip) */}
                              {isSel && (
                                <button
                                  onClick={e => { e.stopPropagation(); handleDeleteRendClip(clip.id) }}
                                  title="Retirer ce clip (Suppr)"
                                  className="absolute -top-3 -right-1 flex items-center justify-center rounded-full z-20"
                                  style={{ width: 12, height: 12, background: '#e74c3c', border: '1px solid #c0392b' }}>
                                  <span style={{ color: 'white', fontSize: 7, lineHeight: 1 }}>×</span>
                                </button>
                              )}
                            </div>
                          )
                        })}
                        {/* Playhead overlay */}
                        {timelineDuration > 0 && (
                          <div className="absolute top-0 bottom-0 w-px pointer-events-none z-10"
                            style={{ left: currentTime * pxPerSec, background: 'rgba(255,255,255,0.5)' }} />
                        )}
                      </div>
                    )}

                    {/* ── Video clips track ── */}
                    <div className="relative" style={{ height: timelineHeight - 28 - (project.audioPath ? 32 : 0) - (transcriptSegments?.length ? 30 : 0), minHeight: 44, background: '#080808' }}>
                      {/* Selected clip action bar */}
                      {selectedClipId && (
                        <div className="absolute top-1 right-2 z-20 flex items-center gap-1 px-1.5 py-0.5 rounded"
                          style={{ background: '#111', border: '1px solid #2a2a2a' }}>
                          {/* Mobile: real action buttons */}
                          <button className="md:hidden flex items-center gap-0.5 text-[8px] px-1.5 py-0.5 rounded"
                            style={{ background: '#e74c3c22', color: '#e74c3c', border: '1px solid #e74c3c44' }}
                            onClick={() => {
                              const toRemove = selectedClipId
                              setSelectedClipId(null)
                              setClipboardClipId(prev => prev === toRemove ? null : prev)
                              montageApi.removeVideo(workspace!.id, id!, toRemove)
                                .then(() => setProject(prev => prev ? { ...prev, sourceVideos: prev.sourceVideos.filter(sv => sv.id !== toRemove) } : prev))
                                .catch((err: unknown) => alert((err as Error).message))
                            }}>
                            <Trash2 size={9} /> Suppr.
                          </button>
                          {/* Desktop: keyboard shortcut hints */}
                          {([
                            ['Del', 'Suppr'],
                            ['Ctrl+C', 'Copier'],
                            ['Ctrl+X', 'Couper'],
                            ['Ctrl+D', 'Dupliquer'],
                            ...(clipboardClipId ? [['Ctrl+V', 'Coller']] : []),
                          ] as [string, string][]).map(([key, label]) => (
                            <span key={key} className="hidden md:flex items-center gap-0.5 text-[7px]" style={{ color: '#444' }}>
                              <kbd className="px-0.5 rounded" style={{ background: '#1e1e1e', border: '1px solid #333', color: '#666', fontFamily: 'monospace' }}>{key}</kbd>
                              <span>{label}</span>
                            </span>
                          ))}
                        </div>
                      )}
                      {orderedClips.map((sv, i) => {
                        const clipW = Math.max(36, (sv.duration ?? 10) * pxPerSec)
                        const x = orderedClips.slice(0, i).reduce((acc, c) => acc + Math.max(36, (c.duration ?? 10) * pxPerSec), 0)
                        const color = CLIP_COLORS[i % CLIP_COLORS.length]
                        const isError = sv.source.startsWith('ERROR:')
                        const isDone = !!sv.localPath
                        const isDragging = dragClipIdx === i
                        const isDropTarget = dropClipIdx === i && dragClipIdx !== i
                        const isSelected = selectedClipId === sv.id
                        const isInClipboard = clipboardClipId === sv.id
                        const rawName = sv.type === 'URL'
                          ? sv.source.split('/').pop()
                          : (sv.source || sv.localPath?.split(/[/\\]/).pop()) ?? `Clip ${i + 1}`
                        const clipName = (rawName ?? `Clip ${i + 1}`).slice(0, 24)
                        // Thumbnail URL (auth token via query param)
                        const thumbToken = localStorage.getItem('ss_token') ?? ''
                        const thumbUrl = isDone && workspace
                          ? `/api/workspaces/${workspace.id}/montage/${id}/clip-thumb/${sv.id}${thumbToken ? `?token=${encodeURIComponent(thumbToken)}` : ''}`
                          : null
                        return (
                          <div key={sv.id} draggable
                            onDragStart={() => setDragClipIdx(i)}
                            onDragOver={e => { e.preventDefault(); setDropClipIdx(i) }}
                            onDrop={() => {
                              if (dragClipIdx === null || dragClipIdx === i) return
                              const newOrder = [...localClipOrder]
                              const [moved] = newOrder.splice(dragClipIdx, 1)
                              newOrder.splice(i, 0, moved)
                              setLocalClipOrder(newOrder)
                              if (workspace) montageApi.reorderVideos(workspace.id, project.id, newOrder).catch(() => {})
                              setDragClipIdx(null); setDropClipIdx(null)
                            }}
                            onDragEnd={() => { setDragClipIdx(null); setDropClipIdx(null) }}
                            onClick={() => setSelectedClipId(isSelected ? null : sv.id)}
                            onTouchStart={_e => {
                              touchDragRef.current = { clipIdx: i }
                              setDragClipIdx(i)
                              setSelectedClipId(isSelected ? null : sv.id)
                            }}
                            onTouchMove={e => {
                              if (!touchDragRef.current) return
                              e.preventDefault()
                              const container = tlScrollRef.current
                              if (!container) return
                              const rect = container.getBoundingClientRect()
                              const relX = e.touches[0].clientX - rect.left + container.scrollLeft
                              let acc = 0
                              for (let j = 0; j < orderedClips.length; j++) {
                                const w = Math.max(36, (orderedClips[j].duration ?? 10) * pxPerSecRef.current)
                                if (relX < acc + w / 2) { setDropClipIdx(j); return }
                                acc += w
                              }
                              setDropClipIdx(orderedClips.length - 1)
                            }}
                            onTouchEnd={() => {
                              if (touchDragRef.current && dragClipIdx !== null && dropClipIdx !== null && dragClipIdx !== dropClipIdx) {
                                const newOrder = [...localClipOrder]
                                const [moved] = newOrder.splice(dragClipIdx, 1)
                                newOrder.splice(dropClipIdx, 0, moved)
                                setLocalClipOrder(newOrder)
                                if (workspace) montageApi.reorderVideos(workspace.id, project.id, newOrder).catch(() => {})
                              }
                              setDragClipIdx(null); setDropClipIdx(null)
                              touchDragRef.current = null
                            }}
                            className="absolute flex flex-col justify-between rounded overflow-hidden cursor-grab active:cursor-grabbing"
                            style={{
                              left: x, top: 4, bottom: 4, width: clipW - 2,
                              background: `linear-gradient(135deg, ${color}22, ${color}0d)`,
                              border: `1px solid ${isError ? '#e74c3c' : isSelected ? color : color + '55'}`,
                              opacity: isDragging ? 0.4 : 1,
                              outline: isDropTarget ? `2px solid ${color}99` : isSelected ? `2px solid ${color}66` : isInClipboard ? `2px dashed ${color}88` : 'none',
                              boxShadow: isDropTarget ? `0 0 8px ${color}44` : isSelected ? `0 0 6px ${color}33` : 'none',
                              userSelect: 'none',
                            }}>
                            {/* Video thumbnail background */}
                            {thumbUrl && (
                              <img src={thumbUrl} alt="" aria-hidden
                                className="absolute inset-0 w-full h-full pointer-events-none"
                                style={{ objectFit: 'cover', opacity: 0.18 }} />
                            )}
                            {/* Clip name */}
                            <div className="relative flex items-center gap-1 px-1.5 pt-0.5">
                              {!isDone && !isError && <Loader2 size={6} className="animate-spin shrink-0" style={{ color }} />}
                              {isError && <XCircle size={6} className="shrink-0" style={{ color: '#e74c3c' }} />}
                              <span className="text-[7px] font-semibold truncate leading-tight" style={{ color: isDone ? color : '#444' }}>{clipName}</span>
                            </div>
                            {/* Duration + timecode */}
                            {isDone && sv.duration != null && clipW > 50 && (
                              <div className="relative flex items-center justify-between px-1.5 pb-0.5">
                                <span className="text-[6px] font-mono tabular-nums" style={{ color: color + '66' }}>{fmt(0)}</span>
                                <span className="text-[6px] font-mono tabular-nums" style={{ color: color + '88' }}>{sv.duration.toFixed(1)}s</span>
                              </div>
                            )}
                            {/* Trim handles */}
                            <div className="absolute left-0 top-0 bottom-0 w-1.5 cursor-ew-resize rounded-l" style={{ background: `linear-gradient(to right, ${color}88, transparent)` }} />
                            <div className="absolute right-0 top-0 bottom-0 w-1.5 cursor-ew-resize rounded-r" style={{ background: `linear-gradient(to left, ${color}88, transparent)` }} />
                          </div>
                        )
                      })}

                      {/* + Add clip button */}
                      <button onClick={() => setTab('videos')}
                        className="absolute flex items-center justify-center rounded hover:brightness-150 transition-all"
                        style={{
                          left: orderedClips.reduce((acc, c) => acc + Math.max(36, (c.duration ?? 10) * pxPerSec), 0) + 8,
                          top: '50%', transform: 'translateY(-50%)',
                          width: 22, height: 22,
                          background: '#141414', border: '1px solid #2a2a2a', color: '#444',
                        }}>
                        <Plus size={9} />
                      </button>

                      {/* Playhead */}
                      {timelineDuration > 0 && (
                        <div className="absolute top-0 bottom-0 w-0.5 z-10 pointer-events-none"
                          style={{ left: currentTime * pxPerSec, background: 'white', boxShadow: '0 0 4px rgba(255,255,255,0.6)' }}>
                          {/* Playhead head */}
                          <div style={{ position: 'absolute', top: -5, left: -3, width: 7, height: 5,
                            background: 'white', borderRadius: '2px 2px 0 0', clipPath: 'polygon(0 0, 100% 0, 50% 100%)' }} />
                        </div>
                      )}
                    </div>

                    {/* ── Lyrics / Transcription track ── */}
                    {transcriptSegments && transcriptSegments.length > 0 && (
                      <div className="relative" style={{ height: 30, borderTop: '1px solid #1a1a1a', background: '#060608' }}>
                        {transcriptSegments.map((seg, i) => {
                          const sx = seg.start * pxPerSec
                          const sw = Math.max(2, (seg.end - seg.start) * pxPerSec)
                          const hue = (i * 53 + 200) % 360  // blue-purple range
                          return (
                            <div key={i}
                              title={seg.text}
                              onClick={() => {
                                setCurrentTime(seg.start)
                                if (videoRef.current) videoRef.current.currentTime = seg.start
                              }}
                              className="absolute group cursor-pointer hover:brightness-125 transition-all"
                              style={{
                                left: sx, top: 5, bottom: 5, width: Math.max(2, sw - 1),
                                background: `hsla(${hue},55%,28%,0.85)`,
                                border: `1px solid hsla(${hue},60%,50%,0.6)`,
                                borderRadius: 2,
                                overflow: 'hidden',
                              }}>
                              {sw > 24 && (
                                <span className="absolute inset-x-1 top-0 bottom-0 flex items-center text-[6px] font-mono truncate"
                                  style={{ color: `hsla(${hue},80%,80%,0.9)` }}>
                                  {seg.text}
                                </span>
                              )}
                            </div>
                          )
                        })}
                        {/* Playhead */}
                        <div className="absolute top-0 bottom-0 w-px pointer-events-none z-10"
                          style={{ left: currentTime * pxPerSec, background: 'rgba(255,255,255,0.6)' }} />
                      </div>
                    )}

                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── Settings panel: desktop side panel (inline in flex row, desktop only) ── */}
        {showSettings && !isMobile && (
          <div className="shrink-0 flex flex-col border-l" style={{ width: 240, background: '#161616', borderColor: '#222' }}>
            <div className="flex items-center justify-between px-3 py-2.5 border-b shrink-0" style={{ borderColor: '#222' }}>
              <div className="flex items-center gap-1.5">
                <Settings2 size={11} style={{ color: '#555' }} />
                <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#555' }}>Paramètres</span>
              </div>
              <button onClick={() => setShowSettings(false)} className="hover:brightness-150" style={{ color: '#555' }}>
                <XCircle size={12} />
              </button>
            </div>
            <SettingsPanelContent
              settingStyle={settingStyle} setSettingStyle={setSettingStyle}
              settingDuration={settingDuration} setSettingDuration={setSettingDuration}
              settingRatio={settingRatio} setSettingRatio={setSettingRatio}
              savingSettings={savingSettings} handleSaveSettings={handleSaveSettings}
              socialAccounts={socialAccounts}
            />
          </div>
        )}
      </div>
    </div>

    {/* ── Settings panel: mobile bottom sheet — Portal into document.body bypasses all CSS containment ── */}
    {showSettings && isMobile && createPortal(
      <>
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 40, background: 'rgba(0,0,0,0.65)' }}
          onClick={() => setShowSettings(false)}
        />
        <div style={{
          position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 50,
          background: '#161616', border: '1px solid #2e2e2e',
          maxHeight: '85vh', boxShadow: '0 -8px 32px rgba(0,0,0,0.85)',
          overflow: 'hidden', borderRadius: '16px 16px 0 0',
          display: 'flex', flexDirection: 'column',
        }}>
          <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 8, paddingBottom: 4, cursor: 'pointer', flexShrink: 0 }}
            onClick={() => setShowSettings(false)}>
            <div style={{ width: 36, height: 4, borderRadius: 2, background: '#444' }} />
          </div>
          <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px 12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Settings2 size={12} style={{ color: '#888' }} />
              <span style={{ fontSize: 14, fontWeight: 600, color: '#ccc' }}>Paramètres</span>
            </div>
            <button onClick={() => setShowSettings(false)} style={{ color: '#666', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
              <XCircle size={18} />
            </button>
          </div>
          <SettingsPanelContent
            settingStyle={settingStyle} setSettingStyle={setSettingStyle}
            settingDuration={settingDuration} setSettingDuration={setSettingDuration}
            settingRatio={settingRatio} setSettingRatio={setSettingRatio}
            savingSettings={savingSettings} handleSaveSettings={handleSaveSettings}
            socialAccounts={socialAccounts}
          />
        </div>
      </>,
      document.body
    )}

    {/* ── Floating panels ────────────────────────────────────────────── */}
    {showEffectsModal && (
      <DraggableModal title="Effets & Transitions" icon={<Sparkles size={12} />}
        onClose={() => setShowEffectsModal(false)} defaultPos={{ x: 280, y: 72 }} defaultSize={{ w: 340, h: 560 }}>
        <div className="flex flex-col gap-4">
          {/* Style presets */}
          <div>
            <div className="text-[9px] uppercase tracking-wider mb-2" style={{ color: '#555' }}>Style visuel</div>
            <div className="flex flex-col gap-1">
              {STYLES_LIST.map(k => (
                <button key={k} onClick={() => handleSelectStyle(k)}
                  className="flex items-start gap-2 px-2.5 py-2 rounded text-left w-full"
                  style={{ background: settingStyle === k ? S.accent + '15' : '#111', border: `1px solid ${settingStyle === k ? S.accent + '50' : '#222'}` }}>
                  <span className="text-sm shrink-0">{STYLE_LABELS[k].split(' ')[0]}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] font-semibold" style={{ color: settingStyle === k ? S.accent : '#ccc' }}>
                      {STYLE_LABELS[k].slice(STYLE_LABELS[k].indexOf(' ') + 1)}
                    </div>
                    <div className="text-[9px]" style={{ color: '#444' }}>{STYLE_DESCRIPTIONS[k]}</div>
                  </div>
                  {settingStyle === k && <CheckCircle2 size={10} className="shrink-0 mt-0.5" style={{ color: S.accent }} />}
                </button>
              ))}
            </div>
          </div>
          {/* Transitions */}
          <div>
            <div className="text-[9px] uppercase tracking-wider mb-2" style={{ color: '#555' }}>Transitions</div>
            <div className="grid gap-1" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
              {TRANSITIONS.map(t => (
                <button key={t.id} onClick={() => setSelectedTransition(t.id)}
                  className="flex flex-col items-center gap-0.5 py-2 rounded text-center"
                  style={{ background: selectedTransition === t.id ? S.accent + '15' : '#111', border: `1px solid ${selectedTransition === t.id ? S.accent + '50' : '#222'}` }}>
                  <span className="text-[10px] font-semibold" style={{ color: selectedTransition === t.id ? S.accent : '#aaa' }}>{t.label}</span>
                  <span className="text-[8px]" style={{ color: '#444' }}>{t.desc}</span>
                </button>
              ))}
            </div>
          </div>
          {/* Duration */}
          <div>
            <div className="text-[9px] uppercase tracking-wider mb-1.5" style={{ color: '#555' }}>Durée</div>
            <div className="flex gap-1 flex-wrap">
              {DURATIONS_LIST.map(k => (
                <button key={k} onClick={() => setSettingDuration(k)}
                  className="py-1 px-1.5 rounded text-[9px] font-semibold"
                  style={{ background: settingDuration === k ? S.accent + '20' : '#111', border: `1px solid ${settingDuration === k ? S.accent + '60' : '#222'}`, color: settingDuration === k ? S.accent : '#555' }}>
                  {DURATION_LABELS[k]}
                </button>
              ))}
            </div>
          </div>
          {/* Format */}
          <div>
            <div className="text-[9px] uppercase tracking-wider mb-1.5" style={{ color: '#555' }}>Format</div>
            <div className="flex gap-1">
              {RATIOS_LIST.map(k => (
                <button key={k} onClick={() => setSettingRatio(k)}
                  className="flex-1 py-2 rounded text-[9px] font-semibold"
                  style={{ background: settingRatio === k ? S.accent + '20' : '#111', border: `1px solid ${settingRatio === k ? S.accent + '60' : '#222'}`, color: settingRatio === k ? S.accent : '#555' }}>
                  {RATIO_LABELS[k]}
                </button>
              ))}
            </div>
          </div>
          <button onClick={handleSaveSettings} disabled={savingSettings}
            className="flex items-center justify-center gap-1.5 w-full py-1.5 rounded text-xs font-semibold disabled:opacity-40"
            style={{ background: S.accent, color: '#000' }}>
            {savingSettings ? <Loader2 size={11} className="animate-spin" /> : null} Appliquer
          </button>
        </div>
      </DraggableModal>
    )}

    {showLyricsModal && (
      <DraggableModal title="Paroles & Transcription" icon={<Type size={12} />}
        onClose={() => {
          setShowLyricsModal(false)
          // Persist lyric edits + style silently so manual changes survive reload
          // (no re-render/burn here — that stays on "Appliquer & sauvegarder").
          if (workspace && transcriptSegments && transcriptSegments.length > 0) {
            const style = {
              color: subtitleColor, bgColor: subtitleBgColor, bgOpacity: subtitleBgOpacity,
              position: subtitlePos, customX: subtitleCustomX, customY: subtitleCustomY,
              fontSize: subtitleFontSize, effect: subtitleEffect, effectColor: subtitleEffectColor,
            }
            montageApi.saveSubtitles(workspace.id, project.id, transcriptSegments, style).catch(() => {})
          }
        }} defaultPos={{ x: 640, y: 72 }} defaultSize={{ w: 420, h: 660 }}>
        {/* ── Tab bar ── */}
        <div className="-mx-3 -mt-3 flex sticky top-0 z-10 border-b mb-3 shrink-0" style={{ background: '#141414', borderColor: '#222' }}>
          {(['segments', 'style'] as const).map(t => (
            <button key={t} onClick={() => setLyricsTab(t)}
              className="flex-1 py-2.5 text-[10px] font-semibold uppercase tracking-wider"
              style={{ color: lyricsTab === t ? S.accent : '#444', borderBottom: lyricsTab === t ? `2px solid ${S.accent}` : '2px solid transparent', background: 'none', cursor: 'pointer' }}>
              {t === 'segments' ? '🎵 Paroles' : '🎨 Style'}
            </button>
          ))}
        </div>

        {/* ══ PAROLES TAB ══ */}
        {lyricsTab === 'segments' && (
        <div className="flex flex-col gap-3">
          {/* Transcription (Whisper) */}
          <div className="rounded p-3" style={{ background: '#111', border: '1px solid #222' }}>
            <div className="flex items-center gap-1.5 mb-2">
              <Mic size={11} style={{ color: S.accent }} />
              <span className="text-[10px] font-semibold" style={{ color: '#ccc' }}>Transcription (Whisper)</span>
            </div>

            {/* Language + model selectors */}
            <div className="grid gap-1.5 mb-2" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <div>
                <div className="text-[8px] uppercase tracking-wider mb-1" style={{ color: '#555' }}>Langue</div>
                <select value={transcriptLang} onChange={e => setTranscriptLang(e.target.value)}
                  className="w-full px-1.5 py-1 rounded text-[9px] outline-none"
                  style={{ background: '#0a0a0a', border: '1px solid #2e2e2e', color: '#ccc' }}>
                  <option value="">Auto-détect</option>
                  <option value="fr">Français</option>
                  <option value="en">English</option>
                  <option value="es">Español</option>
                  <option value="de">Deutsch</option>
                  <option value="pt">Português</option>
                  <option value="it">Italiano</option>
                  <option value="ja">日本語</option>
                  <option value="ko">한국어</option>
                  <option value="zh">中文</option>
                  <option value="ar">العربية</option>
                </select>
              </div>
              <div>
                <div className="text-[8px] uppercase tracking-wider mb-1" style={{ color: '#555' }}>Modèle</div>
                <select value={transcriptModel} onChange={e => setTranscriptModel(e.target.value)}
                  className="w-full px-1.5 py-1 rounded text-[9px] outline-none"
                  style={{ background: '#0a0a0a', border: '1px solid #2e2e2e', color: '#ccc' }}>
                  <option value="tiny">Tiny (rapide)</option>
                  <option value="base">Base</option>
                  <option value="small">Small ✓</option>
                  <option value="medium">Medium</option>
                  <option value="large-v3-turbo">Large Turbo (recommandé)</option>
                  <option value="large-v3">Large v3 (max précision)</option>
                </select>
              </div>
            </div>
            <button onClick={handleTranscribe} disabled={!project.audioPath || transcribing}
              className="flex items-center gap-1.5 px-2 py-1.5 rounded text-[10px] font-semibold disabled:opacity-40 w-full justify-center"
              style={{ background: S.accent + '15', border: `1px solid ${S.accent}40`, color: S.accent }}>
              {transcribing ? <Loader2 size={10} className="animate-spin" /> : <Mic size={10} />}
              {transcribing ? 'Transcription…' : transcriptSegments ? 'Relancer Whisper' : 'Transcrire l\'audio'}
            </button>
          </div>

          {/* ── Segments editor ── */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <div className="text-[9px] uppercase tracking-wider" style={{ color: '#555' }}>
                Segments {transcriptSegments ? `(${transcriptSegments.length})` : ''}
              </div>
              <div className="flex gap-1">
                {transcriptSegments && transcriptSegments.length > 0 && (
                  <button
                    onClick={() => setTranscriptSegments(null)}
                    className="text-[8px] px-1.5 py-0.5 rounded"
                    style={{ color: '#555', border: '1px solid #2a2a2a', background: 'none', cursor: 'pointer' }}>
                    Effacer
                  </button>
                )}
                <button
                  onClick={() => {
                    const lastEnd = transcriptSegments?.at(-1)?.end ?? 0
                    setTranscriptSegments(prev => [...(prev ?? []), { start: lastEnd, end: +(lastEnd + 3).toFixed(2), text: '' }])
                  }}
                  className="text-[8px] px-1.5 py-0.5 rounded flex items-center gap-0.5"
                  style={{ color: S.accent, border: `1px solid ${S.accent}40`, background: S.accent + '10', cursor: 'pointer' }}>
                  <Plus size={8} /> Ajouter
                </button>
              </div>
            </div>

            {transcriptSegments && transcriptSegments.length > 0 ? (
              <div className="flex flex-col gap-0.5 overflow-y-auto" style={{ maxHeight: 220 }}>
                {transcriptSegments.map((seg, i) => {
                  const fmtT = (s: number) => { const m = Math.floor(s / 60); return `${m}:${(s % 60).toFixed(1).padStart(4, '0')}` }
                  const parseT = (str: string) => { const p = str.split(':'); return Math.max(0, p.length === 2 ? parseFloat(p[0]) * 60 + parseFloat(p[1]) : parseFloat(str) || 0) }
                  const hue = (i * 53 + 200) % 360
                  return (
                    <div key={i} className="flex items-center gap-1 px-2 py-1.5 rounded group"
                      style={{ background: `hsla(${hue},28%,11%,0.9)`, border: `1px solid hsla(${hue},38%,22%,0.8)` }}>
                      <input
                        key={`s-${i}-${seg.start.toFixed(1)}`}
                        className="rounded text-[9px] font-mono outline-none text-center"
                        style={{ width: 46, background: '#0a0a0a', border: '1px solid #2a2a2a', color: '#888', padding: '2px 3px' }}
                        defaultValue={fmtT(seg.start)}
                        onBlur={e => { const t = parseT(e.target.value); const u = [...transcriptSegments]; u[i] = { ...seg, start: t }; setTranscriptSegments(u); e.target.value = fmtT(t) }}
                        onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                      />
                      <span style={{ color: '#333', fontSize: 9, flexShrink: 0 }}>→</span>
                      <input
                        key={`e-${i}-${seg.end.toFixed(1)}`}
                        className="rounded text-[9px] font-mono outline-none text-center"
                        style={{ width: 46, background: '#0a0a0a', border: '1px solid #2a2a2a', color: '#888', padding: '2px 3px' }}
                        defaultValue={fmtT(seg.end)}
                        onBlur={e => { const t = parseT(e.target.value); const u = [...transcriptSegments]; u[i] = { ...seg, end: t }; setTranscriptSegments(u); e.target.value = fmtT(t) }}
                        onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                      />
                      <input
                        className="flex-1 rounded text-[9px] outline-none min-w-0"
                        style={{ background: '#0f0f0f', border: '1px solid #2a2a2a', color: '#ccc', padding: '2px 5px' }}
                        value={seg.text}
                        onChange={e => { const u = [...transcriptSegments]; u[i] = { ...seg, text: e.target.value }; setTranscriptSegments(u) }}
                        placeholder="Paroles…"
                      />
                      <button
                        onClick={() => setTranscriptSegments(prev => prev ? prev.filter((_, idx) => idx !== i) : prev)}
                        className="opacity-0 group-hover:opacity-100 shrink-0 p-0.5 rounded"
                        style={{ color: '#555', background: 'none', border: 'none', cursor: 'pointer' }}
                        onMouseEnter={e => (e.currentTarget.style.color = S.red)}
                        onMouseLeave={e => (e.currentTarget.style.color = '#555')}>
                        <Trash2 size={10} />
                      </button>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="flex items-center justify-center py-6 rounded text-[10px]"
                style={{ background: '#0d0d0d', border: '1px dashed #222', color: '#444' }}>
                Aucun segment — cliquez "Ajouter" ou transcrivez l'audio
              </div>
            )}
          </div>

          {/* ── Paste / import lyrics ── */}
          <div className="rounded p-3" style={{ background: '#111', border: '1px solid #222' }}>
            <div className="text-[9px] uppercase tracking-wider mb-1.5" style={{ color: '#555' }}>Coller des paroles</div>
            <textarea
              value={pasteText}
              onChange={e => setPasteText(e.target.value)}
              rows={4}
              placeholder="Collez vos paroles ici (une ligne = un segment)…"
              className="w-full px-2 py-1.5 rounded text-[9px] outline-none resize-none"
              style={{ background: '#0a0a0a', border: '1px solid #2a2a2a', color: '#ccc', fontFamily: 'monospace' }}
            />
            <button
              disabled={!pasteText.trim()}
              onClick={() => {
                const lines = pasteText.trim().split('\n').map(l => l.trim()).filter(Boolean)
                if (lines.length === 0) return
                // Start after the last existing segment so appended lyrics don't
                // overlap earlier ones; spread over the remaining audio time.
                const startAt = transcriptSegments?.length ? transcriptSegments[transcriptSegments.length - 1].end : 0
                const total = project.audioDuration ?? (startAt + lines.length * 3)
                const segDur = Math.max(0.6, (total - startAt) / lines.length)
                const segs = lines.map((text, i) => ({
                  start: +(startAt + i * segDur).toFixed(2),
                  end:   +(startAt + (i + 1) * segDur).toFixed(2),
                  text,
                }))
                setTranscriptSegments(prev => prev ? [...prev, ...segs] : segs)
                setPasteText('')
              }}
              className="flex items-center gap-1.5 mt-1.5 px-2 py-1.5 rounded text-[9px] font-semibold w-full justify-center disabled:opacity-40"
              style={{ background: '#6a5acd22', border: '1px solid #6a5acd50', color: '#9b7ef8', cursor: 'pointer' }}>
              <Type size={10} /> Importer & diviser
            </button>
          </div>

          {/* ── Apply & save ── */}
          {transcriptSegments && transcriptSegments.length > 0 && workspace && (
            <button
              onClick={async () => {
                try {
                  const style = {
                    color: subtitleColor, bgColor: subtitleBgColor, bgOpacity: subtitleBgOpacity,
                    position: subtitlePos, customX: subtitleCustomX, customY: subtitleCustomY,
                    fontSize: subtitleFontSize, effect: subtitleEffect, effectColor: subtitleEffectColor,
                  }
                  await montageApi.saveSubtitles(workspace.id, project.id, transcriptSegments, style)
                  setShowLyricsModal(false)
                  if (project.status === 'COMPLETED') {
                    await montageApi.burnSubtitles(workspace.id, project.id)
                    setGenerating(true)
                    startPolling(workspace.id, project.id)
                  }
                } catch (e: unknown) { alert((e as Error).message) }
              }}
              className="flex items-center gap-1.5 px-2 py-2 rounded text-[10px] font-semibold w-full justify-center"
              style={{ background: S.accent, color: '#000', cursor: 'pointer' }}>
              <Type size={10} /> Appliquer &amp; sauvegarder
            </button>
          )}
        </div>
        )}

        {/* ══ STYLE TAB ══ */}
        {lyricsTab === 'style' && (
        <div className="flex flex-col gap-4">
          {/* Police */}
          <div>
            <div className="text-[9px] uppercase tracking-wider mb-1.5" style={{ color: '#555' }}>Police</div>
            <div className="grid gap-1" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
              {SUBTITLE_FONTS.map(f => (
                <button key={f.id} onClick={() => setSubtitleFont(f.id)}
                  className="py-1.5 rounded text-[10px] truncate"
                  style={{ fontFamily: f.css, background: subtitleFont === f.id ? S.accent + '15' : '#111', border: `1px solid ${subtitleFont === f.id ? S.accent + '60' : '#222'}`, color: subtitleFont === f.id ? S.accent : '#999', fontWeight: 700 }}>
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {/* Effet d'entrée — with live Aa preview on hover */}
          <div>
            <div className="text-[9px] uppercase tracking-wider mb-1.5" style={{ color: '#555' }}>Effet d&apos;entrée</div>
            <div className="grid gap-1" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
              {SUBTITLE_EFFECTS.map(e => {
                const isSel = subtitleEffect === e.id
                const ANIM_CSS: Record<string, string> = {
                  FADE: 'subFadeIn 0.25s ease forwards',
                  SLIDE_UP: 'subSlideUp 0.28s ease forwards',
                  SLIDE_DOWN: 'subSlideDown 0.28s ease forwards',
                  POP: 'subPop 0.32s cubic-bezier(.36,.07,.19,.97) forwards',
                  BOUNCE: 'subBounce 0.45s ease forwards',
                  NEON: 'subNeon 1.2s ease infinite',
                }
                const STATIC_STYLE: Record<string, CSSProperties> = {
                  GLOW: { textShadow: `0 0 8px ${subtitleEffectColor}, 0 0 22px ${subtitleEffectColor}cc` },
                  NEON: { textShadow: `0 0 4px #fff, 0 0 11px #fff, 0 0 22px ${subtitleEffectColor}` },
                  OUTLINE: { WebkitTextStroke: `1.5px ${isSel ? S.accent : '#888'}`, color: 'transparent' },
                  SHADOW: { textShadow: `2px 2px 0 ${subtitleEffectColor}f0` },
                  KARAOKE: { background: `linear-gradient(to right, ${isSel ? S.accent : '#888'} 50%, #444 50%)`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' },
                  TYPEWRITER: { borderRight: `1.5px solid ${isSel ? S.accent : '#888'}` },
                }
                return (
                  <button key={e.id}
                    onClick={() => setSubtitleEffect(e.id)}
                    onMouseEnter={() => setEffectAnimKeys(prev => ({ ...prev, [e.id]: (prev[e.id] ?? 0) + 1 }))}
                    className="rounded flex flex-col items-center gap-0.5 pt-2 pb-1.5 px-1"
                    style={{ background: isSel ? S.accent + '15' : '#111', border: `1px solid ${isSel ? S.accent + '50' : '#222'}`, cursor: 'pointer' }}>
                    {/* Live Aa preview — key changes on hover to restart animation */}
                    <span
                      key={effectAnimKeys[e.id] ?? 0}
                      style={{
                        fontSize: '0.78rem', fontWeight: 800, lineHeight: 1.1, display: 'inline-block',
                        color: isSel ? S.accent : '#888',
                        animation: ANIM_CSS[e.id] ?? undefined,
                        ...(STATIC_STYLE[e.id] ?? {}),
                      }}>
                      Aa
                    </span>
                    <span className="text-[8px] font-semibold" style={{ color: isSel ? S.accent : '#555' }}>{e.label}</span>
                  </button>
                )
              })}
            </div>
            {/* Effect accent color */}
            {['GLOW', 'NEON', 'OUTLINE', 'SHADOW'].includes(subtitleEffect) && (
              <div className="mt-2 pt-2" style={{ borderTop: '1px solid #222' }}>
                <div className="text-[9px] uppercase tracking-wider mb-1.5" style={{ color: '#555' }}>
                  {subtitleEffect === 'SHADOW' ? 'Couleur de l\'ombre' : subtitleEffect === 'OUTLINE' ? 'Couleur du contour' : 'Couleur du halo'}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <input type="color" value={subtitleEffectColor} onChange={e => setSubtitleEffectColor(e.target.value)}
                    className="rounded cursor-pointer" style={{ width: 26, height: 26, border: '1px solid #333', background: 'none' }} />
                  <span className="text-[10px] font-mono" style={{ color: '#666' }}>{subtitleEffectColor}</span>
                  {subtitleEffect === 'SHADOW'
                    ? ['#000000', '#1a0030', '#001a30', '#300000', '#0a0a0a'].map(c => (
                        <button key={c} onClick={() => setSubtitleEffectColor(c)} className="rounded-full"
                          style={{ width: 14, height: 14, background: c, border: subtitleEffectColor === c ? `2px solid ${S.accent}` : '2px solid #444', flexShrink: 0, cursor: 'pointer' }} />
                      ))
                    : ['#f0a830', '#ff4444', '#44aaff', '#44ff88', '#ff44ff', '#ffffff', '#00ffff'].map(c => (
                        <button key={c} onClick={() => setSubtitleEffectColor(c)} className="rounded-full"
                          style={{ width: 14, height: 14, background: c, border: subtitleEffectColor === c ? `2px solid ${S.accent}` : '2px solid transparent', flexShrink: 0, cursor: 'pointer' }} />
                      ))
                  }
                </div>
              </div>
            )}
          </div>

          {/* Position */}
          <div>
            <div className="text-[9px] uppercase tracking-wider mb-1.5" style={{ color: '#555' }}>Position</div>
            <div className="flex gap-1 mb-1.5">
              {(['TOP', 'CENTER', 'BOTTOM'] as const).map(pos => (
                <button key={pos} onClick={() => setSubtitlePos(pos)}
                  className="flex-1 py-1.5 rounded text-[9px] font-semibold"
                  style={{ background: subtitlePos === pos ? S.accent + '15' : '#111', border: `1px solid ${subtitlePos === pos ? S.accent + '50' : '#222'}`, color: subtitlePos === pos ? S.accent : '#555', cursor: 'pointer' }}>
                  {pos === 'TOP' ? '▲ Haut' : pos === 'CENTER' ? '● Centre' : '▼ Bas'}
                </button>
              ))}
            </div>
            <p className="text-[8px] leading-relaxed" style={{ color: '#444' }}>
              💡 Glisse les sous-titres sur la vidéo pour les repositionner librement.
              {subtitlePos === 'CUSTOM' && <span style={{ color: S.accent }}> ({Math.round(subtitleCustomX)}%, {Math.round(subtitleCustomY)}%)</span>}
            </p>
          </div>

          {/* Taille */}
          <div>
            <div className="text-[9px] uppercase tracking-wider mb-1.5" style={{ color: '#555' }}>Taille</div>
            <div className="flex items-center gap-2">
              <span className="text-[9px] shrink-0" style={{ color: '#444' }}>A</span>
              <input type="range" min={40} max={220} step={2} value={subtitleFontSize}
                onChange={e => setSubtitleFontSize(Number(e.target.value))}
                className="flex-1 cursor-pointer" style={{ accentColor: S.accent, height: 2 }} />
              <span className="text-[9px] shrink-0" style={{ color: '#aaa', fontSize: '1.1em', fontWeight: 700 }}>A</span>
              <span className="text-[9px] font-mono w-8 text-right" style={{ color: '#666' }}>{subtitleFontSize}%</span>
              <button onClick={() => setSubtitleFontSize(100)} className="text-[8px] px-1 rounded" style={{ color: '#555', border: '1px solid #2a2a2a', background: 'none', cursor: 'pointer' }}>reset</button>
            </div>
          </div>

          {/* Couleur du texte */}
          <div>
            <div className="text-[9px] uppercase tracking-wider mb-1.5" style={{ color: '#555' }}>Couleur du texte</div>
            <div className="flex items-center gap-2 flex-wrap">
              <input type="color" value={subtitleColor} onChange={e => setSubtitleColor(e.target.value)}
                className="rounded cursor-pointer" style={{ width: 26, height: 26, border: '1px solid #333', background: 'none' }} />
              <span className="text-[10px] font-mono" style={{ color: '#666' }}>{subtitleColor}</span>
              {['#FFFFFF', '#FFE500', '#FF4444', '#44FF88', '#44AAFF', '#FF69B4', '#FF8C00'].map(c => (
                <button key={c} onClick={() => setSubtitleColor(c)} className="rounded-full"
                  style={{ width: 14, height: 14, background: c, border: subtitleColor === c ? `2px solid ${S.accent}` : '2px solid transparent', flexShrink: 0, cursor: 'pointer' }} />
              ))}
            </div>
          </div>

          {/* Fond */}
          <div>
            <div className="text-[9px] uppercase tracking-wider mb-1.5" style={{ color: '#555' }}>Fond</div>
            <button
              onClick={() => setSubtitleBgOpacity(0)}
              className="mb-1.5 px-2 py-1 rounded text-[9px] font-semibold w-full"
              style={{
                background: subtitleBgOpacity === 0 ? '#f0a83015' : '#111',
                border: `1px solid ${subtitleBgOpacity === 0 ? '#f0a83060' : '#2a2a2a'}`,
                color: subtitleBgOpacity === 0 ? S.accent : '#555',
                backgroundImage: subtitleBgOpacity === 0 ? 'none' : 'repeating-conic-gradient(#2a2a2a 0% 25%, transparent 0% 50%)',
                backgroundSize: '10px 10px', cursor: 'pointer',
              }}>
              ⊘ Transparent (sans fond)
            </button>
            <div className="flex items-center gap-2 flex-wrap mb-1.5">
              <input type="color" value={subtitleBgColor} onChange={e => { setSubtitleBgColor(e.target.value); if (subtitleBgOpacity === 0) setSubtitleBgOpacity(42) }}
                className="rounded cursor-pointer" style={{ width: 26, height: 26, border: '1px solid #333', background: 'none' }} />
              <span className="text-[10px] font-mono" style={{ color: '#666' }}>{subtitleBgColor}</span>
              {['#000000', '#FFFFFF', '#1a1a1a', '#0d0d44', '#440000'].map(c => (
                <button key={c} onClick={() => { setSubtitleBgColor(c); if (subtitleBgOpacity === 0) setSubtitleBgOpacity(42) }} className="rounded-full"
                  style={{ width: 14, height: 14, background: c, border: subtitleBgColor === c && subtitleBgOpacity > 0 ? `2px solid ${S.accent}` : '2px solid #333', flexShrink: 0, cursor: 'pointer' }} />
              ))}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[9px] shrink-0" style={{ color: '#555' }}>Opacité</span>
              <input type="range" min={0} max={100} value={subtitleBgOpacity} onChange={e => setSubtitleBgOpacity(Number(e.target.value))}
                className="flex-1 cursor-pointer" style={{ accentColor: S.accent, height: 2 }} />
              <span className="text-[9px] font-mono w-7 text-right" style={{ color: '#666' }}>{subtitleBgOpacity}%</span>
            </div>
          </div>
        </div>
        )}
      </DraggableModal>
    )}

    {showLibraryModal && (
      <DraggableModal title="Bibliothèque de clips" icon={<Layers size={12} />}
        onClose={() => setShowLibraryModal(false)} defaultPos={{ x: 160, y: 80 }} defaultSize={{ w: 340, h: 500 }}>
        <div className="flex flex-col gap-3">
          {loadingFrames ? (
            <div className="flex items-center justify-center py-10 gap-2" style={{ color: '#555' }}>
              <Loader2 size={16} className="animate-spin" style={{ color: S.accent }} />
              <span className="text-[10px]">Analyse des scènes…</span>
            </div>
          ) : sceneFrames.length === 0 ? (
            <div className="flex flex-col items-center py-10 gap-2" style={{ color: '#555' }}>
              <Film size={22} style={{ opacity: 0.3 }} />
              <p className="text-[10px] text-center">Ajoutez des vidéos source pour voir les frames découpées.</p>
              <button onClick={() => { setShowLibraryModal(false); setTab('videos') }}
                className="text-[9px] px-2 py-1 rounded mt-1"
                style={{ background: S.accent + '20', border: `1px solid ${S.accent}40`, color: S.accent }}>
                Ajouter des vidéos
              </button>
            </div>
          ) : (
            <div className="grid gap-1.5" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
              {sceneFrames.map(frame => (
                <button key={frame.id}
                  onClick={() => handleAddFrameAsClip(frame)}
                  className="rounded overflow-hidden relative group cursor-pointer text-left"
                  style={{ background: '#111', border: '1px solid #222', aspectRatio: '16/9', display: 'block', padding: 0, WebkitTapHighlightColor: 'transparent' }}>
                  <img src={frame.url} alt={`frame ${frame.time.toFixed(1)}s`}
                    className="w-full h-full object-cover" style={{ display: 'block' }} />
                  <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ background: 'rgba(0,0,0,0.5)' }}>
                    <span className="text-[9px] font-semibold px-2 py-0.5 rounded" style={{ background: S.accent, color: '#000' }}>+ Ajouter</span>
                  </div>
                  <div className="absolute bottom-0 left-0 right-0 px-1 py-0.5"
                    style={{ background: 'rgba(0,0,0,0.6)' }}>
                    <span className="text-[7px] font-mono" style={{ color: '#aaa' }}>{frame.time.toFixed(1)}s</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </DraggableModal>
    )}

    {showPublish && workspace && (
      <PublishModal
        project={project}
        workspace={workspace}
        accounts={socialAccounts}
        onClose={() => setShowPublish(false)}
      />
    )}
    </>
  )
}
