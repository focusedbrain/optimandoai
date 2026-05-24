import { createHash } from 'crypto'

/**
 * Returns the first 8 hex chars of SHA-256(input).
 * Use for logs to correlate the same key across lines without
 * leaking key material. The output is deterministic for the
 * same input and reveals no bytes of the input.
 */
export function fingerprint(input: string | null | undefined): string {
  if (!input) return '<none>'
  return createHash('sha256').update(input).digest('hex').slice(0, 8)
}
