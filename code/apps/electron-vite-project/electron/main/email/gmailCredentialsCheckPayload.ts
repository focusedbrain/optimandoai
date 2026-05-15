/**
 * Shared payload for Gmail credential checks (Electron IPC + local HTTP gateway for extension relay).
 */

import type { CredentialSource } from './credentials'

import { checkExistingCredentials, isVaultUnlocked } from './credentials'
import {
  getGmailBuiltinProviderStatus,
  getStandardConnectBuiltinClientDiagnostics,
  isBuiltinStandardConnectReady,
  isEmailDeveloperModeEnabled,
  logOAuthDiagnostic,
} from './googleOAuthBuiltin'

export type GmailCredentialsCheckApiPayload = {
  configured: boolean
  developerCredentialsStored: boolean
  /** Built-in bundled Desktop OAuth client id is present (secret may still be missing). */
  builtinOAuthAvailable: boolean
  /** Ready for standard “Connect Google” (bundled Desktop id + resolvable secret). */
  builtinStandardConnectReady: boolean
  gmailBuiltinProviderStatus: 'not_configured' | 'credentials_incomplete' | 'ready'
  developerModeEnabled: boolean
  clientId?: string
  source: CredentialSource | 'none'
  credentials: unknown
  hasSecret: boolean
  vaultUnlocked: boolean
  standardConnectBundledClientFingerprint: string | null
  standardConnectBuiltinSourceKind: string | null
}

export async function buildGmailCredentialsCheckPayload(): Promise<GmailCredentialsCheckApiPayload> {
  const result = await checkExistingCredentials('gmail')
  const devMode = isEmailDeveloperModeEnabled()
  const builtin = getGmailBuiltinProviderStatus()
  const builtinStandardConnectReady = isBuiltinStandardConnectReady()

  const developerHasSecretPair =
    !!(result.credentials && result.hasSecret && (result.credentials as { clientId?: string }).clientId)
  const developerIdOnlyExperimental = !!(devMode && result.credentials && !result.hasSecret)

  const configured =
    builtinStandardConnectReady || developerHasSecretPair || developerIdOnlyExperimental

  const std = getStandardConnectBuiltinClientDiagnostics()

  logOAuthDiagnostic('gmail_credentials_check_payload', {
    gmailBuiltinProviderStatus: builtin.status,
    builtinStandardConnectReady,
    configured_gate: configured,
    bundledFirstLineClientIdFingerprint: std.standardConnectBundledClientFingerprint,
    winningBuiltinSourceKind: std.standardConnectBuiltinSourceKind,
  })

  return {
    configured,
    developerCredentialsStored: !!result.credentials,
    builtinOAuthAvailable: builtin.hasBundledClientId,
    builtinStandardConnectReady,
    gmailBuiltinProviderStatus: builtin.status,
    developerModeEnabled: devMode,
    clientId: result.clientId,
    source: result.source,
    credentials: result.credentials,
    hasSecret: result.hasSecret,
    vaultUnlocked: isVaultUnlocked(),
    standardConnectBundledClientFingerprint: std.standardConnectBundledClientFingerprint,
    standardConnectBuiltinSourceKind: std.standardConnectBuiltinSourceKind,
  }
}
