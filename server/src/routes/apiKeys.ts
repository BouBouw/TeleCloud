import { Router } from 'express'
import prisma from '../lib/prisma'
import { authenticate } from '../middleware/auth'
import { generateApiKey, ALL_SCOPES } from '../lib/apiKeys'
import logger from '../lib/logger'

const router = Router()
router.use(authenticate)

/** Hard cap so a runaway script can't fill the table. */
const MAX_KEYS_PER_USER = 20

interface KeyParams { keyId: string; [key: string]: string }

/** Shape sent to the client — never contains the secret. */
function publicKey(k: {
  id: string; name: string; prefix: string; workspaceId: string | null; scopes: string
  lastUsedAt: Date | null; expiresAt: Date | null; createdAt: Date
}) {
  return {
    id: k.id,
    name: k.name,
    prefix: k.prefix,
    workspaceId: k.workspaceId,
    scopes: k.scopes.split(',').map(s => s.trim()).filter(Boolean),
    lastUsedAt: k.lastUsedAt,
    expiresAt: k.expiresAt,
    createdAt: k.createdAt,
  }
}

// ── GET /api/keys ────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const keys = await prisma.apiKey.findMany({
      where: { userId: req.user!.userId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    })
    res.json({ keys: keys.map(publicKey) })
  } catch (e) {
    logger.error('List API keys failed', { err: String(e) })
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ── POST /api/keys ───────────────────────────────────────────────────────────
// Returns the raw secret exactly once — it is not recoverable afterwards.
router.post('/', async (req, res) => {
  const userId = req.user!.userId
  const { name, workspaceId, expiresInDays } = req.body as {
    name?: unknown; workspaceId?: unknown; expiresInDays?: unknown
  }

  const cleanName = typeof name === 'string' && name.trim()
    ? name.trim().slice(0, 60)
    : 'Clé d\'export'

  let scopedWorkspaceId: string | null = null
  if (typeof workspaceId === 'string' && workspaceId) {
    const member = await prisma.workspaceMember.findFirst({ where: { workspaceId, userId } })
    if (!member) { res.status(403).json({ error: 'Not a member of this workspace' }); return }
    scopedWorkspaceId = workspaceId
  }

  let expiresAt: Date | null = null
  if (expiresInDays !== undefined && expiresInDays !== null && expiresInDays !== '') {
    const days = Number(expiresInDays)
    if (!Number.isFinite(days) || days <= 0 || days > 3650) {
      res.status(400).json({ error: 'expiresInDays must be between 1 and 3650' })
      return
    }
    expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000)
  }

  try {
    const count = await prisma.apiKey.count({ where: { userId, revokedAt: null } })
    if (count >= MAX_KEYS_PER_USER) {
      res.status(400).json({ error: `Limite de ${MAX_KEYS_PER_USER} cles atteinte — supprimes-en une d'abord` })
      return
    }

    const { raw, hash, prefix } = generateApiKey()
    const key = await prisma.apiKey.create({
      data: {
        userId,
        name: cleanName,
        keyHash: hash,
        prefix,
        workspaceId: scopedWorkspaceId,
        scopes: ALL_SCOPES.join(','),
        expiresAt,
      },
    })

    res.status(201).json({ key: publicKey(key), secret: raw })
  } catch (e) {
    logger.error('Create API key failed', { err: String(e) })
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ── DELETE /api/keys/:keyId ──────────────────────────────────────────────────
router.delete<KeyParams>('/:keyId', async (req, res) => {
  try {
    const key = await prisma.apiKey.findFirst({
      where: { id: req.params.keyId, userId: req.user!.userId },
    })
    if (!key) { res.status(404).json({ error: 'Key not found' }); return }

    await prisma.apiKey.delete({ where: { id: key.id } })
    res.json({ ok: true })
  } catch (e) {
    logger.error('Delete API key failed', { err: String(e) })
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
