/**
 * Sandbox opaque-fetch provider router (gmail / outlook).
 */

import { emailGateway } from './gateway'
import type { RoleScopedTokenRecord } from './roleScopedTokenStore'
import type { SandboxFetchedMessage } from './sandboxIngestion'
import { fetchOpaqueViaGmail, fetchOpaqueViaOutlook } from './sandboxEmailFetch'

/** Fail-closed when the account provider has no sandbox opaque-fetch implementation. */
export class SandboxFetchUnsupportedProviderError extends Error {
  readonly code = 'unsupported_provider' as const

  constructor(readonly provider: string) {
    super(`sandbox opaque fetch unsupported for provider: ${provider}`)
    this.name = 'SandboxFetchUnsupportedProviderError'
  }
}

export type SandboxFetchFailureKind =
  | 'unsupported_provider'
  | 'oauth_client_id_missing'
  | 'oauth_refresh_failed'
  | 'other'

/** Rig diagnosis: classify fetchOpaque throws for sandbox sync banner triage. */
export function classifySandboxFetchFailure(err: unknown): {
  kind: SandboxFetchFailureKind
  message: string
} {
  if (err instanceof SandboxFetchUnsupportedProviderError) {
    return { kind: 'unsupported_provider', message: err.message }
  }
  const message = err instanceof Error ? err.message : String(err)
  const lower = message.toLowerCase()
  if (lower.includes('missing oauth client id') || lower.includes('missing credentials')) {
    return { kind: 'oauth_client_id_missing', message }
  }
  if (
    lower.includes('invalid_grant') ||
    lower.includes('token refresh failed') ||
    lower.includes('cannot refresh token')
  ) {
    return { kind: 'oauth_refresh_failed', message }
  }
  return { kind: 'other', message }
}

/**
 * Provider router for sandbox opaque fetch — gmail / outlook only; others fail closed.
 */
export async function fetchOpaqueForProviderAccount(
  accountId: string,
  tokenRecord: RoleScopedTokenRecord,
  opts?: { maxMessages?: number; folder?: string },
): Promise<SandboxFetchedMessage[]> {
  const config = emailGateway.getAccountConfig(accountId)
  const provider = config?.provider
  if (provider === 'gmail') {
    return fetchOpaqueViaGmail(accountId, tokenRecord, opts)
  }
  if (provider === 'microsoft365') {
    return fetchOpaqueViaOutlook(accountId, tokenRecord, opts)
  }
  throw new SandboxFetchUnsupportedProviderError(String(provider ?? 'unknown'))
}
