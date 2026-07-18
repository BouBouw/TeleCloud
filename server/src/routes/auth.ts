import { Router } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { z } from 'zod'
import prisma from '../lib/prisma'
import { validate } from '../middleware/validate'
import { authenticate, GlobalRole } from '../middleware/auth'
import { v4 as uuid } from 'uuid'
import { removeBotContainer, pauseBotContainer } from '../services/docker'

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

    if (user.deactivatedAt) { res.status(403).json({ error: 'Account deactivated', deactivated: true }); return }

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

/* ── POST /api/auth/tiktok/callback ── exchange TikTok OAuth code ── */
router.post('/tiktok/callback', async (req, res) => {
  const { code, state } = req.body as { code?: string; state?: string }
  if (!code || !state) { res.status(400).json({ error: 'code et state requis' }); return }

  let payload: { wsId: string; userId: string }
  try {
    payload = jwt.verify(state, process.env.JWT_SECRET!) as { wsId: string; userId: string }
  } catch {
    res.status(400).json({ error: 'State invalide ou expiré. Recommencez la connexion.' }); return
  }

  try {
    const tokenRes = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cache-Control': 'no-cache' },
      body: new URLSearchParams({
        client_key:    process.env.TIKTOK_CLIENT_KEY ?? '',
        client_secret: process.env.TIKTOK_CLIENT_SECRET ?? '',
        code,
        grant_type:   'authorization_code',
        redirect_uri:  process.env.TIKTOK_REDIRECT_URI ?? 'https://vibot.cloud/auth/redirect',
      }).toString(),
    })
    const tokenData = await tokenRes.json() as Record<string, unknown>
    if (!tokenData.access_token) {
      res.status(400).json({ error: (tokenData.error_description as string) ?? 'Échange de token TikTok échoué' })
      return
    }

    let displayName = 'Compte TikTok'
    let openId = ''
    try {
      const userRes = await fetch(
        'https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name',
        { headers: { Authorization: `Bearer ${tokenData.access_token}` } },
      )
      const userData = await userRes.json() as { data?: { user?: { open_id?: string; display_name?: string } } }
      displayName = userData.data?.user?.display_name ?? 'Compte TikTok'
      openId      = userData.data?.user?.open_id      ?? ''
    } catch { /* use defaults */ }

    await prisma.socialAccount.create({
      data: {
        id:           uuid(),
        workspaceId:  payload.wsId,
        platform:     'TIKTOK',
        accountName:  displayName,
        accountId:    openId || null,
        accessToken:  tokenData.access_token as string,
        refreshToken: (tokenData.refresh_token as string | undefined) ?? null,
        expiresAt:    tokenData.expires_in
          ? new Date(Date.now() + (tokenData.expires_in as number) * 1000)
          : null,
      },
    })

    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur lors de la connexion TikTok' })
  }
})

/* ── POST /api/auth/account/deactivate ── */
router.post('/account/deactivate', authenticate, async (req, res) => {
  const { password } = req.body as { password?: string }
  if (!password) { res.status(400).json({ error: 'Mot de passe requis' }); return }

  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.userId } })
    if (!user) { res.status(404).json({ error: 'User not found' }); return }

    const valid = await bcrypt.compare(password, user.passwordHash)
    if (!valid) { res.status(401).json({ error: 'Mot de passe incorrect' }); return }

    // Pause all running bots
    const bots = await prisma.bot.findMany({
      where: { workspace: { ownerId: user.id }, status: 'running', containerId: { not: null } },
    })
    await Promise.allSettled(bots.map(async bot => {
      try {
        await pauseBotContainer(bot.containerId!)
        await prisma.bot.update({ where: { id: bot.id }, data: { status: 'paused' } })
      } catch { /* ignore container errors */ }
    }))

    // Mark account deactivated + revoke all sessions
    await prisma.user.update({ where: { id: user.id }, data: { deactivatedAt: new Date() } })
    await prisma.refreshToken.deleteMany({ where: { userId: user.id } })

    res.json({ message: 'Account deactivated' })
  } catch {
    res.status(500).json({ error: 'Internal server error' })
  }
})

/* ── POST /api/auth/account/reactivate ── */
router.post('/account/reactivate', async (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string }
  if (!email || !password) { res.status(400).json({ error: 'Email et mot de passe requis' }); return }

  try {
    const user = await prisma.user.findUnique({ where: { email } })
    if (!user) { res.status(401).json({ error: 'Invalid credentials' }); return }

    const valid = await bcrypt.compare(password, user.passwordHash)
    if (!valid) { res.status(401).json({ error: 'Invalid credentials' }); return }

    await prisma.user.update({ where: { id: user.id }, data: { deactivatedAt: null } })

    const refreshToken = await prisma.refreshToken.create({
      data: { id: uuid(), token: uuid() + uuid(), userId: user.id, expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) },
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

/* ── DELETE /api/auth/account ── */
router.delete('/account', authenticate, async (req, res) => {
  const { password, confirmation } = req.body as { password?: string; confirmation?: string }
  if (!password) { res.status(400).json({ error: 'Mot de passe requis' }); return }
  if (confirmation !== 'SUPPRIMER') { res.status(400).json({ error: 'Confirmation invalide' }); return }

  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.userId } })
    if (!user) { res.status(404).json({ error: 'User not found' }); return }

    const valid = await bcrypt.compare(password, user.passwordHash)
    if (!valid) { res.status(401).json({ error: 'Mot de passe incorrect' }); return }

    // Stop & remove all bot containers
    const bots = await prisma.bot.findMany({
      where: { workspace: { ownerId: user.id }, containerId: { not: null } },
    })
    await Promise.allSettled(bots.map(async bot => {
      try { await removeBotContainer(bot.containerId!) } catch { /* ignore */ }
    }))

    // Delete all owned workspaces (cascades to bots, tracks, library, montage...)
    await prisma.workspace.deleteMany({ where: { ownerId: user.id } })
    // Delete user (cascades to memberships, refresh tokens)
    await prisma.user.delete({ where: { id: user.id } })

    res.json({ message: 'Account deleted' })
  } catch {
    res.status(500).json({ error: 'Internal server error' })
  }
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
