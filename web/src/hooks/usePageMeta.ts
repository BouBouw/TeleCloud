import { useLocation } from 'react-router-dom'

const META: Record<string, { title: string; subtitle?: string }> = {
  '/dashboard': { title: 'Dashboard',  subtitle: 'Welcome back — here\'s your overview' },
  '/library':   { title: 'Library',    subtitle: 'Manage your local track collection'   },
  '/gallery':   { title: 'Galerie',    subtitle: 'Vidéos MP4 téléchargées'              },
  '/studio':    { title: 'Studio',     subtitle: 'Professional audio editing workspace'  },
  '/channels':  { title: 'Channels',   subtitle: 'Manage Telegram bots & broadcast channels' },
  '/admin':     { title: 'Admin',      subtitle: 'Platform administration & settings'   },
  '/login':     { title: 'Sign In',    subtitle: 'Welcome to Vibot'                 },
}

export function usePageMeta() {
  const { pathname } = useLocation()
  const key = Object.keys(META).find(k => pathname.startsWith(k)) ?? '/dashboard'
  return META[key] ?? { title: 'Vibot' }
}
