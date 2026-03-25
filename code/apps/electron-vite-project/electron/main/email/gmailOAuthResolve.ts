/**
 * Resolves which Google OAuth client to use for Gmail connect / refresh.
 * End-user builds: PKCE + app-owned client id (no user-supplied secret).
 * Legacy / self-hosted: user-stored client id + client secret (confidential-style exchange).
 */

import {
  resolveBuiltinGoogleOAuthClientWithMeta,
  isBuiltinGmailOAuthConfigured,
  logOAuthDiagnostic,
  assertBuiltinPublicClientMatchesShippedResource,
  oauthClientIdFingerprint,
  isPackagedProductionGmailStandardConnect,
  getGoogleOauthClientIdEnvVarNamesPresent,
  type BuiltinGoogleOAuthClientResolution,
} from './googleOAuthBuiltin'
import { getCredentialsForOAuth } from './credentials'

export type GmailAuthMode = 'pkce' | 'legacy_secret'

/** How the renderer / API selected credentials for this connect attempt. */
export type GmailOAuthCredentialSource = 'builtin_public' | 'developer_saved'

/** Where the OAuth client id came from after resolution. */
export type GmailOAuthResolutionTag = 'builtin' | 'developer_legacy_secret' | 'developer_pkce'

export interface ResolvedGmailOAuth {
  clientId: string
  clientSecret?: string
  authMode: GmailAuthMode
  resolution: GmailOAuthResolutionTag
  /** Renderer / gateway selection for this connect (distinguishes standard Connect vs Advanced builtin fallback). */
  credentialSourceUsed: GmailOAuthCredentialSource
  /** Set when the active client id is the app built-in Desktop client (standard Connect or Advanced fallback). */
  builtinClientResolution?: BuiltinGoogleOAuthClientResolution
}

/**
 * True when the app can start a Gmail OAuth sign-in without user-pasted OAuth credentials.
 */
export function isBuiltinGmailOAuthAvailable(): boolean {
  return isBuiltinGmailOAuthConfigured()
}

/**
 * When `gmailOAuthCredentialSource` is omitted (e.g. IPC/HTTP), prefer the app built-in Desktop
 * OAuth client (PKCE) if this build provides one; otherwise fall back to vault/file developer order.
 * Advanced Gmail must pass `developer_saved` explicitly.
 */
export function defaultGmailOAuthCredentialSource(): GmailOAuthCredentialSource {
  return isBuiltinGmailOAuthConfigured() ? 'builtin_public' : 'developer_saved'
}

function assertBuiltinMetaConfigured(): BuiltinGoogleOAuthClientResolution {
  const meta = resolveBuiltinGoogleOAuthClientWithMeta({ forStandardGmailConnect: true })
  if (!meta) {
    throw new Error(
      'Gmail sign-in is not configured for this app build. Use a build that includes the app Google OAuth client, or developer OAuth credentials if enabled.',
    )
  }
  return meta
}

/**
 * Pick OAuth client + flow for a new Gmail connection.
 *
 * @param credentialSource
 * - `builtin_public` — standard “Connect Google”: always use the app built-in Desktop OAuth client
 *   with PKCE. Ignores vault/file developer credentials so a stale Web client id cannot override.
 * - `developer_saved` — Advanced / legacy API order:
 *   1. User-stored credentials with client secret → legacy_secret.
 *   2. User-stored client id only → PKCE with that id.
 *   3. Built-in client id → PKCE.
 */
export async function resolveGmailOAuthForConnect(
  credentialSource: GmailOAuthCredentialSource = defaultGmailOAuthCredentialSource(),
): Promise<ResolvedGmailOAuth> {
  if (credentialSource === 'builtin_public') {
    const meta = assertBuiltinMetaConfigured()
    assertBuiltinPublicClientMatchesShippedResource(meta)
    const resolved: ResolvedGmailOAuth = {
      clientId: meta.clientId,
      authMode: 'pkce',
      resolution: 'builtin',
      credentialSourceUsed: 'builtin_public',
      builtinClientResolution: meta,
    }
    logOAuthDiagnostic('gmail_standard_connect_oauth_source', {
      winningBuiltinSourceKind: meta.sourceKind,
      winningClientIdFingerprint: oauthClientIdFingerprint(meta.clientId),
      gmailOAuthCredentialSource: 'builtin_public',
      authMode: 'pkce',
      packagedProductionStandardConnect: isPackagedProductionGmailStandardConnect(),
      packagedStandardConnectResourcePrecedenceEnforced: isPackagedProductionGmailStandardConnect(),
      googleOauthEnvVarsPresent: getGoogleOauthClientIdEnvVarNamesPresent(),
      packagedStandardConnectIgnoredEnvVarNames: meta.packagedStandardConnectIgnoredEnvVarNames ?? [],
    })
    logOAuthDiagnostic('gmail_oauth_resolve', {
      credentialSource: 'builtin_public',
      authMode: resolved.authMode,
      resolution: resolved.resolution,
      clientId: resolved.clientId,
      builtinSourceKind: meta.sourceKind,
      builtinSourceName: meta.sourceName,
      builtinFromBuildTimeInline: meta.fromBuildTimeInline,
      builtinFromPackagedResourceFile: meta.fromPackagedResourceFile,
      builtinConfigured: true,
      usesUserStoredOAuthClient: false,
    })
    return resolved
  }

  const user = await getCredentialsForOAuth('gmail')
  const builtinMeta = resolveBuiltinGoogleOAuthClientWithMeta()

  if (user?.clientId && user.clientSecret) {
    const resolved: ResolvedGmailOAuth = {
      clientId: user.clientId.trim(),
      clientSecret: user.clientSecret.trim(),
      authMode: 'legacy_secret',
      resolution: 'developer_legacy_secret',
      credentialSourceUsed: 'developer_saved',
    }
    logOAuthDiagnostic('gmail_oauth_resolve', {
      credentialSource: 'developer_saved',
      authMode: resolved.authMode,
      resolution: resolved.resolution,
      clientId: resolved.clientId,
      hasClientSecret: true,
      usesUserStoredOAuthClient: true,
    })
    return resolved
  }
  if (user?.clientId?.trim()) {
    const resolved: ResolvedGmailOAuth = {
      clientId: user.clientId.trim(),
      authMode: 'pkce',
      resolution: 'developer_pkce',
      credentialSourceUsed: 'developer_saved',
    }
    logOAuthDiagnostic('gmail_oauth_resolve', {
      credentialSource: 'developer_saved',
      authMode: resolved.authMode,
      resolution: resolved.resolution,
      clientId: resolved.clientId,
      hasClientSecret: false,
      usesUserStoredOAuthClient: true,
    })
    return resolved
  }
  if (builtinMeta) {
    const resolved: ResolvedGmailOAuth = {
      clientId: builtinMeta.clientId,
      authMode: 'pkce',
      resolution: 'builtin',
      credentialSourceUsed: 'developer_saved',
      builtinClientResolution: builtinMeta,
    }
    logOAuthDiagnostic('gmail_oauth_resolve', {
      credentialSource: 'developer_saved',
      authMode: resolved.authMode,
      resolution: resolved.resolution,
      clientId: resolved.clientId,
      usesUserStoredOAuthClient: false,
      builtinFallback: true,
      builtinSourceKind: builtinMeta.sourceKind,
      builtinSourceName: builtinMeta.sourceName,
      builtinFromBuildTimeInline: builtinMeta.fromBuildTimeInline,
      builtinFromPackagedResourceFile: builtinMeta.fromPackagedResourceFile,
    })
    return resolved
  }

  throw new Error(
    'Gmail sign-in is not configured for this app build. Use a build that includes the app Google OAuth client, or developer OAuth credentials if enabled.',
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
