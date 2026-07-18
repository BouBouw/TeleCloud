import { Router } from 'express'
import { authenticate } from '../middleware/auth'
import * as notifs from '../services/notifications'

interface WsParams { wsId: string; [key: string]: string }

const router = Router({ mergeParams: true })
router.use(authenticate)

/**
 * GET /api/workspaces/:wsId/notifications
 * Returns stored notifications (newest first).
 */
router.get<WsParams>('/', (req, res) => {
  const { wsId } = req.params
  res.json({ notifications: notifs.getAll(wsId) })
})

/**
 * PATCH /api/workspaces/:wsId/notifications/read
 * Body: { ids: string[] }  — empty array = mark all read
 */
router.patch<WsParams>('/read', (req, res) => {
  const { wsId } = req.params
  const ids: string[] = Array.isArray(req.body.ids) ? req.body.ids : []
  notifs.markRead(wsId, ids)
  res.json({ ok: true })
})

/**
 * GET /api/workspaces/:wsId/notifications/stream
 * SSE endpoint — keeps connection open and pushes events.
 * Auth token accepted via ?token= query param (EventSource can't set headers).
 */
router.get<WsParams>('/stream', (req, res) => {
  const { wsId } = req.params

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no') // disable nginx buffering
  res.flushHeaders()

  // Send a heartbeat comment every 25s to keep the connection alive through proxies
  const heartbeat = setInterval(() => {
    try { res.write(': heartbeat\n\n') } catch { cleanup() }
  }, 25_000)

  const unsub = notifs.subscribe(wsId, res)

  function cleanup() {
    clearInterval(heartbeat)
    unsub()
  }

  req.on('close', cleanup)
  req.on('error', cleanup)
})

export default router
