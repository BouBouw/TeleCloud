import { useWorkspaces } from '../store/workspaceStore'

export function useWorkspace() {
  const { workspace, loading } = useWorkspaces()
  return { workspace, loading }
}
