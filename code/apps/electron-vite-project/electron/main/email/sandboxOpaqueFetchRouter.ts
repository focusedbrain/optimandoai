/**
 * Sandbox opaque-fetch provider router (gmail / outlook).
 */

import { emailGateway } from './gateway'
import type { OAuthTokens } from './secure-storage'
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

/**
 * Provider router for sandbox opaque fetch — gmail / outlook only; others fail closed.
 */
export async function fetchOpaqueForProviderAccount(
  accountId: string,
  readToken: OAuthTokens,
  opts?: { maxMessages?: number; folder?: string },
): Promise<SandboxFetchedMessage[]> {
  const config = emailGateway.getAccountConfig(accountId)
  const provider = config?.provider
  if (provider === 'gmail') {
    return fetchOpaqueViaGmail(accountId, readToken, opts)
  }
  if (provider === 'microsoft365') {
    return fetchOpaqueViaOutlook(accountId, readToken, opts)
  }
  throw new SandboxFetchUnsupportedProviderError(String(provider ?? 'unknown'))
}
