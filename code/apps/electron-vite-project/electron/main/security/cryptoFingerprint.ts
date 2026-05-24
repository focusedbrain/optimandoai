import { createHash } from 'crypto'

/** Non-secret 8-hex-sha256 fingerprint for logs (never log raw key material). */
export function safeFingerprint(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 8)
}
