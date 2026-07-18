/**
 * Real-time notification service — in-memory store + SSE subscriber registry.
 * Notifications are workspace-scoped and kept for the server lifetime (cleared on restart).
 */
import type { Response } from 'express'

export type NotifType =
  | 'track:added'
  | 'track:error'
  | 'montage:done'
  | 'montage:failed'
  | 'montage:started'
  | 'post:sent'
  | 'post:failed'

export interface Notification {
  id:        string
  type:      NotifType
  workspaceId: string
  title:     string
  body:      string
  /** Optional navigation target for the client */
  link?:     string
  unread:    boolean
  createdAt: string  // ISO
}

// Per-workspace circular buffer: max 50 notifications
const MAX_PER_WS = 50
const store = new Map<string, Notification[]>()

// Per-workspace SSE subscriber set: res objects
const subscribers = new Map<string, Set<Response>>()

let seq = 0

function nextId() { return `notif_${Date.now()}_${++seq}` }

/** Push a new notification to a workspace and broadcast via SSE. */
export function push(
  workspaceId: string,
  type: NotifType,
  title: string,
  body: string,
  link?: string,
): Notification {
  const notif: Notification = {
    id: nextId(),
    type,
    workspaceId,
    title,
    body,
    link,
    unread: true,
    createdAt: new Date().toISOString(),
  }

  // Append to store
  if (!store.has(workspaceId)) store.set(workspaceId, [])
  const list = store.get(workspaceId)!
  list.push(notif)
  if (list.length > MAX_PER_WS) list.splice(0, list.length - MAX_PER_WS)

  // Broadcast to all SSE subscribers of this workspace
  const subs = subscribers.get(workspaceId)
  if (subs) {
    const data = `data: ${JSON.stringify(notif)}\n\n`
    for (const res of subs) {
      try { res.write(data) } catch { /* client disconnected */ }
    }
  }

  return notif
}

/** Get all stored notifications for a workspace (most recent first). */
export function getAll(workspaceId: string): Notification[] {
  return [...(store.get(workspaceId) ?? [])].reverse()
}

/** Mark specific notifications as read. Empty array = mark all. */
export function markRead(workspaceId: string, ids: string[]): void {
  const list = store.get(workspaceId)
  if (!list) return
  for (const n of list) {
    if (ids.length === 0 || ids.includes(n.id)) n.unread = false
  }
}

/** Register an SSE subscriber. Returns an unsubscribe function. */
export function subscribe(workspaceId: string, res: Response): () => void {
  if (!subscribers.has(workspaceId)) subscribers.set(workspaceId, new Set())
  subscribers.get(workspaceId)!.add(res)
  return () => {
    subscribers.get(workspaceId)?.delete(res)
  }
}
