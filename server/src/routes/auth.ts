import { Router } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { z } from 'zod'
import prisma from '../lib/prisma'
import { validate } from '../middleware/validate'
import { authenticate, GlobalRole } from '../middleware/auth'
import { v4 as uuid } from 'uuid'

const router = Router()

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  displayName: z.string().min(2).max(64),
})

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

function signAccess(userId: string, email: string, globalRole: string) {
  return jwt.sign(
    { userId, email, globalRole },
    process.env.JWT_SECRET!,
    { expiresIn: process.env.JWT_EXPIRES_IN ?? '7d' } as jwt.SignOptions,
  )
}

/* ── POST /api/auth/register ── */
router.post('/register', validate(registerSchema), async (req, res) => {
  const { email, password, displayName } = req.body
  try {
    const exists = await prisma.user.findUnique({ where: { email } })
    if (exists) { res.status(409).json({ error: 'Email already in use' }); return }

    const passwordHash = await bcrypt.hash(password, 12)
    const user = await prisma.user.create({
      data: { id: uuid(), email, passwordHash, displayName },
      select: { id: true, email: true, displayName: true, globalRole: true },
    })

    const accessToken = signAccess(user.id, user.email, user.globalRole as GlobalRole)
    res.status(201).json({ user, accessToken })
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' })
  }
})

/* ── POST /api/auth/login ── */
router.post('/login', validate(loginSchema), async (req, res) => {
  const { email, password } = req.body
  try {
    const user = await prisma.user.findUnique({ where: { email } })
    if (!user) { res.status(401).json({ error: 'Invalid credentials' }); return }

    const valid = await bcrypt.compare(password, user.passwordHash)
    if (!valid) { res.status(401).json({ error: 'Invalid credentials' }); return }

    // Refresh token
    const refreshToken = await prisma.refreshToken.create({
      data: {
        id: uuid(),
        token: uuid() + uuid(),
        userId: user.id,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    })

    const accessToken = signAccess(user.id, user.email, user.globalRole as GlobalRole)
    res.json({
      user: { id: user.id, email: user.email, displayName: user.displayName, globalRole: user.globalRole },
      accessToken,
      refreshToken: refreshToken.token,
    })
  } catch {
    res.status(500).json({ error: 'Internal server error' })
  }
})

/* ── POST /api/auth/refresh ── */
router.post('/refresh', async (req, res) => {
  const { refreshToken } = req.body
  if (!refreshToken) { res.status(400).json({ error: 'refreshToken required' }); return }

  try {
    const stored = await prisma.refreshToken.findUnique({
      where: { token: refreshToken },
      include: { user: true },
    })
    if (!stored || stored.expiresAt < new Date()) {
      res.status(401).json({ error: 'Invalid or expired refresh token' }); return
    }

    const accessToken = signAccess(stored.user.id, stored.user.email, stored.user.globalRole as GlobalRole)
    res.json({ accessToken })
  } catch {
    res.status(500).json({ error: 'Internal server error' })
  }
})

/* ── POST /api/auth/logout ── */
router.post('/logout', authenticate, async (req, res) => {
  const { refreshToken } = req.body
  if (refreshToken) {
    await prisma.refreshToken.deleteMany({ where: { token: refreshToken } }).catch(() => {})
  }
  res.json({ message: 'Logged out' })
})

/* ── GET /api/auth/me ── */
router.get('/me', authenticate, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: { id: true, email: true, displayName: true, globalRole: true, createdAt: true },
    })
    if (!user) { res.status(404).json({ error: 'User not found' }); return }
    res.json({ user })
  } catch {
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
