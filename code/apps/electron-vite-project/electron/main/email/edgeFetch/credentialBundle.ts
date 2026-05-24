/**
 * Build encrypted credential bundle for mail-fetcher (strategy §11.5).
 */

import { randomBytes } from 'node:crypto'
import {
  encryptCredentialBundle,
  parseAccountKeyHex,
  resolveImapConfig,
  zeroizeBuffer,
  type EmailFetchProvider,
  type MailFetcherCredentialPayload,
} from '@repo/email-fetch'
import type { EmailAccountConfig } from '../types.js'

export function mapProviderToEmailFetch(provider: EmailAccountConfig['provider']): EmailFetchProvider | null {
  if (provider === 'gmail') return 'google'
  if (provider === 'microsoft365') return 'microsoft'
  return null
}

export function buildCredentialPayload(account: EmailAccountConfig): MailFetcherCredentialPayload {
  const fetchProvider = mapProviderToEmailFetch(account.provider)
  if (!fetchProvider) {
    throw new Error('Only Gmail and Microsoft 365 accounts can fetch on the edge')
  }
  const oauth = account.oauth
  if (!oauth?.refreshToken?.trim()) {
    throw new Error('Account is missing OAuth refresh token — reconnect first')
  }
  if (!oauth.oauthClientId?.trim()) {
    throw new Error('Account is missing OAuth client id — reconnect first')
  }
  return {
    provider: fetchProvider,
    email: account.email,
    refresh_token: oauth.refreshToken,
    oauth_client_id: oauth.oauthClientId,
    ...(oauth.gmailOAuthClientSecret?.trim()
      ? { oauth_client_secret: oauth.gmailOAuthClientSecret.trim() }
      : {}),
    imap: resolveImapConfig(fetchProvider),
  }
}

export function generateAccountKeyHex(): string {
  return randomBytes(32).toString('hex')
}

export function encryptAccountCredentialBundle(
  account: EmailAccountConfig,
): { encryptedBundle: string; accountKeyHex: string } {
  const accountKey = randomBytes(32)
  const accountKeyHex = accountKey.toString('hex')
  try {
    const payload = buildCredentialPayload(account)
    const wire = encryptCredentialBundle(JSON.stringify(payload), accountKey)
    return { encryptedBundle: JSON.stringify(wire), accountKeyHex }
  } finally {
    zeroizeBuffer(accountKey)
  }
}

/** Validate account key hex without retaining buffer longer than needed. */
export function assertAccountKeyHex(hex: string): void {
  const buf = parseAccountKeyHex(hex)
  zeroizeBuffer(buf)
}

/**
 * Placeholder wrapped key file for tmpfs (legacy tests only).
 * Migration stores VMK-wrapped keys via accountKeyStorage (P4.5.8).
 */
export const WRAPPED_ACCOUNT_KEY_PLACEHOLDER = 'opaque-pending-p4.5.8'
