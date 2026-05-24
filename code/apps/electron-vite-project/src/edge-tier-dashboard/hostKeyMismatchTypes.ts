/**
 * SSH host key mismatch payloads from main process — P4.5.13.
 */

export interface HostKeyMismatchPayload {
  readonly code: 'HOST_KEY_MISMATCH'
  readonly host: string
  readonly port: number
  readonly key_type: string
  readonly stored_fingerprint: string
  readonly observed_fingerprint: string
  readonly stored_fingerprint_display: string
  readonly observed_fingerprint_display: string
  readonly message: string
}

export const HOST_KEY_TRUST_CONFIRM = 'TRUST'

export function parseHostKeyMismatch(value: unknown): HostKeyMismatchPayload | null {
  if (typeof value !== 'object' || value === null) return null
  const o = value as Record<string, unknown>
  if (o.code !== 'HOST_KEY_MISMATCH') return null
  if (typeof o.host !== 'string' || typeof o.port !== 'number') return null
  if (typeof o.stored_fingerprint_display !== 'string' || typeof o.observed_fingerprint_display !== 'string') {
    return null
  }
  return o as HostKeyMismatchPayload
}

export function extractHostKeyMismatch(result: unknown): HostKeyMismatchPayload | null {
  if (typeof result !== 'object' || result === null) return null
  return parseHostKeyMismatch((result as Record<string, unknown>).hostKeyMismatch)
}
