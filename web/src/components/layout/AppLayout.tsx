import { createContext, useContext, useState, useEffect } from 'react'
import { Outlet, Navigate, useLocation } from 'react-router-dom'
import Sidebar from './Sidebar'
import Topbar from './Topbar'
import GlobalPlayer from '../player/GlobalPlayer'
import { usePageMeta } from '../../hooks/usePageMeta'
import { useAuth } from '../../hooks/useAuth'
import { wsApi } from '../../lib/api'

interface MobileSidebarCtxType {
  mobileOpen: boolean
  toggleMobile: () => void
  closeMobile: () => void
}

export const MobileSidebarCtx = createContext<MobileSidebarCtxType>({
  mobileOpen: false,
  toggleMobile: () => {},
  closeMobile: () => {},
})

export function useMobileSidebar() {
  return useContext(MobileSidebarCtx)
}

export default function AppLayout() {
  const { title, subtitle } = usePageMeta()
  const { user, loading } = useAuth()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [wsChecked, setWsChecked] = useState(false)
  const [hasWorkspace, setHasWorkspace] = useState(true)
  const location = useLocation()

  useEffect(() => {
    if (!user) return
    wsApi.list().then(d => {
      setHasWorkspace(d.workspaces.length > 0)
      setWsChecked(true)
    }).catch(() => setWsChecked(true))
  }, [user])

  if (loading || (user != null && !wsChecked)) return (
    <div className="flex h-screen items-center justify-center" style={{ background: '#111' }}>
      <div className="w-7 h-7 rounded-full animate-spin" style={{ border: '2px solid #2a2a2a', borderTopColor: '#f0a830' }} />
    </div>
  )
  if (!user) return <Navigate to="/login" replace />
  if (!hasWorkspace && location.pathname !== '/onboarding') return <Navigate to="/onboarding" replace />

  return (
    <MobileSidebarCtx.Provider value={{ mobileOpen, toggleMobile: () => setMobileOpen(v => !v), closeMobile: () => setMobileOpen(false) }}>
      <div className="flex h-screen overflow-hidden" style={{ background: '#111' }}>
        {/* Mobile sidebar backdrop */}
        {mobileOpen && (
          <div
            className="fixed inset-0 z-30 md:hidden"
            style={{ background: 'rgba(0,0,0,0.65)' }}
            onClick={() => setMobileOpen(false)}
          />
        )}
        <Sidebar />
        <div className="flex flex-col flex-1 overflow-hidden min-w-0">
          <Topbar title={title} subtitle={subtitle} />
          <main className="flex-1 overflow-y-auto p-0">
            <Outlet />
          </main>
          <GlobalPlayer />
        </div>
      </div>
    </MobileSidebarCtx.Provider>
  )
}
