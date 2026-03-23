/**
 * Connected account identity — who the tokens/credentials belong to (UI + routing).
 * Separate from **sync targets** (folders) and **credentials** (oauth / password blobs).
 */

import type { EmailAccountConfig } from '../types'

/**
 * Human + address identity for a single provider account row.
 * Optional `externalPrincipalId` is for future use (OAuth sub, tenant user id, etc.).
 */
export interface ConnectedAccountIdentity {
  /** Our stable row id (same as EmailAccountConfig.id). */
  accountRowId: string
  displayName: string
  /** Primary SMTP-style address when known (may be empty briefly for some Gmail paths). */
  primaryEmail: string
  provider: EmailAccountConfig['provider']
  externalPrincipalId?: string
}

export function connectedAccountIdentityFromConfig(config: EmailAccountConfig): ConnectedAccountIdentity {
  return {
    accountRowId: config.id,
    displayName: config.displayName,
    primaryEmail: config.email,
    provider: config.provider,
    externalPrincipalId: config.externalPrincipalId,
  }
}
