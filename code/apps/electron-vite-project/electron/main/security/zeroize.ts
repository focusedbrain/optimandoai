/**
 * In-memory secret zeroing — P4.5.12.
 *
 * JS strings are immutable and cannot be overwritten; use Buffer for secrets
 * from the IPC boundary onward.
 */

const DEBUG = process.env['WRDESK_CREDENTIAL_ZEROIZE_DEBUG'] === '1'

export function zeroizeBuffer(b: Buffer | null | undefined): void {
  if (b && Buffer.isBuffer(b)) {
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
  try {
    return await fn(cred)
  } finally {
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
