/**
 * Secure Storage for Email OAuth Tokens
 *
 * Uses Electron's safeStorage API (Windows DPAPI, macOS Keychain, etc.).
 * **Persists secrets only when encryption is available** — no silent plaintext fallback.
 *
 * Enable verbose probes: `DEBUG_EMAIL_SECURE_STORAGE=1`
 */

import { safeStorage } from 'electron'

/** Gated diagnostics for DPAPI / safeStorage issues on Windows and other platforms. */
export const DEBUG_EMAIL_SECURE_STORAGE = process.env.DEBUG_EMAIL_SECURE_STORAGE === '1'

export function secureStorageDebug(tag: string, data?: Record<string, unknown>): void {
  if (!DEBUG_EMAIL_SECURE_STORAGE) return
  // eslint-disable-next-line no-console -- gated diagnostic
  console.log('[SecureStorageDebug]', tag, data ?? {})
}

/** Thrown when secrets cannot be encrypted for disk persistence — callers must fail closed. */
export class SecureStorageUnavailableError extends Error {
  readonly code = 'SECURE_STORAGE_UNAVAILABLE' as const
  constructor(message = 'OS secure storage (e.g. Windows DPAPI) is not available. Email secrets cannot be saved safely.') {
    super(message)
    this.name = 'SecureStorageUnavailableError'
  }
}

/**
 * Live check — do **not** cache: Electron may report unavailable briefly at startup, and
 * caching `false` would force plaintext paths for the whole session (regression).
 */
export function isSecureStorageAvailable(): boolean {
  try {
    const available = safeStorage.isEncryptionAvailable()
    secureStorageDebug('isEncryptionAvailable', { available })
    return available
  } catch (err) {
    secureStorageDebug('isEncryptionAvailable threw', {
      error: err instanceof Error ? err.message : String(err),
    })
    return false
  }
}

/** One-shot boot probe — call from `app.whenReady()` when diagnostics enabled. */
export function logSecureStorageProbe(context: string): void {
  const available = isSecureStorageAvailable()
  const line = `[SecureStorage] probe (${context}): isEncryptionAvailable=${available}`
  if (available) {
    console.log(line)
  } else {
    console.error(`${line} — email account persistence will fail until DPAPI/keychain works for this user session.`)
  }
  secureStorageDebug('probe', { context, available })
}

/**
 * Encrypt a string for persistence. **Throws** {@link SecureStorageUnavailableError} if encryption is not available,
 * or if `encryptString` fails (no plaintext fallback).
 */
export function encryptValue(plaintext: string | undefined | null): string {
  const p = plaintext ?? ''
  if (!isSecureStorageAvailable()) {
    secureStorageDebug('encryptValue aborted', { reason: 'isEncryptionAvailable_false' })
    throw new SecureStorageUnavailableError()
  }

  try {
    const encrypted = safeStorage.encryptString(p)
    return encrypted.toString('base64')
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[SecureStorage] encryptString failed:', msg)
    secureStorageDebug('encryptString failed', { message: msg })
    throw new SecureStorageUnavailableError(
      `Could not encrypt secret for storage: ${msg}. Your OS secure storage may be misconfigured.`,
    )
  }
}

/**
 * Check if a string looks like unencrypted token data
 */
function isUnencryptedToken(value: string): boolean {
  if (value.startsWith('ey')) return true
  if (value.startsWith('M.') || value.startsWith('0.')) return true
  if (value.startsWith('1//') || value.startsWith('ya29.')) return true
  if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) return true
  if (/^[A-Za-z0-9_-]{20,}$/.test(value)) return true
  return false
}

/**
 * Decrypt a base64-encoded encrypted value. For **loads** only: supports legacy plaintext when marked `_encrypted: false`.
 */
export function decryptValue(encrypted: string | undefined | null): string {
  if (encrypted == null || encrypted === '') {
    return ''
  }
  if (!isSecureStorageAvailable()) {
    secureStorageDebug('decryptValue passthrough', { reason: 'no_encryption_available_assume_legacy_plain' })
    return encrypted
  }

  if (isUnencryptedToken(encrypted)) {
    console.log('[SecureStorage] Found unencrypted legacy token, returning as-is')
    return encrypted
  }

  try {
    const buffer = Buffer.from(encrypted, 'base64')
    return safeStorage.decryptString(buffer)
  } catch (err) {
    console.log('[SecureStorage] Decryption failed, treating as legacy unencrypted data')
    return encrypted
  }
}

export interface OAuthTokens {
  accessToken: string
  refreshToken: string
  expiresAt: number
  scope?: string
  oauthClientId?: string
  gmailRefreshUsesSecret?: boolean
  gmailOAuthClientSecret?: string
}

export function encryptOAuthTokens(tokens: OAuthTokens): {
  accessToken: string
  refreshToken: string
  expiresAt: number
  scope: string
  oauthClientId?: string
  gmailRefreshUsesSecret?: boolean
  gmailOAuthClientSecret?: string
  _encrypted: boolean
} {
  const gmailOAuthClientSecret =
    tokens.gmailOAuthClientSecret && tokens.gmailOAuthClientSecret.trim()
      ? encryptValue(tokens.gmailOAuthClientSecret.trim())
      : undefined
  return {
    accessToken: encryptValue(tokens.accessToken),
    refreshToken: encryptValue(tokens.refreshToken),
    expiresAt: tokens.expiresAt,
    scope: tokens.scope ?? '',
    oauthClientId: tokens.oauthClientId,
    gmailRefreshUsesSecret: tokens.gmailRefreshUsesSecret,
    ...(gmailOAuthClientSecret ? { gmailOAuthClientSecret } : {}),
    _encrypted: true,
  }
}

export function decryptOAuthTokens(stored: {
  accessToken: string
  refreshToken: string
  expiresAt: number
  scope?: string
  oauthClientId?: string
  gmailRefreshUsesSecret?: boolean
  gmailOAuthClientSecret?: string
  _encrypted?: boolean
}): OAuthTokens {
  const decryptOptionalSecret = (v: string | undefined): string | undefined => {
    if (v == null || v === '') return undefined
    return decryptValue(v)
  }

  if (stored._encrypted === false) {
    console.log('[SecureStorage] Tokens marked as unencrypted, returning as-is')
    return {
      accessToken: stored.accessToken,
      refreshToken: stored.refreshToken,
      expiresAt: stored.expiresAt,
      scope: stored.scope,
      oauthClientId: stored.oauthClientId,
      gmailRefreshUsesSecret: stored.gmailRefreshUsesSecret,
      gmailOAuthClientSecret: stored.gmailOAuthClientSecret,
    }
  }

  console.log('[SecureStorage] Decrypting tokens, _encrypted:', stored._encrypted)
  return {
    accessToken: decryptValue(stored.accessToken),
    refreshToken: decryptValue(stored.refreshToken),
    expiresAt: stored.expiresAt,
    scope: stored.scope,
    oauthClientId: stored.oauthClientId,
    gmailRefreshUsesSecret: stored.gmailRefreshUsesSecret,
    gmailOAuthClientSecret: decryptOptionalSecret(stored.gmailOAuthClientSecret),
  }
}
