/**
 * Global active-workspace store.
 * Fetches all workspaces once, persists the selected ID in localStorage,
 * and notifies every subscriber (via useSyncExternalStore) when the selection changes.
 *
 * Usage:
 *   const { workspace, workspaces, loading, setActiveWorkspace } = useWorkspaces()
 *
 *   // Initialise once from AppLayout (after auth):
 *   workspaceActions.init()
 *   workspaceActions.invalidate()   // force re-fetch (e.g. after creating a workspace)
 */
import { useSyncExternalStore } from 'react'
import { wsApi } from '../lib/api'
import type { Workspace } from '../lib/api'

const LS_KEY = 'vibot_active_ws'

interface State {
  all: Workspace[]
  activeId: string | null
  loading: boolean
}

let state: State = { all: [], activeId: null, loading: true }
const listeners = new Set<() => void>()
const emit = () => listeners.forEach(f => f())
const getSnap = (): State => state

let initPromise: Promise<void> | null = null

export const workspaceActions = {
  /** Fetch workspaces and restore the last-selected workspace. Idempotent. */
  init(): Promise<void> {
    if (initPromise) return initPromise
    initPromise = (async () => {
      try {
        const { workspaces } = await wsApi.list()
        const saved = localStorage.getItem(LS_KEY)
        const activeId =
          workspaces.find(w => w.id === saved)?.id ??
          workspaces[0]?.id ??
          null
        if (activeId) localStorage.setItem(LS_KEY, activeId)
        state = { all: workspaces, activeId, loading: false }
      } catch {
        state = { ...state, loading: false }
      }
      emit()
    })()
    return initPromise
  },

  /** Switch the active workspace. */
  setActive(id: string) {
    if (!state.all.find(w => w.id === id)) return
    localStorage.setItem(LS_KEY, id)
    state = { ...state, activeId: id }
    emit()
  },

  /** Force a re-fetch on next init() call (e.g. after creating a new workspace). */
  invalidate() {
    initPromise = null
    state = { all: [], activeId: null, loading: true }
    emit()
  },
}

/** Subscribe to the workspace store. */
export function useWorkspaces() {
  const s = useSyncExternalStore(
    fn => { listeners.add(fn); return () => { listeners.delete(fn) } },
    getSnap,
  )
  return {
    workspace:          s.all.find(w => w.id === s.activeId) ?? null,
    workspaces:         s.all,
    loading:            s.loading,
    setActiveWorkspace: workspaceActions.setActive,
  }
}
