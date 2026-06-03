import { Router } from 'express'
import { z } from 'zod'
import { v4 as uuid } from 'uuid'
import prisma from '../lib/prisma'
import { authenticate } from '../middleware/auth'
import { validate } from '../middleware/validate'

const router = Router()
router.use(authenticate)

const createSchema = z.object({
  name: z.string().min(2).max(64),
  slug: z.string().min(2).max(32).regex(/^[a-z0-9-]+$/),
})

/* ── GET /api/workspaces ── */
router.get('/', async (req, res) => {
  try {
    const memberships = await prisma.workspaceMember.findMany({
      where: { userId: req.user!.userId },
      include: {
        workspace: {
          include: { _count: { select: { tracks: true, bots: true, members: true } } },
        },
      },
    })
    res.json({ workspaces: memberships.map((m: { workspace: object; role: string }) => ({ ...m.workspace, myRole: m.role })) })
  } catch {
    res.status(500).json({ error: 'Internal server error' })
  }
})

/* ── POST /api/workspaces ── */
router.post('/', validate(createSchema), async (req, res) => {
  const { name, slug } = req.body
  try {
    const existing = await prisma.workspace.findUnique({ where: { slug } })
    if (existing) { res.status(409).json({ error: 'Slug already taken' }); return }

    const ws = await prisma.workspace.create({
      data: {
        id: uuid(),
        name,
        slug,
        ownerId: req.user!.userId,
        members: {
          create: { id: uuid(), userId: req.user!.userId, role: 'OWNER' as const },
        },
      },
      include: { _count: { select: { tracks: true, bots: true, members: true } } },
    })
    res.status(201).json({ workspace: ws })
  } catch {
    res.status(500).json({ error: 'Internal server error' })
  }
})

/* ── GET /api/workspaces/:id ── */
router.get('/:id', async (req, res) => {
  try {
    const member = await prisma.workspaceMember.findFirst({
      where: { workspaceId: req.params.id, userId: req.user!.userId },
    })
    if (!member) { res.status(404).json({ error: 'Workspace not found' }); return }

    const ws = await prisma.workspace.findUnique({
      where: { id: req.params.id },
      include: {
        members: { include: { user: { select: { id: true, email: true, displayName: true } } } },
        _count: { select: { tracks: true, bots: true } },
      },
    })
    res.json({ workspace: ws })
  } catch {
    res.status(500).json({ error: 'Internal server error' })
  }
})

/* ── POST /api/workspaces/:id/invite ── */
router.post('/:id/invite', async (req, res) => {
  const { email, role } = req.body as { email: string; role: 'MANAGER' | 'EDITOR' }
  try {
    const [member, targetUser] = await Promise.all([
      prisma.workspaceMember.findFirst({
        where: { workspaceId: req.params.id, userId: req.user!.userId, role: { in: ['OWNER', 'MANAGER'] } },
      }),
      prisma.user.findUnique({ where: { email } }),
    ])
    if (!member) { res.status(403).json({ error: 'Not authorized' }); return }
    if (!targetUser) { res.status(404).json({ error: 'User not found' }); return }

    const newMember = await prisma.workspaceMember.upsert({
      where: { workspaceId_userId: { workspaceId: req.params.id, userId: targetUser.id } },
      update: { role },
      create: { id: uuid(), workspaceId: req.params.id, userId: targetUser.id, role },
    })
    res.json({ member: newMember })
  } catch {
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
