import { createContext, useContext, useState, useEffect } from 'react'
import { Outlet, Navigate, useLocation, useNavigate } from 'react-router-dom'
import Sidebar from './Sidebar'
import Topbar from './Topbar'
import GlobalPlayer from '../player/GlobalPlayer'
import { usePageMeta } from '../../hooks/usePageMeta'
import { useAuth } from '../../hooks/useAuth'
import { notificationActions, useNotifications } from '../../store/notificationsStore'
import { workspaceActions, useWorkspaces } from '../../store/workspaceStore'
import NotifToast from '../NotifToast'

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
  const location = useLocation()
  const navigate = useNavigate()
  const { latest } = useNotifications()
  const { workspace, workspaces, loading: wsLoading } = useWorkspaces()

  // Initialise workspace store once after user is known
  useEffect(() => {
    if (!user) return
    workspaceActions.init()
    return () => { notificationActions.disconnect() }
  }, [user])

  // Connect notifications whenever the active workspace changes
  useEffect(() => {
    if (workspace) notificationActions.connect(workspace.id)
  }, [workspace])

  const wsChecked = !wsLoading || user == null
  const hasWorkspace = workspaces.length > 0

  if (loading || (user != null && !wsChecked)) return (
    <div className="flex h-screen items-center justify-center" style={{ background: '#111' }}>
      <div className="w-7 h-7 rounded-full animate-spin" style={{ border: '2px solid #2a2a2a', borderTopColor: '#f0a830' }} />
    </div>
  )
  if (!user) return <Navigate to="/login" replace />
  // Only redirect to onboarding for brand-new users (flag not yet set).
  // Users who deliberately skipped onboarding (shared-workspace members) must pass through.
  const alreadyOnboarded = localStorage.getItem('ss_onboarded') === 'true'
  if (!hasWorkspace && !alreadyOnboarded && location.pathname !== '/onboarding') return <Navigate to="/onboarding" replace />

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
      {/* Real-time toast notifications */}
      {latest && <NotifToast notif={latest} onNavigate={(link) => { navigate(link) }} />}
    </MobileSidebarCtx.Provider>
  )
}
