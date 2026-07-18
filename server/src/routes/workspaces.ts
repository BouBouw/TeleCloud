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
    res.json({
      workspaces: memberships.map((m: { workspace: object; role: string; libSend?: boolean }) => ({
        ...m.workspace,
        myRole: m.role,
        myLibSend: m.role === 'owner' ? true : (m.libSend ?? true),
      }))
    })
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

/* ── GET /api/workspaces/:id/members ── */
router.get('/:id/members', async (req, res) => {
  try {
    const myMember = await prisma.workspaceMember.findFirst({
      where: { workspaceId: req.params.id, userId: req.user!.userId },
    })
    if (!myMember) { res.status(403).json({ error: 'Not a member of this workspace' }); return }

    const members = await prisma.workspaceMember.findMany({
      where: { workspaceId: req.params.id },
      include: { user: { select: { id: true, email: true, displayName: true } } },
      orderBy: { joinedAt: 'asc' },
    })
    res.json({ members })
  } catch {
    res.status(500).json({ error: 'Internal server error' })
  }
})

/* ── POST /api/workspaces/:id/members ── (add by email) */
router.post('/:id/members', async (req, res) => {
  const {
    email,
    canLibrary = true, canStudio = true, canMontage = true, canChannels = false,
    libRead = true, libWrite = true, libDelete = false, libSend = true,
    montageView = true, montageEdit = true, montageDelete = false,
    chanView = false, chanManage = false, chanDelete = false,
  } = req.body as {
    email: string
    canLibrary?: boolean; canStudio?: boolean; canMontage?: boolean; canChannels?: boolean
    libRead?: boolean; libWrite?: boolean; libDelete?: boolean; libSend?: boolean
    montageView?: boolean; montageEdit?: boolean; montageDelete?: boolean
    chanView?: boolean; chanManage?: boolean; chanDelete?: boolean
  }
  try {
    const [myMember, targetUser] = await Promise.all([
      prisma.workspaceMember.findFirst({
        where: { workspaceId: req.params.id, userId: req.user!.userId, role: 'OWNER' },
      }),
      prisma.user.findUnique({ where: { email } }),
    ])
    if (!myMember) { res.status(403).json({ error: 'Only the owner can add members' }); return }
    if (!targetUser) { res.status(404).json({ error: 'No account found with this email' }); return }
    if (targetUser.id === req.user!.userId) { res.status(400).json({ error: 'You are already a member' }); return }

    const permFields = { canLibrary, canStudio, canMontage, canChannels, libRead, libWrite, libDelete, libSend, montageView, montageEdit, montageDelete, chanView, chanManage, chanDelete }
    const member = await prisma.workspaceMember.upsert({
      where: { workspaceId_userId: { workspaceId: req.params.id, userId: targetUser.id } },
      update: permFields,
      create: { id: uuid(), workspaceId: req.params.id, userId: targetUser.id, role: 'EDITOR', ...permFields },
      include: { user: { select: { id: true, email: true, displayName: true } } },
    })
    res.status(201).json({ member })
  } catch {
    res.status(500).json({ error: 'Internal server error' })
  }
})

/* ── PATCH /api/workspaces/:id/members/:mid ── (update permissions) */
router.patch('/:id/members/:mid', async (req, res) => {
  const {
    canLibrary, canStudio, canMontage, canChannels,
    libRead, libWrite, libDelete, libSend,
    montageView, montageEdit, montageDelete,
    chanView, chanManage, chanDelete,
  } = req.body as {
    canLibrary?: boolean; canStudio?: boolean; canMontage?: boolean; canChannels?: boolean
    libRead?: boolean; libWrite?: boolean; libDelete?: boolean; libSend?: boolean
    montageView?: boolean; montageEdit?: boolean; montageDelete?: boolean
    chanView?: boolean; chanManage?: boolean; chanDelete?: boolean
  }
  try {
    const myMember = await prisma.workspaceMember.findFirst({
      where: { workspaceId: req.params.id, userId: req.user!.userId, role: 'OWNER' },
    })
    if (!myMember) { res.status(403).json({ error: 'Only the owner can change permissions' }); return }

    const target = await prisma.workspaceMember.findFirst({
      where: { id: req.params.mid, workspaceId: req.params.id },
    })
    if (!target) { res.status(404).json({ error: 'Member not found' }); return }
    if (target.role === 'OWNER') { res.status(400).json({ error: 'Cannot change owner permissions' }); return }

    const updated = await prisma.workspaceMember.update({
      where: { id: req.params.mid },
      data: {
        ...(canLibrary     !== undefined && { canLibrary }),
        ...(canStudio      !== undefined && { canStudio }),
        ...(canMontage     !== undefined && { canMontage }),
        ...(canChannels    !== undefined && { canChannels }),
        ...(libRead        !== undefined && { libRead }),
        ...(libWrite       !== undefined && { libWrite }),
        ...(libDelete      !== undefined && { libDelete }),
        ...(libSend        !== undefined && { libSend }),
        ...(montageView    !== undefined && { montageView }),
        ...(montageEdit    !== undefined && { montageEdit }),
        ...(montageDelete  !== undefined && { montageDelete }),
        ...(chanView       !== undefined && { chanView }),
        ...(chanManage     !== undefined && { chanManage }),
        ...(chanDelete     !== undefined && { chanDelete }),
      },
      include: { user: { select: { id: true, email: true, displayName: true } } },
    })
    res.json({ member: updated })
  } catch {
    res.status(500).json({ error: 'Internal server error' })
  }
})

/* ── DELETE /api/workspaces/:id/members/:mid ── */
router.delete('/:id/members/:mid', async (req, res) => {
  try {
    const myMember = await prisma.workspaceMember.findFirst({
      where: { workspaceId: req.params.id, userId: req.user!.userId, role: 'OWNER' },
    })
    if (!myMember) { res.status(403).json({ error: 'Only the owner can remove members' }); return }

    const target = await prisma.workspaceMember.findFirst({
      where: { id: req.params.mid, workspaceId: req.params.id },
    })
    if (!target) { res.status(404).json({ error: 'Member not found' }); return }
    if (target.role === 'OWNER') { res.status(400).json({ error: 'Cannot remove the owner' }); return }

    await prisma.workspaceMember.delete({ where: { id: req.params.mid } })
    res.json({ ok: true })
  } catch {
    res.status(500).json({ error: 'Internal server error' })
  }
})

/* ── GET /api/workspaces/:id/users/search?q=... ── */
router.get('/:id/users/search', async (req, res) => {
  const q = String(req.query.q ?? '').trim()
  if (q.length < 2) { res.json({ users: [] }); return }
  try {
    const myMember = await prisma.workspaceMember.findFirst({
      where: { workspaceId: req.params.id, userId: req.user!.userId },
    })
    if (!myMember) { res.status(403).json({ error: 'Not authorized' }); return }

    const existingIds = (await prisma.workspaceMember.findMany({
      where: { workspaceId: req.params.id },
      select: { userId: true },
    })).map((m: { userId: string }) => m.userId)

    const users = await prisma.user.findMany({
      where: {
        id: { notIn: existingIds },
        OR: [
          { email:       { contains: q, mode: 'insensitive' } },
          { displayName: { contains: q, mode: 'insensitive' } },
        ],
      },
      select: { id: true, email: true, displayName: true },
      take: 10,
    })
    res.json({ users })
  } catch {
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
