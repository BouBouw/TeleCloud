import 'dotenv/config'
import express from 'express'
import helmet from 'helmet'
import cors from 'cors'
import morgan from 'morgan'
import rateLimit from 'express-rate-limit'
import path from 'path'

import logger from './lib/logger'
import authRouter from './routes/auth'
import workspacesRouter from './routes/workspaces'
import tracksRouter from './routes/tracks'
import botsRouter from './routes/bots'
import galleryRouter from './routes/gallery'
import adminRouter from './routes/admin'
import montageRouter from './routes/montage'
import socialRouter from './routes/social'
import notificationsRouter from './routes/notifications'
import tunnelRouter from './routes/tunnel'
import convertRouter from './routes/convert'
import { montageQueue } from './services/montage/renderQueue'
import { startScheduler } from './services/social/scheduler'

const app = express()
const PORT = Number(process.env.PORT ?? 4000)

// Trust Nginx reverse proxy
app.set('trust proxy', 1)

// ── Security middleware ───────────────────────────────────────────────────────
app.use(helmet())
app.use(cors({
  origin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  credentials: true,
}))

// ── Rate limiting ─────────────────────────────────────────────────────────────
app.use(rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 600,                 // raised from 200 — long renders with polling need headroom
  standardHeaders: true,
  legacyHeaders: false,
  // Skip read-only endpoints that are polled continuously during renders/downloads.
  // They carry no sensitive data and don't mutate state, so rate-limiting them
  // only causes false-positive 429s on long operations.
  skip: (req) => {
    const p = req.path
    return p.endsWith('/status') || p.endsWith('/thumbnail') || p.endsWith('/stream')
      || p.startsWith('/api/tunnel/') // tunnel heartbeat + job polling
  },
}))
app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, max: 20 }))

// ── Body parsing ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }))
app.use(express.urlencoded({ extended: true }))

// ── Logging ───────────────────────────────────────────────────────────────────
app.use(morgan('dev', { stream: { write: msg => logger.http(msg.trim()) } }))

// ── Static storage (artwork etc.) ─────────────────────────────────────────────
app.use('/storage', express.static(path.resolve(process.env.STORAGE_PATH ?? './storage')))

// ── API routes ────────────────────────────────────────────────────────────────
app.use('/api/auth', authRouter)
app.use('/api/workspaces', workspacesRouter)
app.use('/api/workspaces/:wsId/tracks', tracksRouter)
app.use('/api/workspaces/:wsId/gallery', galleryRouter)
app.use('/api/workspaces/:wsId/bots', botsRouter)
app.use('/api/workspaces/:wsId/montage', montageRouter)
app.use('/api/workspaces/:wsId/social', socialRouter)
app.use('/api/workspaces/:wsId/notifications', notificationsRouter)
app.use('/api/admin', adminRouter)
app.use('/api/tunnel', tunnelRouter)
app.use('/api/workspaces/:wsId/convert', convertRouter)

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }))

// ── 404 handler ───────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'Not found' }))

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error('Unhandled error', { err: err.message })
  res.status(500).json({ error: 'Internal server error' })
})

app.listen(PORT, () => {
  logger.info(`🎵 Vibot API running on http://localhost:${PORT}`)
  montageQueue.start()
  startScheduler()
})

export default app
