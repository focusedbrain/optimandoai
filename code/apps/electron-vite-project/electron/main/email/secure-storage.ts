/**
 * Secure Storage for Email OAuth Tokens
 * 
 * Uses Electron's safeStorage API to encrypt sensitive data using the OS keychain.
 * This provides secure, persistent storage for OAuth tokens across app restarts.
 * 
 * On Windows: Uses Windows Credential Manager (DPAPI)
 * On macOS: Uses Keychain
 * On Linux: Uses libsecret/kwallet
 */

import { safeStorage, dialog } from 'electron'

/** One-shot UX + log when persisting secrets without OS encryption. */
let safeStorageUnavailableWarningShown = false

// Check if encryption is available
let encryptionAvailable: boolean | null = null

/**
 * Check if secure storage is available on this system
 */
export function isSecureStorageAvailable(): boolean {
  if (encryptionAvailable === null) {
    try {
      encryptionAvailable = safeStorage.isEncryptionAvailable()
      console.log('[SecureStorage] isSecureStorageAvailable() =>', encryptionAvailable)
    } catch (err) {
      console.error('[SecureStorage] Error checking encryption availability:', err)
      encryptionAvailable = false
      console.log('[SecureStorage] isSecureStorageAvailable() =>', false)
    }
  }
  return encryptionAvailable ?? false
}

/**
 * Encrypt a string value using the OS keychain
 * Returns base64-encoded encrypted data
 */
export function encryptValue(plaintext: string | undefined | null): string {
  const p = plaintext ?? ''
  if (!isSecureStorageAvailable()) {
    if (!safeStorageUnavailableWarningShown) {
      safeStorageUnavailableWarningShown = true
      console.error(
        '[SecureStorage] OS secure storage is not available. Email credentials will be stored WITHOUT encryption. This is a security risk.',
      )
      setImmediate(() => {
        try {
          void dialog.showMessageBox({
            type: 'warning',
            title: 'Secure storage unavailable',
            message:
              'OS secure storage is not available on this session. Email account secrets may be saved to disk without encryption. Reconnect accounts on a trusted device or fix keychain / DPAPI access if this is unexpected.',
          })
        } catch (e) {
          console.warn('[SecureStorage] Could not show secure-storage warning dialog:', e)
        }
      })
    }
    return p
  }

  try {
    const encrypted = safeStorage.encryptString(p)
    return encrypted.toString('base64')
  } catch (err) {
    console.error('[SecureStorage] Encryption failed:', err)
    return p
  }
}

/**
 * Check if a string looks like unencrypted token data
 */
function isUnencryptedToken(value: string): boolean {
  // JWT tokens start with 'ey' (base64 of '{"')
  if (value.startsWith('ey')) return true
  // Refresh tokens from Microsoft often start with specific patterns
  if (value.startsWith('M.') || value.startsWith('0.')) return true
  // OAuth tokens from Google
  if (value.startsWith('1//') || value.startsWith('ya29.')) return true
  // If it contains typical JWT separators (two dots for header.payload.signature)
  if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) return true
  // If it's a long alphanumeric string (typical for tokens)
  if (/^[A-Za-z0-9_-]{20,}$/.test(value)) return true
  return false
}

/**
 * Decrypt a base64-encoded encrypted value
 */
export function decryptValue(encrypted: string | undefined | null): string {
  if (encrypted == null || encrypted === '') {
    return ''
  }
  if (!isSecureStorageAvailable()) {
    // If encryption wasn't available during save, data is unencrypted
    return encrypted
  }

  // First, check if this looks like unencrypted token data (legacy)
  if (isUnencryptedToken(encrypted)) {
    console.log('[SecureStorage] Found unencrypted legacy token, returning as-is')
    return encrypted
  }
  
  try {
    // Try to decrypt - if it fails, the data might be unencrypted legacy data
    const buffer = Buffer.from(encrypted, 'base64')
    return safeStorage.decryptString(buffer)
  } catch (err) {
    // Decryption failed - might be legacy unencrypted data
    console.log('[SecureStorage] Decryption failed, treating as legacy unencrypted data')
    return encrypted
  }
}

/**
 * Encrypt OAuth token object
 */
export interface OAuthTokens {
  accessToken: string
  refreshToken: string
  expiresAt: number
  scope?: string
  /** Gmail: client id used when the refresh token was issued (not encrypted). */
  oauthClientId?: string
  /** Gmail: legacy OAuth app used client_secret on refresh (not encrypted). */
  gmailRefreshUsesSecret?: boolean
  /** Gmail: Desktop PKCE built-in client_secret for token refresh (encrypted at rest when safeStorage works). */
  gmailOAuthClientSecret?: string
}

/**
 * Encrypt OAuth tokens for secure storage
 * Returns an object with encrypted token strings
 */
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
    _encrypted: isSecureStorageAvailable()
  }
}

/**
 * Decrypt OAuth tokens from secure storage
 */
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

  // If explicitly marked as not encrypted, return as-is
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
  
  // If _encrypted is undefined, this is legacy data - try to decrypt but handle gracefully
  // The decryptValue function will detect and handle unencrypted legacy tokens
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









