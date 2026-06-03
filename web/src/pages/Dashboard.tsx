import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Music2, Radio, HardDrive, Bot,
  Play, Activity, Users, ArrowUpRight,
  Loader2, TrendingUp, Hash,
} from 'lucide-react'
import { wsApi, trackApi, botApi } from '../lib/api'
import type { Track, Bot as BotType, Workspace } from '../lib/api'
import { useI18n } from '../i18n'

/* ─── Design tokens ─── */
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
  green:    '#4ade80',
  yellow:   '#facc15',
  cyan:     '#67e8f9',
  pink:     '#f472b6',
}

const fmt = (sec?: number) =>
  sec ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}` : '--:--'

/* ─── StatCard ─── */
function StatCard({ label, value, icon: Icon, accent, loading }: {
  label: string; value: string; icon: React.ElementType; accent: string; loading: boolean
}) {
  return (
    <div
      style={{
        background: S.panel,
        border: `1px solid ${S.border}`,
        borderLeft: `2px solid ${accent}`,
        borderRadius: 8,
        padding: '14px 16px',
      }}
    >
      <div className="flex items-center justify-between mb-3">
        <div
          className="flex items-center justify-center rounded"
          style={{ width: 32, height: 32, background: S.panelAlt, border: `1px solid ${S.border}` }}
        >
          <Icon size={15} style={{ color: accent }} />
        </div>
        <span className="flex items-center gap-1 text-[10px]" style={{ color: S.green }}>
          <ArrowUpRight size={10} />live
        </span>
      </div>
      <p className="text-xl font-bold tabular-nums" style={{ color: S.text }}>
        {loading ? '…' : value}
      </p>
      <p className="text-[10px] mt-0.5" style={{ color: S.textMute }}>{label}</p>
    </div>
  )
}

/* ─── Dashboard ─── */
export default function Dashboard() {
  const navigate = useNavigate()
  const { t } = useI18n()
  const [ws,      setWs]      = useState<Workspace | null>(null)
  const [tracks,  setTracks]  = useState<Track[]>([])
  const [total,   setTotal]   = useState(0)
  const [bots,    setBots]    = useState<BotType[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    wsApi.list()
      .then(d => {
        const w = d.workspaces[0] ?? null
        setWs(w)
        if (!w) { setLoading(false); return }
        Promise.all([
          trackApi.list(w.id).then(td => { setTracks(td.tracks.slice(0, 8)); setTotal(td.total) }),
          botApi.list(w.id).then(bd => setBots(bd.bots)),
        ]).finally(() => setLoading(false))
      })
      .catch(() => setLoading(false))
  }, [])

  const activeBots = bots.filter(b => b.status === 'running')

  const stats = [
    { label: t('stat_total_tracks'), value: String(total),             icon: Music2,    accent: S.accent },
    { label: t('stat_active_bots'),  value: String(activeBots.length), icon: Bot,       accent: S.cyan   },
    { label: t('stat_total_bots'),   value: String(bots.length),       icon: Radio,     accent: S.pink   },
    { label: t('stat_workspace'),    value: ws?.name ?? '—',           icon: HardDrive, accent: S.green  },
  ]

  function statusColor(s: string) {
    if (s === 'running') return S.green
    if (s === 'paused')  return S.yellow
    return S.red
  }

  return (
    <div className="flex flex-col h-full fade-in" style={{ background: S.bg, color: S.text }}>

      {/* ── Top bar ── */}
      <div
        className="flex items-center gap-3 px-4 border-b shrink-0"
        style={{ borderColor: S.border, height: 36 }}
      >
        <Activity size={13} style={{ color: S.accent }} />
        <span className="text-sm font-semibold" style={{ color: S.text }}>{t('page_title_dashboard')}</span>
        {ws && (
          <span className="text-[10px]" style={{ color: S.textMute }}>
            {ws.name}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <span
            className="rounded-full"
            style={{ width: 6, height: 6, background: S.green, display: 'inline-block' }}
          />
          <span className="text-[10px]" style={{ color: S.green }}>{t('live_indicator')}</span>
        </div>
      </div>

      {/* ── Scrollable content ── */}
      <div className="flex-1 overflow-y-auto p-3 sm:p-5">

        {/* Stats grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 mb-5">
          {stats.map(s => (
            <StatCard key={s.label} {...s} loading={loading} />
          ))}
        </div>

        {/* Main two-col grid */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 mb-5">

          {/* ── Recent Tracks ── */}
          <div
            className="xl:col-span-2 flex flex-col"
            style={{
              background: S.panel,
              border: `1px solid ${S.border}`,
              borderRadius: 8,
              overflow: 'hidden',
            }}
          >
            {/* Section header */}
            <div
              className="flex items-center justify-between px-4 shrink-0"
              style={{ height: 40, borderBottom: `1px solid ${S.border}`, background: S.panelAlt }}
            >
              <span className="flex items-center gap-2 text-xs font-semibold" style={{ color: S.text }}>
                <Music2 size={12} style={{ color: S.accent }} />{t('section_recent_tracks')}
              </span>
              <button
                onClick={() => navigate('/library')}
                className="text-[10px] hover:brightness-150"
                style={{ color: S.accent, background: 'transparent', border: 'none', cursor: 'pointer' }}
              >
                {t('btn_see_all')}
              </button>
            </div>

            {/* Track list */}
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-12" style={{ color: S.textMute }}>
                <Loader2 size={14} className="animate-spin" style={{ color: S.accent }} />
                <span className="text-xs">{t('loading')}</span>
              </div>
            ) : tracks.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 gap-2">
                <Music2 size={22} style={{ color: S.textFade }} />
                <p className="text-xs" style={{ color: S.textMute }}>{t('empty_no_tracks')}</p>
                <button
                  onClick={() => navigate('/library')}
                  className="text-[10px] hover:brightness-150 mt-1"
                  style={{ color: S.accent, background: 'transparent', border: 'none', cursor: 'pointer' }}
                >
                  {t('empty_import_tracks')}
                </button>
              </div>
            ) : (
              tracks.map((track, i) => (
                <div
                  key={track.id}
                  className="flex items-center gap-3 px-4 group transition-colors cursor-pointer"
                  style={{ height: 52, borderBottom: `1px solid ${S.border}` }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = S.hover }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '' }}
                >
                  {/* Index / play */}
                  <div className="w-5 shrink-0 flex items-center justify-center">
                    <span className="text-[10px] font-mono group-hover:hidden" style={{ color: S.textFade }}>
                      {i + 1}
                    </span>
                    <button
                      className="hidden group-hover:flex items-center justify-center"
                      style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: S.textMute, padding: 0 }}
                    >
                      <Play size={11} fill="currentColor" style={{ marginLeft: 1 }} />
                    </button>
                  </div>

                  {/* Artwork */}
                  <div
                    className="shrink-0 rounded overflow-hidden"
                    style={{ width: 36, height: 36, background: S.input, border: `1px solid ${S.border}` }}
                  >
                    {track.artworkUrl
                      ? <img src={track.artworkUrl} alt="" className="w-full h-full object-cover" />
                      : <div className="w-full h-full flex items-center justify-center">
                          <Music2 size={13} style={{ color: S.textFade }} />
                        </div>
                    }
                  </div>

                  {/* Title / Artist */}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate leading-tight" style={{ color: S.text }}>
                      {track.title}
                    </p>
                    <p className="text-[10px] truncate mt-0.5" style={{ color: S.textMute }}>
                      {track.artist ?? t('unknown_artist')}
                    </p>
                  </div>

                  {/* Play count */}
                  <div className="shrink-0 hidden sm:flex items-center gap-1" style={{ color: S.textFade }}>
                    <Activity size={10} />
                    <span className="text-[10px] tabular-nums">{track.playCount}</span>
                  </div>

                  {/* Duration */}
                  <div className="w-10 shrink-0 text-right">
                    <span className="text-[10px] tabular-nums font-mono" style={{ color: S.textMute }}>
                      {fmt(track.duration)}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* ── Active Bots ── */}
          <div
            className="flex flex-col"
            style={{
              background: S.panel,
              border: `1px solid ${S.border}`,
              borderRadius: 8,
              overflow: 'hidden',
            }}
          >
            {/* Section header */}
            <div
              className="flex items-center justify-between px-4 shrink-0"
              style={{ height: 40, borderBottom: `1px solid ${S.border}`, background: S.panelAlt }}
            >
              <span className="flex items-center gap-2 text-xs font-semibold" style={{ color: S.text }}>
                <Bot size={12} style={{ color: S.cyan }} />{t('section_active_bots')}
              </span>
              <button
                onClick={() => navigate('/channels')}
                className="text-[10px] hover:brightness-150"
                style={{ color: S.cyan, background: 'transparent', border: 'none', cursor: 'pointer' }}
              >
                {t('btn_manage')}
              </button>
            </div>

            {/* Bot list */}
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-12" style={{ color: S.textMute }}>
                <Loader2 size={14} className="animate-spin" style={{ color: S.accent }} />
                <span className="text-xs">{t('loading')}</span>
              </div>
            ) : bots.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 gap-2">
                <Bot size={22} style={{ color: S.textFade }} />
                <p className="text-xs" style={{ color: S.textMute }}>{t('empty_no_bots')}</p>
                <button
                  onClick={() => navigate('/channels')}
                  className="text-[10px] hover:brightness-150 mt-1"
                  style={{ color: S.cyan, background: 'transparent', border: 'none', cursor: 'pointer' }}
                >
                  {t('empty_deploy_bot')}
                </button>
              </div>
            ) : (
              <>
                {bots.slice(0, 6).map(bot => (
                  <div
                    key={bot.id}
                    className="flex items-center gap-3 px-4 group transition-colors"
                    style={{ height: 52, borderBottom: `1px solid ${S.border}` }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = S.hover }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '' }}
                  >
                    {/* Status dot */}
                    <span
                      className="rounded-full shrink-0"
                      style={{ width: 6, height: 6, background: statusColor(bot.status) }}
                    />

                    {/* Name / Channel */}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate leading-tight" style={{ color: S.text }}>
                        {bot.name}
                      </p>
                      <p className="text-[10px] truncate mt-0.5 flex items-center gap-0.5" style={{ color: S.textFade }}>
                        <Hash size={8} />{bot.channelId}
                      </p>
                    </div>

                    {/* Broadcasts */}
                    <div className="shrink-0 flex items-center gap-1" style={{ color: S.textFade }}>
                      <Radio size={10} />
                      <span className="text-[10px] tabular-nums">{bot.broadcastCount}</span>
                    </div>
                  </div>
                ))}

                {/* Add more */}
                <button
                  onClick={() => navigate('/channels')}
                  className="flex items-center justify-center gap-1.5 text-[10px] py-3 hover:brightness-125 transition-all"
                  style={{
                    background: 'transparent',
                    border: 'none',
                    borderTop: `1px dashed ${S.border}`,
                    color: S.textFade,
                    cursor: 'pointer',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = S.accent }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = S.textFade }}
                >
                  {t('btn_manage_all_bots')}
                </button>
              </>
            )}
          </div>
        </div>

        {/* ── Bottom row ── */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">

          {/* Bot summary */}
          <div
            style={{
              background: S.panel,
              border: `1px solid ${S.border}`,
              borderRadius: 8,
              overflow: 'hidden',
            }}
          >
            <div
              className="flex items-center gap-2 px-4 shrink-0"
              style={{ height: 40, borderBottom: `1px solid ${S.border}`, background: S.panelAlt }}
            >
              <TrendingUp size={12} style={{ color: S.green }} />
              <span className="text-xs font-semibold" style={{ color: S.text }}>{t('section_bot_summary')}</span>
            </div>
            <div className="grid grid-cols-2 gap-3 p-4">
              {[
                { label: t('summary_running'), value: bots.filter(b => b.status === 'running').length, color: S.green  },
                { label: t('summary_paused'),  value: bots.filter(b => b.status === 'paused').length,  color: S.yellow },
                { label: t('summary_total'),   value: bots.length,                                     color: S.cyan   },
                { label: t('summary_tracks'),  value: total,                                            color: S.accent },
              ].map(({ label, value, color }) => (
                <div
                  key={label}
                  className="flex flex-col justify-center p-3 rounded"
                  style={{ background: S.panelAlt, border: `1px solid ${S.border}`, minHeight: 56 }}
                >
                  <p className="text-lg font-bold tabular-nums" style={{ color }}>
                    {loading ? '…' : value}
                  </p>
                  <p className="text-[10px] mt-0.5" style={{ color: S.textMute }}>{label}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Workspace info */}
          <div
            style={{
              background: S.panel,
              border: `1px solid ${S.border}`,
              borderRadius: 8,
              overflow: 'hidden',
            }}
          >
            <div
              className="flex items-center gap-2 px-4 shrink-0"
              style={{ height: 40, borderBottom: `1px solid ${S.border}`, background: S.panelAlt }}
            >
              <Users size={12} style={{ color: S.pink }} />
              <span className="text-xs font-semibold" style={{ color: S.text }}>{t('section_workspace')}</span>
            </div>
            {!loading && ws ? (
              <div className="flex flex-col gap-0 p-4">
                {[
                  { label: t('ws_row_name'),   value: ws.name                },
                  { label: t('ws_row_slug'),   value: `/${ws.slug}`,  mono: true },
                  { label: t('ws_row_role'),   value: ws.myRole ?? 'owner'   },
                  { label: t('ws_row_tracks'), value: String(total)           },
                ].map(({ label, value, mono }) => (
                  <div
                    key={label}
                    className="flex items-center justify-between py-2.5"
                    style={{ borderBottom: `1px solid ${S.border}` }}
                  >
                    <span className="text-[11px]" style={{ color: S.textMute }}>{label}</span>
                    <span
                      className="text-[11px] font-medium"
                      style={{ color: S.textDim, fontFamily: mono ? 'monospace' : 'inherit' }}
                    >
                      {value}
                    </span>
                  </div>
                ))}
              </div>
            ) : !loading ? (
              <div className="flex flex-col items-center justify-center py-12 gap-2">
                <HardDrive size={22} style={{ color: S.textFade }} />
                <p className="text-xs" style={{ color: S.textMute }}>{t('empty_no_workspace')}</p>
              </div>
            ) : null}
          </div>
        </div>

      </div>
    </div>
  )
}
