/**
 * Social account routes: /api/workspaces/:wsId/social
 */
import { Router } from 'express'
import { z } from 'zod'
import { v4 as uuid } from 'uuid'
import prisma from '../lib/prisma'
import { authenticate } from '../middleware/auth'
import { validate } from '../middleware/validate'

const router = Router({ mergeParams: true })
router.use(authenticate)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Req = any

export const PLATFORMS = [
  'TIKTOK', 'INSTAGRAM', 'YOUTUBE', 'TWITTER',
  'FACEBOOK', 'SNAPCHAT', 'LINKEDIN', 'PINTEREST',
] as const
export type SocialPlatform = typeof PLATFORMS[number]

async function requireMember(wsId: string, userId: string) {
  const member = await prisma.workspaceMember.findFirst({ where: { workspaceId: wsId, userId } })
  if (!member) throw Object.assign(new Error('Not a member'), { status: 403 })
}

// ── GET /api/workspaces/:wsId/social/accounts ── list connected accounts ──────
router.get('/accounts', async (req, res) => {
  try {
    await requireMember(req.params.wsId, req.user!.userId)
    const accounts = await prisma.socialAccount.findMany({
      where: { workspaceId: req.params.wsId },
      select: {
        id: true, platform: true, accountName: true, accountLabel: true,
        accountId: true, createdAt: true,
      },
      orderBy: [{ platform: 'asc' }, { createdAt: 'asc' }],
    })
    res.json({ accounts })
  } catch (e: any) {
    res.status(e.status ?? 500).json({ error: e.message })
  }
})

// ── POST /api/workspaces/:wsId/social/:platform/connect ── add account ─────────
const connectSchema = z.object({
  accountName:  z.string().min(1).max(100),
  accountLabel: z.string().max(60).optional(),
  accessToken:  z.string().min(1),
  refreshToken: z.string().optional(),
  accountId:    z.string().optional(),
})

router.post('/:platform/connect', validate(connectSchema), async (req, res) => {
  try {
    await requireMember(req.params.wsId, req.user!.userId)
    const platform = req.params.platform.toUpperCase()
    if (!(PLATFORMS as readonly string[]).includes(platform)) {
      res.status(400).json({ error: `Plateforme invalide. Doit être: ${PLATFORMS.join(', ')}` })
      return
    }
    const { accountName, accountLabel, accessToken, refreshToken, accountId } = req.body
    const account = await prisma.socialAccount.create({
      data: {
        id: uuid(),
        workspaceId: req.params.wsId,
        platform,
        accountName,
        accountLabel: accountLabel ?? null,
        accountId: accountId ?? null,
        accessToken,
        refreshToken: refreshToken ?? null,
      },
      select: {
        id: true, platform: true, accountName: true, accountLabel: true,
        accountId: true, createdAt: true,
      },
    })
    res.json({ account })
  } catch (e: any) {
    res.status(e.status ?? 500).json({ error: e.message })
  }
})

// ── PATCH /api/workspaces/:wsId/social/accounts/:accountId ── update token ─────
const updateSchema = z.object({
  accountName:  z.string().min(1).max(100).optional(),
  accountLabel: z.string().max(60).optional(),
  accessToken:  z.string().min(1).optional(),
  refreshToken: z.string().optional(),
})

router.patch('/accounts/:accountId', validate(updateSchema), async (req, res) => {
  try {
    await requireMember(req.params.wsId, req.user!.userId)
    const account = await prisma.socialAccount.findFirst({
      where: { id: req.params.accountId, workspaceId: req.params.wsId },
    })
    if (!account) { res.status(404).json({ error: 'Compte introuvable' }); return }

    const { accountName, accountLabel, accessToken, refreshToken } = req.body
    const updated = await prisma.socialAccount.update({
      where: { id: req.params.accountId },
      data: {
        ...(accountName  !== undefined && { accountName }),
        ...(accountLabel !== undefined && { accountLabel }),
        ...(accessToken  !== undefined && { accessToken }),
        ...(refreshToken !== undefined && { refreshToken }),
        updatedAt: new Date(),
      },
      select: {
        id: true, platform: true, accountName: true, accountLabel: true,
        accountId: true, createdAt: true,
      },
    })
    res.json({ account: updated })
  } catch (e: any) {
    res.status(e.status ?? 500).json({ error: e.message })
  }
})

// ── DELETE /api/workspaces/:wsId/social/accounts/:accountId ── disconnect ──────
router.delete('/accounts/:accountId', async (req, res) => {
  try {
    await requireMember(req.params.wsId, req.user!.userId)
    await prisma.socialAccount.deleteMany({
      where: { id: req.params.accountId, workspaceId: req.params.wsId },
    })
    res.json({ ok: true })
  } catch (e: any) {
    res.status(e.status ?? 500).json({ error: e.message })
  }
})

export default router
