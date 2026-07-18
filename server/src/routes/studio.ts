import { Router } from 'express'
import prisma from '../lib/prisma'
import { authenticate } from '../middleware/auth'

const router = Router({ mergeParams: true })
router.use(authenticate)

async function requireMember(wsId: string, userId: string) {
  const member = await prisma.workspaceMember.findFirst({ where: { workspaceId: wsId, userId } })
  if (!member) throw Object.assign(new Error('Not a member'), { status: 403 })
}

// ── GET /api/workspaces/:wsId/studio ── list projects (lightweight) ──────────
router.get('/', async (req, res) => {
  try {
    await requireMember(req.params.wsId, req.user!.userId)
    const projects = await prisma.studioProject.findMany({
      where: { workspaceId: req.params.wsId },
      select: { id: true, name: true, createdAt: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
      take: 60,
    })
    res.json({ projects })
  } catch (e: any) {
    res.status(e.status ?? 500).json({ error: e.message })
  }
})

// ── GET /api/workspaces/:wsId/studio/:id ── full project (with data) ─────────
router.get('/:id', async (req, res) => {
  try {
    await requireMember(req.params.wsId, req.user!.userId)
    const project = await prisma.studioProject.findFirst({
      where: { id: req.params.id, workspaceId: req.params.wsId },
    })
    if (!project) { res.status(404).json({ error: 'Project not found' }); return }
    res.json({ project })
  } catch (e: any) {
    res.status(e.status ?? 500).json({ error: e.message })
  }
})

// ── POST /api/workspaces/:wsId/studio ── create ─────────────────────────────
router.post('/', async (req, res) => {
  try {
    await requireMember(req.params.wsId, req.user!.userId)
    const { name, data } = req.body as { name?: string; data?: unknown }
    if (data == null) { res.status(400).json({ error: 'data is required' }); return }
    const project = await prisma.studioProject.create({
      data: {
        workspaceId: req.params.wsId,
        name: (name ?? 'Sans titre').slice(0, 120),
        data: typeof data === 'string' ? data : JSON.stringify(data),
      },
    })
    res.status(201).json({ project })
  } catch (e: any) {
    res.status(e.status ?? 500).json({ error: e.message })
  }
})

// ── PATCH /api/workspaces/:wsId/studio/:id ── update (autosave) ──────────────
router.patch('/:id', async (req, res) => {
  try {
    await requireMember(req.params.wsId, req.user!.userId)
    const existing = await prisma.studioProject.findFirst({
      where: { id: req.params.id, workspaceId: req.params.wsId },
      select: { id: true },
    })
    if (!existing) { res.status(404).json({ error: 'Project not found' }); return }
    const { name, data } = req.body as { name?: string; data?: unknown }
    const project = await prisma.studioProject.update({
      where: { id: req.params.id },
      data: {
        ...(name !== undefined && { name: name.slice(0, 120) }),
        ...(data !== undefined && { data: typeof data === 'string' ? data : JSON.stringify(data) }),
      },
    })
    res.json({ project })
  } catch (e: any) {
    res.status(e.status ?? 500).json({ error: e.message })
  }
})

// ── DELETE /api/workspaces/:wsId/studio/:id ──────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    await requireMember(req.params.wsId, req.user!.userId)
    await prisma.studioProject.deleteMany({ where: { id: req.params.id, workspaceId: req.params.wsId } })
    res.json({ ok: true })
  } catch (e: any) {
    res.status(e.status ?? 500).json({ error: e.message })
  }
})

export default router
