import { useState, useEffect } from 'react'
import { wsApi } from '../lib/api'
import type { Workspace } from '../lib/api'

export function useWorkspace() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    wsApi.list()
      .then(({ workspaces }) => { setWorkspace(workspaces[0] ?? null) })
      .catch(() => { /* ignore */ })
      .finally(() => setLoading(false))
  }, [])

  return { workspace, loading }
}
