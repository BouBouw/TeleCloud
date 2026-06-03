import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
export type GlobalRole = 'ADMIN' | 'MOD' | 'USER'

export interface JwtPayload {
  userId: string
  email: string
  globalRole: GlobalRole
}

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload
    }
  }
}

export function authenticate(req: Request, res: Response, next: NextFunction): void {
  // Accept token from Authorization header OR ?token= query param
  // (query param needed for <audio src="..."> which can't send custom headers)
  const authHeader = req.headers.authorization
  const queryToken = typeof req.query.token === 'string' ? req.query.token : undefined
  const raw = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : queryToken

  if (!raw) {
    res.status(401).json({ error: 'No token provided' })
    return
  }

  const token = raw
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as JwtPayload
    req.user = payload
    next()
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' })
  }
}

export function requireRole(...roles: GlobalRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.globalRole)) {
      res.status(403).json({ error: 'Insufficient permissions' })
      return
    }
    next()
  }
}
