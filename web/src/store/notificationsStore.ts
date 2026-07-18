/**
 * Real-time notification store — connects to the SSE stream for the active workspace
 * and keeps notifications in memory (useSyncExternalStore pattern, same as playerStore).
 *
 * Usage:
 *   const { notifications, unreadCount, markRead, markAllRead } = useNotifications()
 *   notificationActions.connect(wsId)   // called once from AppLayout
 *   notificationActions.disconnect()
 */
import { useSyncExternalStore } from 'react'

export type NotifType =
  | 'track:added'
  | 'track:error'
  | 'montage:done'
  | 'montage:failed'
  | 'montage:started'
  | 'post:sent'
  | 'post:failed'

export interface Notification {
  id:          string
  type:        NotifType
  workspaceId: string
  title:       string
  body:        string
  link?:       string
  unread:      boolean
  createdAt:   string
}

interface NotifState {
  notifications: Notification[]
  /** Latest pushed notification — used to trigger toasts */
  latest: Notification | null
}

let state: NotifState = { notifications: [], latest: null }
const listeners = new Set<() => void>()
let es: EventSource | null = null
let connectedWsId: string | null = null

function notify() { listeners.forEach(fn => fn()) }
function getSnapshot() { return state }
function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export const notificationActions = {
  /** Connect SSE for a given workspace. Loads history then subscribes to stream. */
  async connect(wsId: string) {
    if (connectedWsId === wsId && es) return
    this.disconnect()
    connectedWsId = wsId

    // Load history from REST endpoint
    try {
      const token = localStorage.getItem('ss_token') ?? ''
      const res = await fetch(`/api/workspaces/${wsId}/notifications`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const data = await res.json() as { notifications: Notification[] }
        state = { notifications: data.notifications, latest: null }
        notify()
      }
    } catch { /* silent */ }

    // Subscribe to SSE stream (?token= because EventSource can't set headers)
    const token = localStorage.getItem('ss_token') ?? ''
    const url = `/api/workspaces/${wsId}/notifications/stream?token=${encodeURIComponent(token)}`
    es = new EventSource(url)

    es.onmessage = (event: MessageEvent) => {
      try {
        const notif = JSON.parse(event.data as string) as Notification
        state = {
          notifications: [notif, ...state.notifications].slice(0, 50),
          latest: notif,
        }
        notify()
        // Clear "latest" after a short delay (so toast only shows once)
        setTimeout(() => {
          state = { ...state, latest: null }
          notify()
        }, 4000)
      } catch { /* ignore malformed */ }
    }
    es.onerror = () => {
      // EventSource auto-reconnects — no action needed
    }
  },

  disconnect() {
    if (es) { es.close(); es = null }
    connectedWsId = null
  },

  markRead(ids: string[]) {
    state = {
      ...state,
      notifications: state.notifications.map(n =>
        ids.length === 0 || ids.includes(n.id) ? { ...n, unread: false } : n
      ),
    }
    notify()
    // Persist to server (fire-and-forget)
    if (connectedWsId) {
      const token = localStorage.getItem('ss_token') ?? ''
      fetch(`/api/workspaces/${connectedWsId}/notifications/read`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ids }),
      }).catch(() => {})
    }
  },

  markAllRead() {
    this.markRead([])
  },
}

export function useNotifications() {
  const s = useSyncExternalStore(subscribe, getSnapshot)
  return {
    notifications: s.notifications,
    latest:        s.latest,
    unreadCount:   s.notifications.filter(n => n.unread).length,
    markRead:      (ids: string[]) => notificationActions.markRead(ids),
    markAllRead:   () => notificationActions.markAllRead(),
  }
}
