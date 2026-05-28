/**
 * Session-scoped consent tokens for host PDF extraction (Workstream 4 issues; WS3 verifies).
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto'

let sessionSecret = randomBytes(32)
const TOKEN_TTL_MS = 15 * 60 * 1000

export interface IssuedPdfConsentToken {
  token: string
  expiresAt: string
}

export function issuePdfExtractionConsentToken(
  messageId: string,
  attachmentId: string,
): IssuedPdfConsentToken {
  const expiresAtMs = Date.now() + TOKEN_TTL_MS
  const payload = `${messageId}|${attachmentId}|${expiresAtMs}`
  const sig = createHmac('sha256', sessionSecret).update(payload, 'utf8').digest('base64url')
  const token = Buffer.from(`${payload}|${sig}`, 'utf8').toString('base64url')
  return { token, expiresAt: new Date(expiresAtMs).toISOString() }
}

export function verifyPdfExtractionConsentToken(
  token: string,
  messageId: string,
  attachmentId: string,
): boolean {
  if (!token || typeof token !== 'string') return false
  let decoded: string
  try {
    decoded = Buffer.from(token, 'base64url').toString('utf8')
  } catch {
    return false
  }
  const parts = decoded.split('|')
  if (parts.length !== 4) return false
  const [msg, att, expStr, sig] = parts
  if (msg !== messageId || att !== attachmentId) return false
  const exp = Number(expStr)
  if (!Number.isFinite(exp) || Date.now() > exp) return false
  const expected = createHmac('sha256', sessionSecret)
    .update(`${msg}|${att}|${expStr}`, 'utf8')
    .digest('base64url')
  try {
    return timingSafeEqual(Buffer.from(sig ?? '', 'utf8'), Buffer.from(expected, 'utf8'))
  } catch {
    return false
  }
}

export function hashConsentTokenForAudit(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

/** Test-only: replace session secret for deterministic tokens. */
export function _setPdfConsentSessionSecretForTests(secret: Buffer): void {
  sessionSecret = Buffer.alloc(32)
  secret.copy(sessionSecret, 0, 0, Math.min(secret.length, 32))
}
