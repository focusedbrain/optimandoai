/**
 * In-memory secret zeroing — P4.5.12 / P4.5.15.
 *
 * JS strings are immutable and cannot be overwritten; use Buffer for secrets
 * from the IPC boundary onward.
 *
 * withCredential() zeroes buffers on exit. When libsodium sodium_malloc +
 * sodium_mlock are available, the callback receives a locked copy; otherwise
 * the original pageable Buffer is used. Residual swap-to-disk exposure on
 * plain Buffer paths is documented in credential-security-threat-model.md.
 */

import {
  duplicateCredentialForScope,
  initSecureMemory,
  memzeroBufferIfAvailable,
  releaseScopedCredential,
} from './secureMemory.js'

const DEBUG = process.env['WRDESK_CREDENTIAL_ZEROIZE_DEBUG'] === '1'

export function zeroizeBuffer(b: Buffer | null | undefined): void {
  if (!b || !Buffer.isBuffer(b)) return
  if (!memzeroBufferIfAvailable(b)) {
    b.fill(0)
  }
}

export function zeroizeString(s: string | undefined): void {
  if (s && s.length > 0 && DEBUG) {
    console.debug(
      '[credential-zeroize] zeroizeString called — JS strings cannot be zeroed; refactor to Buffer',
    )
  }
}

export async function withCredential<T>(
  cred: Buffer,
  fn: (cred: Buffer) => Promise<T>,
): Promise<T> {
  await initSecureMemory()
  const scoped = duplicateCredentialForScope(cred)
  try {
    return await fn(scoped.buffer)
  } finally {
    releaseScopedCredential(scoped)
    zeroizeBuffer(cred)
  }
}

const _credentialClearers = new Set<() => void>()

export function registerCredentialClearer(clearer: () => void): () => void {
  _credentialClearers.add(clearer)
  return () => {
    _credentialClearers.delete(clearer)
  }
}

export function zeroizeAllRegisteredCredentials(): void {
  for (const clearer of _credentialClearers) {
    try {
      clearer()
    } catch {
      /* best-effort shutdown */
    }
  }
}

export { initSecureMemory } from './secureMemory.js'
