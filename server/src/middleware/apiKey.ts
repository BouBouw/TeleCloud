import { Request, Response, NextFunction } from 'express'
import prisma from '../lib/prisma'
import { hashApiKey } from '../lib/apiKeys'
import logger from '../lib/logger'

export interface ApiKeyContext {
  id: string
  name: string
  userId: string
  /** null = the key covers every workspace the owner is a member of */
  workspaceId: string | null
  scopes: string[]
}

declare global {
  namespace Express {
    interface Request {
      apiKey?: ApiKeyContext
    }
  }
}

/**
 * Accepts the key from (in order):
 *   X-API-Key: vbk_...
 *   Authorization: Bearer vbk_...
 *   ?api_key=vbk_...   (needed for plain <a href> downloads and <audio src>)
 */
function extractKey(req: Request): string | undefined {
  const header = req.headers['x-api-key']
  if (typeof header === 'string' && header.trim()) return header.trim()

  const auth = req.headers.authorization
  if (auth?.startsWith('Bearer ')) {
    const v = auth.slice(7).trim()
    if (v) return v
  }

  const q = req.query.api_key ?? req.query.key
  if (typeof q === 'string' && q.trim()) return q.trim()

  return undefined
}

/** Only bump lastUsedAt once a minute per key — avoids a write on every request. */
const TOUCH_INTERVAL_MS = 60_000

export async function authenticateApiKey(req: Request, res: Response, next: NextFunction): Promise<void> {
  const raw = extractKey(req)
  if (!raw) {
    res.status(401).json({ error: 'Missing API key. Send it as X-API-Key, Authorization: Bearer, or ?api_key=' })
    return
  }

  let key
  try {
    key = await prisma.apiKey.findUnique({ where: { keyHash: hashApiKey(raw) } })
  } catch (e) {
    logger.error('API key lookup failed', { err: String(e) })
    res.status(500).json({ error: 'Internal server error' })
    return
  }

  if (!key || key.revokedAt) {
    res.status(401).json({ error: 'Invalid or revoked API key' })
    return
  }
  if (key.expiresAt && key.expiresAt.getTime() < Date.now()) {
    res.status(401).json({ error: 'Expired API key' })
    return
  }

  req.apiKey = {
    id: key.id,
    name: key.name,
    userId: key.userId,
    workspaceId: key.workspaceId,
    scopes: key.scopes.split(',').map(s => s.trim()).filter(Boolean),
  }

  if (!key.lastUsedAt || Date.now() - key.lastUsedAt.getTime() > TOUCH_INTERVAL_MS) {
    prisma.apiKey
      .update({ where: { id: key.id }, data: { lastUsedAt: new Date() } })
      .catch(() => { /* non-critical */ })
  }

  next()
}

export function requireScope(scope: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.apiKey?.scopes.includes(scope)) {
      res.status(403).json({ error: `API key is missing the "${scope}" scope` })
      return
    }
    next()
  }
}
