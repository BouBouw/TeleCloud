import { Router } from 'express'
import fs from 'fs'
import path from 'path'
import prisma from '../lib/prisma'
import { authenticate, requireRole, GlobalRole } from '../middleware/auth'

const STORAGE_ROOT = path.resolve(process.env.STORAGE_PATH ?? './storage')

function dirSizeSync(dir: string): number {
  let total = 0
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const e of entries) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) total += dirSizeSync(full)
      else if (e.isFile()) total += fs.statSync(full).size
    }
  } catch { /* ignore permission errors */ }
  return total
}

const router = Router()
router.use(authenticate, requireRole('ADMIN'))

/* ── GET /api/admin/users ── */
router.get('/users', async (_req, res) => {
  try {
    const users = await prisma.user.findMany({
      select: { id: true, email: true, displayName: true, globalRole: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    })
    res.json({ users })
  } catch {
    res.status(500).json({ error: 'Internal server error' })
  }
})

/* ── PATCH /api/admin/users/:id/role ── */
router.patch('/users/:id/role', async (req, res) => {
  const { globalRole } = req.body
  const validRoles: GlobalRole[] = ['ADMIN', 'MOD', 'USER']
  if (!validRoles.includes(globalRole as GlobalRole)) {
    res.status(400).json({ error: 'Invalid role' }); return
  }
  try {
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: { globalRole },
      select: { id: true, email: true, globalRole: true },
    })
    res.json({ user })
  } catch {
    res.status(500).json({ error: 'Internal server error' })
  }
})

/* ── GET /api/admin/stats ── */
router.get('/stats', async (_req, res) => {
  try {
    const [userCount, workspaceCount, trackCount, botCount] = await Promise.all([
      prisma.user.count(),
      prisma.workspace.count(),
      prisma.track.count(),
      prisma.bot.count(),
    ])
    const activeBots    = await prisma.bot.count({ where: { status: 'running' } })
    const uptimeSeconds = Math.floor(process.uptime())
    const storageBytes  = dirSizeSync(STORAGE_ROOT)
    const maxStorageBytes = Number(process.env.MAX_STORAGE_BYTES ?? 10_737_418_240)
    res.json({ userCount, workspaceCount, trackCount, botCount, activeBots, uptimeSeconds, storageBytes, maxStorageBytes })
  } catch {
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
