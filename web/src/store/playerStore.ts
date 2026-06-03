import { useSyncExternalStore } from "react"

export interface Track {
  id: string
  title: string
  artist: string
  url: string
  artwork?: string
  duration?: number
  type?: 'library' | 'preview'
}

interface PlayerState {
  track: Track | null
  isPlaying: boolean
  volume: number
  currentTime: number
}

let state: PlayerState = { track: null, isPlaying: false, volume: 0.8, currentTime: 0 }
const listeners = new Set<() => void>()

function notify() { listeners.forEach(fn => fn()) }

function getSnapshot() { return state }
function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export const playerActions = {
  setTrack(track: Track)   { state = { ...state, track, isPlaying: true }; notify() },
  togglePlay()             { state = { ...state, isPlaying: !state.isPlaying }; notify() },
  setVolume(volume: number){ state = { ...state, volume }; notify() },
  seek(currentTime: number){ state = { ...state, currentTime }; notify() },
}

export function usePlayerStore() {
  const s = useSyncExternalStore(subscribe, getSnapshot)
  return { ...s, ...playerActions }
}
