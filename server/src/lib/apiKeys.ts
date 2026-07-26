import crypto from 'crypto'

/** All generated keys start with this so they can be spotted in logs / secret scanners. */
export const KEY_PREFIX = 'vbk_'

/** Number of visible characters kept in DB for display ("vbk_1a2b3c4d"). */
const PREFIX_LEN = 12

export function hashApiKey(raw: string): string {
  return crypto.createHash('sha256').update(raw.trim()).digest('hex')
}

/**
 * Generates a fresh API key. The raw value is returned once and never stored —
 * only its sha256 hash and a short display prefix are persisted.
 */
export function generateApiKey(): { raw: string; hash: string; prefix: string } {
  const raw = KEY_PREFIX + crypto.randomBytes(32).toString('base64url')
  return { raw, hash: hashApiKey(raw), prefix: raw.slice(0, PREFIX_LEN) }
}

export const ALL_SCOPES = ['library:read'] as const
export type Scope = typeof ALL_SCOPES[number]
