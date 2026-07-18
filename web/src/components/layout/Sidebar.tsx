import { NavLink, useLocation } from 'react-router-dom'
import {
  LayoutDashboard, Music2, Radio, Sliders,
  ChevronLeft, ChevronRight, Volume2, Film, Clapperboard, X, Users, HardDrive, Check,
} from 'lucide-react'
import { useState, useRef, useEffect } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useI18n } from '../../i18n'
import { useMobileSidebar } from './AppLayout'
import { useWorkspaces } from '../../store/workspaceStore'

const S = {
  panelAlt: '#161616', bg: '#0a0a0a', hover: '#1e1e1e',
  border: '#2a2a2a', accent: '#f0a830', text: '#ccc',
  textMute: '#555', textFade: '#333',
}

const navItems = [
  { to: '/dashboard', icon: LayoutDashboard, key: 'nav_dashboard' as const },
  { to: '/library',   icon: Music2,          key: 'nav_library'   as const },
  { to: '/gallery',   icon: Film,            key: 'nav_gallery'   as const },
  { to: '/studio',    icon: Sliders,         key: 'nav_studio'    as const },
  { to: '/montage',   icon: Clapperboard,    key: 'nav_montage'   as const },
  { to: '/channels',  icon: Radio,           key: 'nav_channels'  as const },
  { to: '/members',   icon: Users,           key: 'nav_members'   as const },
]

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(false)
  const [wsOpen, setWsOpen] = useState(false)
  const wsRef = useRef<HTMLDivElement>(null)
  const location = useLocation()
  const { user } = useAuth()
  const { t } = useI18n()
  const { mobileOpen, closeMobile } = useMobileSidebar()
  const { workspace, workspaces, setActiveWorkspace } = useWorkspaces()

  // Close ws dropdown on outside click
  useEffect(() => {
    const h = (e: MouseEvent) => { if (wsRef.current && !wsRef.current.contains(e.target as Node)) setWsOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-40 flex flex-col h-full shrink-0 transition-all duration-200 md:relative md:inset-auto md:z-auto md:translate-x-0 ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}
      style={{
        width: collapsed ? 52 : 220,
        background: S.panelAlt,
        borderRight: `1px solid ${S.border}`,
      }}
    >
      {/* Mobile close button */}
      <button
        className="md:hidden absolute top-3 right-2 flex items-center justify-center rounded"
        style={{ width: 22, height: 22, color: S.textMute, background: 'transparent', border: 'none', cursor: 'pointer' }}
        onClick={closeMobile}
      >
        <X size={13} />
      </button>
      {/* Logo */}
      <div
        className="flex items-center gap-2.5 px-3 shrink-0"
        style={{ height: 48, borderBottom: `1px solid ${S.border}` }}
      >
        <div
          className="flex items-center justify-center rounded shrink-0"
          style={{ width: 28, height: 28, background: S.bg, border: `1px solid ${S.border}` }}
        >
          <Volume2 size={14} style={{ color: S.accent }} />
        </div>
        {!collapsed && (
          <span className="font-bold text-sm tracking-tight" style={{ color: S.text }}>
            Vi<span style={{ color: S.accent }}>bot</span>
          </span>
        )}
      </div>

      {/* Workspace switcher */}
      <div
        ref={wsRef}
        className="relative shrink-0 px-1.5 py-1.5"
        style={{ borderBottom: `1px solid ${S.border}` }}
      >
        <button
          onClick={() => setWsOpen(o => !o)}
          className="w-full flex items-center rounded text-xs transition-colors"
          style={{
            gap: collapsed ? 0 : 8,
            padding: collapsed ? '7px 14px' : '7px 8px',
            background: wsOpen ? S.hover : 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: S.text,
            justifyContent: collapsed ? 'center' : 'flex-start',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = S.hover }}
          onMouseLeave={e => { if (!wsOpen) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
          title={collapsed ? (workspace?.name ?? '') : undefined}
        >
          <HardDrive size={13} style={{ color: S.accent, flexShrink: 0 }} />
          {!collapsed && (
            <>
              <span className="flex-1 text-left truncate text-[11px] font-medium" style={{ color: S.text }}>
                {workspace?.name ?? '…'}
              </span>
              <ChevronRight
                size={11}
                style={{
                  color: S.textMute, flexShrink: 0,
                  transform: wsOpen ? 'rotate(90deg)' : 'none',
                  transition: 'transform .15s',
                }}
              />
            </>
          )}
        </button>

        {wsOpen && !collapsed && workspaces.length > 0 && (
          <div
            className="absolute left-1.5 right-1.5 z-50 rounded overflow-hidden"
            style={{ top: '100%', marginTop: 2, background: '#111', border: `1px solid ${S.border}`, boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}
          >
            <div className="px-2.5 py-1.5 text-[9px] font-semibold uppercase tracking-widest" style={{ color: S.textFade, borderBottom: `1px solid ${S.border}` }}>
              Workspace
            </div>
            {workspaces.map(w => (
              <button
                key={w.id}
                onClick={() => { setActiveWorkspace(w.id); setWsOpen(false) }}
                className="w-full flex items-center gap-2 px-2.5 py-2 text-left text-[11px] transition-colors"
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: w.id === workspace?.id ? S.text : S.textMute }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = S.hover }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
              >
                <div
                  className="shrink-0 flex items-center justify-center rounded text-[9px] font-bold"
                  style={{ width: 18, height: 18, background: w.id === workspace?.id ? S.accent : S.border, color: w.id === workspace?.id ? '#000' : S.textMute }}
                >
                  {w.name[0]?.toUpperCase()}
                </div>
                <span className="flex-1 truncate">{w.name}</span>
                {w.id === workspace?.id && <Check size={10} style={{ color: S.accent, flexShrink: 0 }} />}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 py-2 px-1.5 flex flex-col gap-px">
        {navItems.map(({ to, icon: Icon, key }) => {
          const active = location.pathname.startsWith(to)
          return (
            <NavLink
              key={to}
              to={to}
              className="flex items-center rounded text-xs font-medium transition-colors"
              style={{
                gap: collapsed ? 0 : 10,
                padding: collapsed ? '9px 14px' : '9px 10px',
                color: active ? S.text : S.textMute,
                background: active ? S.hover : 'transparent',
                borderLeft: `2px solid ${active ? S.accent : 'transparent'}`,
                justifyContent: collapsed ? 'center' : 'flex-start',
              }}
              onMouseEnter={e => {
                if (!active) (e.currentTarget as HTMLElement).style.background = S.hover
              }}
              onMouseLeave={e => {
                if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent'
              }}
            >
              <Icon
                size={15}
                className="shrink-0"
                style={{ color: active ? S.accent : S.textMute }}
              />
              {!collapsed && t(key)}
            </NavLink>
          )
        })}
      </nav>

      {/* User badge */}
      {!collapsed && (
        <div
          className="mx-2 mb-2 flex items-center gap-2 px-2.5 py-2 rounded"
          style={{ background: S.bg, border: `1px solid ${S.border}` }}
        >
          <div
            className="flex items-center justify-center rounded-full shrink-0 text-[10px] font-bold"
            style={{ width: 22, height: 22, background: S.accent, color: '#000' }}
          >
            {user?.displayName?.[0]?.toUpperCase() ?? user?.email?.[0]?.toUpperCase() ?? 'U'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-medium truncate" style={{ color: S.text }}>
              {user?.displayName ?? user?.email?.split('@')[0] ?? 'User'}
            </p>
            <p className="text-[9px]" style={{ color: S.textFade }}>
              {user?.globalRole === 'ADMIN' ? 'Admin' : 'User'}
            </p>
          </div>
        </div>
      )}

      {/* Collapse toggle */}
      <button
        onClick={() => setCollapsed(c => !c)}
        className="absolute -right-2.5 top-1/2 -translate-y-1/2 flex items-center justify-center rounded-full z-10"
        style={{
          width: 18, height: 18,
          background: S.panelAlt,
          border: `1px solid ${S.border}`,
          color: S.textMute,
          cursor: 'pointer',
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = S.accent }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = S.border }}
      >
        {collapsed ? <ChevronRight size={9} /> : <ChevronLeft size={9} />}
      </button>
    </aside>
  )
}
