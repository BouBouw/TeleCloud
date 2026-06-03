import React from 'react'
import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Clapperboard, Trash2, Loader2, ChevronRight, X, Film } from 'lucide-react'
import { wsApi, montageApi } from '../lib/api'
import type { Workspace, MontageProject, MontageStyle, MontageDuration, MontageRatio } from '../lib/api'
import { useI18n } from '../i18n'

const S = {
  bg: '#111', panel: '#1a1a1a', panelAlt: '#161616', hover: '#1e1e1e',
  border: '#2a2a2a', borderHi: '#3a3a3a', accent: '#f0a830',
  text: '#ccc', textDim: '#888', textMute: '#555', textFade: '#333',
  input: '#0a0a0a', red: '#e74c3c', green: '#4ade80', yellow: '#facc15', cyan: '#67e8f9',
}

const STYLES: { key: MontageStyle; emoji: string; label: string; desc: string }[] = [
  { key: 'DARK_TRAP',     emoji: '🖤', label: 'Dark Trap',     desc: 'Cuts durs, flash sur les drops' },
  { key: 'CLEAN_MINIMAL', emoji: '⬜', label: 'Clean Minimal', desc: 'Transitions douces, épuré' },
  { key: 'HYPER_POP',     emoji: '🌈', label: 'Hyper Pop',     desc: 'Couleurs saturées, frénétique' },
  { key: 'FAST_CUTS',     emoji: '⚡', label: 'Fast Cuts',     desc: 'Montage ultra-rapide au beat' },
  { key: 'SLOW_MOTION',   emoji: '🎬', label: 'Slow Motion',   desc: 'Ralentis sur les breaks' },
  { key: 'CINEMATIC',     emoji: '🎥', label: 'Cinematic',     desc: 'Format letterbox, grading ciné' },
  { key: 'AMBIENT',       emoji: '🌅', label: 'Ambient',       desc: 'Coupes longues, contemplatif' },
  { key: 'LYRIC_VIDEO',   emoji: '🎵', label: 'Lyric Video',   desc: 'Transitions lyriques' },
  { key: 'EQ_VISUALIZER', emoji: '🌀', label: 'EQ Visualizer', desc: 'Réactif à l\'énergie sonore' },
]
const DURATIONS: { key: MontageDuration; label: string }[] = [
  { key: 'AUTO', label: 'Auto' }, { key: 'SECONDS_15', label: '15s' },
  { key: 'SECONDS_30', label: '30s' }, { key: 'SECONDS_60', label: '60s' }, { key: 'FULL_SONG', label: 'Full' },
]
const RATIOS: { key: MontageRatio; symbol: string; label: string }[] = [
  { key: 'LANDSCAPE', symbol: '▬', label: '16:9' },
  { key: 'PORTRAIT',  symbol: '▮', label: '9:16' },
  { key: 'SQUARE',    symbol: '■', label: '1:1'  },
]

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

export default function Montage() {
  const { t } = useI18n()
  const navigate = useNavigate()

  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [projects, setProjects]   = useState<MontageProject[]>([])
  const [loading, setLoading]     = useState(true)
  const [showForm, setShowForm]   = useState(false)
  const [title,    setTitle]      = useState('')
  const [style,    setStyle]      = useState<MontageStyle>('DARK_TRAP')
  const [duration, setDuration]   = useState<MontageDuration>('AUTO')
  const [ratio,    setRatio]      = useState<MontageRatio>('LANDSCAPE')
  const [creating, setCreating]   = useState(false)
  const [deleting, setDeleting]   = useState<string | null>(null)

  useEffect(() => {
    wsApi.list().then(({ workspaces }) => {
      const ws = workspaces[0]; if (!ws) { setLoading(false); return }
      setWorkspace(ws)
      montageApi.list(ws.id).then(({ projects: p }) => setProjects(p)).catch(() => {}).finally(() => setLoading(false))
    }).catch(() => setLoading(false))
  }, [])

  const handleCreate = useCallback(async () => {
    if (!workspace || !title.trim()) return
    setCreating(true)
    try {
      const { project } = await montageApi.create(workspace.id, { title: title.trim(), style, durationMode: duration, ratio })
      navigate(`/montage/${project.id}`)
    } catch (e: unknown) { alert((e as Error).message) }
    finally { setCreating(false) }
  }, [workspace, title, style, duration, ratio, navigate])

  const handleDelete = useCallback(async (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    if (!workspace || !window.confirm('Supprimer ce projet ?')) return
    setDeleting(id)
    try {
      await montageApi.delete(workspace.id, id)
      setProjects(prev => prev.filter(p => p.id !== id))
    } catch (e: unknown) { alert((e as Error).message) }
    finally { setDeleting(null) }
  }, [workspace])

  return (
    <div className="flex flex-col h-full fade-in" style={{ background: S.bg, color: S.text }}>

      {/* ── Top bar ── */}
      <div className="flex items-center gap-1 px-4 border-b shrink-0" style={{ borderColor: S.border, height: 36 }}>
        <div className="flex items-center gap-2">
          <Clapperboard size={13} style={{ color: S.accent }} />
          <span className="text-xs font-semibold" style={{ color: S.text }}>{t('nav_montage')}</span>
        </div>
        {workspace && (
          <span className="ml-auto text-[10px]" style={{ color: S.textMute }}>
            {workspace.name} · <span style={{ color: S.textDim }}>{projects.length}</span>
          </span>
        )}
      </div>

      {/* ── Toolbar ── */}
      <div className="flex items-center gap-2 flex-wrap px-3 sm:px-5 py-2 sm:py-3 border-b shrink-0" style={{ borderColor: S.border, background: S.panelAlt }}>
        <p className="text-xs flex-1" style={{ color: S.textMute }}>Créez des montages vidéo automatiques synchronisés au beat</p>
        <button
          onClick={() => { setShowForm(true); setTitle(''); setStyle('DARK_TRAP'); setDuration('AUTO'); setRatio('LANDSCAPE') }}
          className="flex items-center gap-2 px-4 py-2 rounded-md text-sm font-semibold"
          style={{ background: S.accent, color: '#000' }}
        >
          <Plus size={13} /> Nouveau montage
        </button>
      </div>

      {/* ── Body ── */}
      <div className="flex flex-1 min-h-0">

        {/* ── Project list ── */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-20" style={{ color: S.textMute }}>
              <Loader2 size={16} className="animate-spin" style={{ color: S.accent }} />
              <span className="text-xs">Chargement…</span>
            </div>
          ) : projects.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <div className="rounded flex items-center justify-center"
                style={{ width: 56, height: 56, background: S.panel, border: `1px solid ${S.border}` }}>
                <Film size={24} style={{ color: S.textFade }} />
              </div>
              <p className="text-xs" style={{ color: S.textMute }}>Aucun projet de montage</p>
              <p className="text-[10px]" style={{ color: S.textFade }}>Créez votre premier projet pour commencer</p>
              <button
                onClick={() => setShowForm(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold mt-1"
                style={{ background: S.accent, color: '#000' }}
              >
                <Plus size={11} /> Nouveau montage
              </button>
            </div>
          ) : (
            projects.map((p, i) => {
              const styleInfo = STYLES.find(s => s.key === p.style)
              const isDel = deleting === p.id
              return (
                <div
                  key={p.id}
                  className="flex items-center gap-3 px-5 group transition-colors cursor-pointer"
                  style={{ height: 58, borderBottom: `1px solid ${S.border}` }}
                  onClick={() => navigate(`/montage/${p.id}`)}
                  onMouseEnter={e => (e.currentTarget.style.background = S.hover)}
                  onMouseLeave={e => (e.currentTarget.style.background = '')}
                >
                  {/* Index / emoji */}
                  <div className="w-5 shrink-0 flex items-center justify-center">
                    <span className="text-[10px] font-mono group-hover:hidden" style={{ color: S.textFade }}>{i + 1}</span>
                    <span className="hidden group-hover:block text-base leading-none">{styleInfo?.emoji ?? '🎬'}</span>
                  </div>

                  {/* Icon box */}
                  <div className="shrink-0 rounded flex items-center justify-center"
                    style={{ width: 40, height: 40, background: S.input, border: `1px solid ${S.border}` }}>
                    <Clapperboard size={16} style={{ color: p.status === 'COMPLETED' ? S.accent : S.textMute }} />
                  </div>

                  {/* Title + meta */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-xs font-medium truncate" style={{ color: S.text }}>{p.title}</span>
                      <StatusBadge status={p.status} />
                    </div>
                    <div className="flex items-center gap-2 text-[10px]" style={{ color: S.textMute }}>
                      <span>{styleInfo?.label ?? p.style}</span>
                      <span style={{ color: S.textFade }}>·</span>
                      <span>{p.sourceVideos.length} vidéo{p.sourceVideos.length !== 1 ? 's' : ''}</span>
                      {p.audioDuration != null && <><span style={{ color: S.textFade }}>·</span><span>{Math.round(p.audioDuration)}s</span></>}
                      <span style={{ color: S.textFade }}>·</span>
                      <span>{RATIOS.find(r => r.key === p.ratio)?.label}</span>
                    </div>
                  </div>

                  {/* Status spinner */}
                  {p.status === 'PROCESSING' && (
                    <Loader2 size={13} className="animate-spin shrink-0" style={{ color: S.cyan }} />
                  )}

                  {/* Actions */}
                  <div className="shrink-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={e => handleDelete(e, p.id)}
                      disabled={isDel}
                      className="p-1.5 rounded"
                      style={{ color: S.textFade }}
                      onMouseEnter={e => (e.currentTarget.style.color = S.red)}
                      onMouseLeave={e => (e.currentTarget.style.color = S.textFade)}
                    >
                      {isDel ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                    </button>
                    <ChevronRight size={13} style={{ color: S.textMute }} />
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* ── New project panel ── */}
        {showForm && (
          <div className="shrink-0 flex flex-col border-l overflow-y-auto" style={{ width: 360, borderColor: S.border, background: S.panelAlt }}>
            {/* Panel header */}
            <div className="flex items-center justify-between px-5 border-b shrink-0"
              style={{ height: 36, borderColor: S.border }}>
              <span className="text-xs font-semibold" style={{ color: S.text }}>Nouveau montage</span>
              <button onClick={() => setShowForm(false)} style={{ color: S.textMute }} className="hover:brightness-150">
                <X size={13} />
              </button>
            </div>

            <div className="flex flex-col gap-5 p-5 flex-1">
              {/* Title */}
              <div>
                <div className="text-[9px] uppercase tracking-wider mb-1.5" style={{ color: S.textMute }}>Titre</div>
                <input
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleCreate()}
                  placeholder="Mon montage…"
                  className="w-full px-3 py-2 rounded text-xs outline-none"
                  style={{ background: S.input, border: `1px solid ${S.border}`, color: S.text }}
                />
              </div>

              {/* Style */}
              <div>
                <div className="text-[9px] uppercase tracking-wider mb-1.5" style={{ color: S.textMute }}>Style</div>
                <div className="flex flex-col gap-1">
                  {STYLES.map(s => (
                    <button
                      key={s.key}
                      onClick={() => setStyle(s.key)}
                      className="flex items-center gap-2.5 px-3 py-2 rounded text-left transition-colors"
                      style={{
                        background: style === s.key ? S.accent + '15' : S.input,
                        border: `1px solid ${style === s.key ? S.accent + '60' : S.border}`,
                      }}
                    >
                      <span className="text-base shrink-0">{s.emoji}</span>
                      <div>
                        <div className="text-xs font-semibold" style={{ color: style === s.key ? S.accent : S.text }}>{s.label}</div>
                        <div className="text-[10px]" style={{ color: S.textMute }}>{s.desc}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Duration */}
              <div>
                <div className="text-[9px] uppercase tracking-wider mb-1.5" style={{ color: S.textMute }}>Durée</div>
                <div className="flex gap-1.5">
                  {DURATIONS.map(d => (
                    <button
                      key={d.key}
                      onClick={() => setDuration(d.key)}
                      className="flex-1 py-1.5 rounded text-xs font-semibold"
                      style={{
                        background: duration === d.key ? S.accent + '20' : S.input,
                        border: `1px solid ${duration === d.key ? S.accent + '60' : S.border}`,
                        color: duration === d.key ? S.accent : S.textDim,
                      }}
                    >{d.label}</button>
                  ))}
                </div>
              </div>

              {/* Ratio */}
              <div>
                <div className="text-[9px] uppercase tracking-wider mb-1.5" style={{ color: S.textMute }}>Format</div>
                <div className="flex gap-1.5">
                  {RATIOS.map(r => (
                    <button
                      key={r.key}
                      onClick={() => setRatio(r.key)}
                      className="flex-1 py-2.5 rounded flex flex-col items-center gap-1"
                      style={{
                        background: ratio === r.key ? S.accent + '20' : S.input,
                        border: `1px solid ${ratio === r.key ? S.accent + '60' : S.border}`,
                        color: ratio === r.key ? S.accent : S.textDim,
                      }}
                    >
                      <span className="text-lg leading-none">{r.symbol}</span>
                      <span className="text-[10px] font-semibold">{r.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Create button */}
            <div className="px-5 py-4 border-t shrink-0" style={{ borderColor: S.border }}>
              <button
                onClick={handleCreate}
                disabled={!title.trim() || creating}
                className="w-full flex items-center justify-center gap-2 py-2 rounded text-sm font-semibold disabled:opacity-40"
                style={{ background: S.accent, color: '#000' }}
              >
                {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                {creating ? 'Création…' : 'Créer le montage'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
