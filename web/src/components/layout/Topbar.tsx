import { useState, useRef, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Bell, Search, Settings, LogOut,
  ChevronDown, Music2, Bot, Radio, Film,
  ShieldCheck, X, Loader2, Menu,
} from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useI18n } from '../../i18n'
import { wsApi, trackApi, botApi, galleryApi } from '../../lib/api'
import type { Track, Bot as BotType, VideoFile, Workspace } from '../../lib/api'
import { useMobileSidebar } from './AppLayout'

// eslint-disable-next-line @typescript-eslint/no-empty-interface
interface TopbarProps { title?: string; subtitle?: string }

const S = {
  panelAlt: '#161616', panel: '#1a1a1a', hover: '#1e1e1e',
  border: '#2a2a2a', borderHi: '#3a3a3a', accent: '#f0a830',
  text: '#ccc', textDim: '#888', textMute: '#555', textFade: '#333',
  input: '#0a0a0a', red: '#e74c3c',
}

const NOTIFICATIONS = [
  { id: '1', icon: Music2, color: S.accent,  textKey: 'notif_1_text' as const, time: '2m',  unread: true  },
  { id: '2', icon: Bot,    color: '#67e8f9', textKey: 'notif_2_text' as const, time: '15m', unread: true  },
  { id: '3', icon: Radio,  color: '#f472b6', textKey: 'notif_3_text' as const, time: '1h',  unread: false },
  { id: '4', icon: Music2, color: S.accent,  textKey: 'notif_4_text' as const, time: '3h',  unread: false },
]

function useDropdown() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])
  return { open, setOpen, ref }
}

const DropMenu = ({ style, children }: { style?: React.CSSProperties; children: React.ReactNode }) => (
  <div
    className="absolute right-0 mt-1 overflow-hidden fade-in"
    style={{
      background: S.panel, border: `1px solid ${S.borderHi}`,
      borderRadius: 8, boxShadow: '0 16px 48px rgba(0,0,0,0.7)',
      zIndex: 50, ...style,
    }}
  >
    {children}
  </div>
)

export default function Topbar({ title: _title, subtitle: _subtitle }: TopbarProps) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const { t } = useI18n()
  const searchRef = useRef<HTMLInputElement>(null)
  const searchDropRef = useRef<HTMLDivElement>(null)
  const [searchVal, setSearchVal]   = useState('')
  const [notifs, setNotifs]         = useState(NOTIFICATIONS)
  const [ws, setWs]                 = useState<Workspace | null>(null)
  const [searchResults, setSearchResults] = useState<{ tracks: Track[]; bots: BotType[]; videos: VideoFile[] } | null>(null)
  const [searching, setSearching]   = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)

  const bell    = useDropdown()
  const profile = useDropdown()

  const unread = notifs.filter(n => n.unread).length

  const handleKeydown = useCallback((e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); searchRef.current?.focus() }
    if (e.key === 'Escape') searchRef.current?.blur()
  }, [])
  useEffect(() => {
    document.addEventListener('keydown', handleKeydown)
    return () => document.removeEventListener('keydown', handleKeydown)
  }, [handleKeydown])

  // Load workspace
  useEffect(() => {
    wsApi.list().then(d => { if (d.workspaces.length) setWs(d.workspaces[0]) }).catch(() => {})
  }, [])

  // Debounced search across tracks / bots / gallery
  useEffect(() => {
    if (!searchVal.trim() || searchVal.length < 2) {
      setSearchResults(null)
      setSearchOpen(false)
      return
    }
    if (!ws) return
    const id = setTimeout(async () => {
      setSearching(true)
      try {
        const q = searchVal.toLowerCase()
        const [trackRes, botRes, videoRes] = await Promise.all([
          trackApi.list(ws.id, searchVal),
          botApi.list(ws.id),
          galleryApi.list(ws.id),
        ])
        setSearchResults({
          tracks: trackRes.tracks.slice(0, 5),
          bots: botRes.bots.filter(b =>
            b.name.toLowerCase().includes(q) || b.channelId.toLowerCase().includes(q)
          ).slice(0, 3),
          videos: videoRes.videos.filter(v =>
            v.title.toLowerCase().includes(q) || (v.artist ?? '').toLowerCase().includes(q)
          ).slice(0, 3),
        })
        setSearchOpen(true)
      } catch { /* ignore */ }
      finally { setSearching(false) }
    }, 300)
    return () => clearTimeout(id)
  }, [searchVal, ws])

  // Close dropdown on outside click
  useEffect(() => {
    if (!searchOpen) return
    const handler = (e: MouseEvent) => {
      if (searchDropRef.current && !searchDropRef.current.contains(e.target as Node)) setSearchOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [searchOpen])

  const handleLogout = () => { logout(); navigate('/login') }

  const initials = user?.displayName?.[0]?.toUpperCase() ?? user?.email?.[0]?.toUpperCase() ?? 'U'
  const { toggleMobile } = useMobileSidebar()

  return (
    <header
      className="flex items-center justify-between px-4 shrink-0 relative z-20"
      style={{ height: 48, background: S.panelAlt, borderBottom: `1px solid ${S.border}` }}
    >
      {/* Mobile hamburger */}
      <button
        className="md:hidden flex items-center justify-center rounded mr-2"
        style={{ width: 30, height: 30, color: S.textMute, background: 'transparent', border: 'none', cursor: 'pointer', flexShrink: 0 }}
        onClick={toggleMobile}
      >
        <Menu size={18} />
      </button>
      {/* Search */}
      <div ref={searchDropRef} className="relative hidden md:flex flex-1 max-w-xl">
        <div
          className="flex items-center gap-2 w-full rounded-md px-3 py-1.5"
          style={{ background: S.input, border: `1px solid ${S.border}` }}
        >
          {searching
            ? <Loader2 size={12} className="animate-spin shrink-0" style={{ color: S.accent }} />
            : <Search size={12} style={{ color: S.textMute, flexShrink: 0 }} />
          }
          <input
            ref={searchRef}
            type="text"
            value={searchVal}
            onChange={e => setSearchVal(e.target.value)}
            placeholder={t('search_placeholder')}
            className="bg-transparent text-xs outline-none flex-1"
            style={{ color: S.text }}
          />
          {searchVal ? (
            <button
              onClick={() => { setSearchVal(''); setSearchResults(null); setSearchOpen(false) }}
              style={{ color: S.textFade, border: 'none', background: 'transparent', cursor: 'pointer' }}
            >
              <X size={10} />
            </button>
          ) : (
            <kbd className="hidden sm:inline text-[9px] font-mono px-1 py-0.5 rounded" style={{ background: S.panelAlt, color: S.textFade, border: `1px solid ${S.border}` }}>
              ⌘K
            </kbd>
          )}
        </div>

        {/* Results dropdown */}
        {searchOpen && searchResults && (
          <div
            className="absolute top-full left-0 right-0 mt-1 overflow-hidden fade-in"
            style={{
              background: S.panel, border: `1px solid ${S.borderHi}`,
              borderRadius: 8, boxShadow: '0 16px 48px rgba(0,0,0,0.7)', zIndex: 50,
            }}
          >
            {searchResults.tracks.length === 0 && searchResults.bots.length === 0 && searchResults.videos.length === 0 ? (
              <div className="px-4 py-5 text-center">
                <p className="text-xs" style={{ color: S.textMute }}>{t('search_no_results')}</p>
              </div>
            ) : (
              <div className="py-1 max-h-80 overflow-y-auto">

                {/* ── Tracks ── */}
                {searchResults.tracks.length > 0 && (
                  <>
                    <div className="px-4 py-1.5 flex items-center gap-1.5" style={{ borderBottom: `1px solid ${S.border}` }}>
                      <Music2 size={9} style={{ color: S.accent }} />
                      <span className="text-[9px] font-semibold uppercase tracking-widest" style={{ color: S.textFade }}>{t('search_cat_tracks')}</span>
                    </div>
                    {searchResults.tracks.map(track => (
                      <button
                        key={track.id}
                        onClick={() => { navigate('/library'); setSearchOpen(false); setSearchVal('') }}
                        className="w-full flex items-center gap-3 px-4 py-2 text-left"
                        style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = S.hover }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                      >
                        {track.artworkUrl ? (
                          <img src={track.artworkUrl} alt="" style={{ width: 28, height: 28, borderRadius: 4, objectFit: 'cover', flexShrink: 0 }} />
                        ) : (
                          <div className="flex items-center justify-center rounded shrink-0" style={{ width: 28, height: 28, background: S.panelAlt }}>
                            <Music2 size={12} style={{ color: S.textFade }} />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-xs truncate" style={{ color: S.text }}>{track.title}</p>
                          {track.artist && <p className="text-[10px] truncate" style={{ color: S.textMute }}>{track.artist}</p>}
                        </div>
                        {track.duration !== undefined && (
                          <span className="text-[9px] font-mono shrink-0" style={{ color: S.textFade }}>
                            {Math.floor(track.duration / 60)}:{String(Math.round(track.duration % 60)).padStart(2, '0')}
                          </span>
                        )}
                      </button>
                    ))}
                  </>
                )}

                {/* ── Bots ── */}
                {searchResults.bots.length > 0 && (
                  <>
                    <div
                      className="px-4 py-1.5 flex items-center gap-1.5"
                      style={{ borderTop: searchResults.tracks.length > 0 ? `1px solid ${S.border}` : undefined, borderBottom: `1px solid ${S.border}` }}
                    >
                      <Bot size={9} style={{ color: '#67e8f9' }} />
                      <span className="text-[9px] font-semibold uppercase tracking-widest" style={{ color: S.textFade }}>{t('search_cat_bots')}</span>
                    </div>
                    {searchResults.bots.map(bot => (
                      <button
                        key={bot.id}
                        onClick={() => { navigate('/channels'); setSearchOpen(false); setSearchVal('') }}
                        className="w-full flex items-center gap-3 px-4 py-2 text-left"
                        style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = S.hover }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                      >
                        <div className="flex items-center justify-center rounded shrink-0" style={{ width: 28, height: 28, background: S.panelAlt }}>
                          <Bot size={12} style={{ color: '#67e8f9' }} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs truncate" style={{ color: S.text }}>{bot.name}</p>
                          <p className="text-[10px] truncate" style={{ color: S.textMute }}>{bot.channelId}</p>
                        </div>
                        <span
                          className="text-[9px] px-1.5 py-0.5 rounded-full shrink-0"
                          style={{
                            background: bot.status === 'running' ? 'rgba(74,222,128,0.12)' : 'rgba(136,136,136,0.12)',
                            color: bot.status === 'running' ? '#4ade80' : S.textMute,
                          }}
                        >{bot.status}</span>
                      </button>
                    ))}
                  </>
                )}

                {/* ── Videos ── */}
                {searchResults.videos.length > 0 && (
                  <>
                    <div
                      className="px-4 py-1.5 flex items-center gap-1.5"
                      style={{
                        borderTop: (searchResults.tracks.length > 0 || searchResults.bots.length > 0) ? `1px solid ${S.border}` : undefined,
                        borderBottom: `1px solid ${S.border}`,
                      }}
                    >
                      <Film size={9} style={{ color: '#f472b6' }} />
                      <span className="text-[9px] font-semibold uppercase tracking-widest" style={{ color: S.textFade }}>{t('search_cat_videos')}</span>
                    </div>
                    {searchResults.videos.map(video => (
                      <button
                        key={video.id}
                        onClick={() => { navigate('/gallery'); setSearchOpen(false); setSearchVal('') }}
                        className="w-full flex items-center gap-3 px-4 py-2 text-left"
                        style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = S.hover }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                      >
                        {video.thumbnailUrl ? (
                          <img src={video.thumbnailUrl} alt="" style={{ width: 28, height: 28, borderRadius: 4, objectFit: 'cover', flexShrink: 0 }} />
                        ) : (
                          <div className="flex items-center justify-center rounded shrink-0" style={{ width: 28, height: 28, background: S.panelAlt }}>
                            <Film size={12} style={{ color: S.textFade }} />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-xs truncate" style={{ color: S.text }}>{video.title}</p>
                          <p className="text-[10px] truncate" style={{ color: S.textMute }}>{video.platform}</p>
                        </div>
                        {video.duration !== undefined && (
                          <span className="text-[9px] font-mono shrink-0" style={{ color: S.textFade }}>
                            {Math.floor(video.duration / 60)}:{String(Math.round(video.duration % 60)).padStart(2, '0')}
                          </span>
                        )}
                      </button>
                    ))}
                  </>
                )}

              </div>
            )}
          </div>
        )}
      </div>

      {/* Right — icons */}
      <div className="flex items-center gap-1 ml-auto">

        {/* Notifications */}
        <div ref={bell.ref} className="relative">
          <button
            onClick={() => { bell.setOpen(o => !o); profile.setOpen(false) }}
            className="relative p-2 rounded transition-colors"
            style={{ color: S.textMute, background: 'transparent', border: 'none', cursor: 'pointer' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = S.text }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = S.textMute }}
          >
            <Bell size={15} />
            {unread > 0 && (
              <span
                className="absolute rounded-full"
                style={{ width: 6, height: 6, background: S.accent, top: 7, right: 7 }}
              />
            )}
          </button>

          {bell.open && (
            <DropMenu style={{ width: 300 }}>
              <div
                className="flex items-center justify-between px-4 py-2.5"
                style={{ borderBottom: `1px solid ${S.border}` }}
              >
                <span className="text-xs font-semibold" style={{ color: S.text }}>{t('notifications_heading')}</span>
                {unread > 0 && (
                  <button
                    onClick={() => setNotifs(n => n.map(x => ({ ...x, unread: false })))}
                    className="text-[10px] hover:brightness-125"
                    style={{ color: S.accent, background: 'transparent', border: 'none', cursor: 'pointer' }}
                  >
                    {t('notifications_mark_all_read')}
                  </button>
                )}
              </div>
              <div className="max-h-64 overflow-y-auto">
                {notifs.map(({ id, icon: Icon, color, textKey, time, unread: u }) => (
                  <div
                    key={id}
                    className="flex items-start gap-3 px-4 py-2.5 cursor-pointer transition-colors"
                    style={{ background: u ? `${S.accent}08` : 'transparent' }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = S.hover }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = u ? `${S.accent}08` : 'transparent' }}
                    onClick={() => setNotifs(n => n.map(x => x.id === id ? { ...x, unread: false } : x))}
                  >
                    <Icon size={13} style={{ color, marginTop: 1, flexShrink: 0 }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] leading-snug" style={{ color: S.text }}>{t(textKey)}</p>
                      <p className="text-[10px] mt-0.5" style={{ color: S.textFade }}>{time}</p>
                    </div>
                    {u && <span className="rounded-full mt-1.5 shrink-0" style={{ width: 5, height: 5, background: S.accent, display: 'block' }} />}
                  </div>
                ))}
              </div>
            </DropMenu>
          )}
        </div>

        {/* Profile */}
        <div ref={profile.ref} className="relative ml-1">
          <button
            onClick={() => { profile.setOpen(o => !o); bell.setOpen(false) }}
            className="flex items-center gap-2 pl-1.5 pr-2 py-1 rounded transition-colors"
            style={{ color: S.textDim, background: 'transparent', border: `1px solid transparent`, cursor: 'pointer' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = S.border }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'transparent' }}
          >
            <div
              className="flex items-center justify-center rounded-full text-[10px] font-bold shrink-0"
              style={{ width: 24, height: 24, background: S.accent, color: '#000' }}
            >
              {initials}
            </div>
            <span className="hidden sm:block text-xs font-medium max-w-20 truncate" style={{ color: S.text }}>
              {user?.displayName ?? user?.email?.split('@')[0] ?? 'Profile'}
            </span>
            <ChevronDown size={11} style={{ color: S.textMute, transform: profile.open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
          </button>

          {profile.open && (
            <DropMenu style={{ width: 220 }}>
              {/* User info */}
              <div className="flex items-center gap-3 px-4 py-3" style={{ borderBottom: `1px solid ${S.border}` }}>
                <div
                  className="flex items-center justify-center rounded-full text-sm font-bold shrink-0"
                  style={{ width: 34, height: 34, background: S.accent, color: '#000' }}
                >
                  {initials}
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold truncate" style={{ color: S.text }}>
                    {user?.displayName ?? 'User'}
                  </p>
                  <p className="text-[10px] truncate" style={{ color: S.textMute }}>{user?.email ?? ''}</p>
                  <span
                    className="text-[9px] font-medium px-1.5 py-0.5 rounded-full mt-1 inline-block"
                    style={{ background: `${S.accent}18`, color: S.accent, border: `1px solid ${S.accent}30` }}
                  >
                    {user?.globalRole === 'ADMIN' ? t('role_admin') : t('role_user')}
                  </span>
                </div>
              </div>
              {/* Menu */}
              <div className="py-1">
                {[
                  { icon: ShieldCheck, label: t('profile_menu_admin'),    action: () => { navigate('/admin');    profile.setOpen(false) } },
                  { icon: Settings,    label: t('profile_menu_settings'), action: () => { navigate('/settings'); profile.setOpen(false) } },
                ].map(({ icon: Icon, label, action }) => (
                  <button
                    key={label}
                    onClick={action}
                    className="w-full flex items-center gap-2.5 px-4 py-2 text-xs text-left transition-colors"
                    style={{ color: S.textDim, background: 'transparent', border: 'none', cursor: 'pointer' }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = S.hover; (e.currentTarget as HTMLElement).style.color = S.text }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = S.textDim }}
                  >
                    <Icon size={13} style={{ color: S.textMute }} />{label}
                  </button>
                ))}
              </div>
              <div className="py-1" style={{ borderTop: `1px solid ${S.border}` }}>
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center gap-2.5 px-4 py-2 text-xs text-left transition-colors"
                  style={{ color: S.red, background: 'transparent', border: 'none', cursor: 'pointer' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(231,76,60,0.06)' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                >
                  <LogOut size={13} style={{ color: S.red }} />{t('profile_menu_logout')}
                </button>
              </div>
            </DropMenu>
          )}
        </div>
      </div>
    </header>
  )
}
