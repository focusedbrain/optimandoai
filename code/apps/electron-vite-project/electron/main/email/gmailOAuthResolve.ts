/**
 * Resolves which Google OAuth client to use for Gmail connect / refresh.
 * End-user builds: PKCE + app-owned client id (no user-supplied secret).
 * Legacy / self-hosted: user-stored client id + client secret (confidential-style exchange).
 */

import { getBuiltinGmailOAuthClientId } from './googleOAuthBuiltin'
import { getCredentialsForOAuth } from './credentials'

export type GmailAuthMode = 'pkce' | 'legacy_secret'

export interface ResolvedGmailOAuth {
  clientId: string
  clientSecret?: string
  authMode: GmailAuthMode
}

/**
 * True when the app can start a Gmail OAuth sign-in without user-pasted OAuth credentials.
 */
export function isBuiltinGmailOAuthAvailable(): boolean {
  return !!getBuiltinGmailOAuthClientId()
}

/**
 * Pick OAuth client + flow for a new Gmail connection.
 *
 * Priority:
 * 1. User-stored credentials with client secret → legacy_secret (no PKCE; existing self-hosted users).
 * 2. User-stored client id only → PKCE (advanced / custom public client).
 * 3. Built-in app client id → PKCE (normal end users).
 */
export async function resolveGmailOAuthForConnect(): Promise<ResolvedGmailOAuth> {
  const user = await getCredentialsForOAuth('gmail')
  const builtin = getBuiltinGmailOAuthClientId()

  if (user?.clientId && user.clientSecret) {
    return {
      clientId: user.clientId.trim(),
      clientSecret: user.clientSecret.trim(),
      authMode: 'legacy_secret',
    }
  }
  if (user?.clientId?.trim()) {
    return { clientId: user.clientId.trim(), authMode: 'pkce' }
  }
  if (builtin) {
    return { clientId: builtin, authMode: 'pkce' }
  }

  throw new Error(
    'Gmail sign-in is not configured. Set WR_DESK_GOOGLE_OAUTH_CLIENT_ID (or ship resources/google-oauth-client-id.txt), or add OAuth credentials under Advanced.',
  )
}

/**
 * Client id to use when refreshing tokens for an existing account.
 */
export function resolveGmailOAuthClientIdForRefresh(accountOAuth?: {
  oauthClientId?: string
  gmailRefreshUsesSecret?: boolean
}): string | null {
  return accountOAuth?.oauthClientId?.trim() || null
}
