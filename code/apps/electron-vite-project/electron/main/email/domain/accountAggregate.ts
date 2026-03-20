/**
 * Read-only aggregate over a persisted `EmailAccountConfig` for orchestration and tooling.
 * Does not replace JSON persistence — use mappers until a versioned migration exists.
 */

import type { EmailAccountConfig, ProviderAccountCapabilities } from '../types'
import { connectedAccountIdentityFromConfig, type ConnectedAccountIdentity } from './accountIdentity'
import { getProviderAccountCapabilities } from './capabilitiesRegistry'
import { mailboxSyncPlanFromLegacyFolders, type MailboxSyncPlan } from './mailboxSyncPlan'
import { getDefaultMailboxSlice, resolveMailboxesForAccount, type ResolvedMailboxSlice } from './mailboxResolution'

/**
 * Domain-shaped view of one stored provider account row + derived sync plan.
 */
export interface ProviderAccountDomainView {
  identity: ConnectedAccountIdentity
  capabilities: ProviderAccountCapabilities
  /** One or more mailbox/postbox slices (same credentials). */
  mailboxSlices: ResolvedMailboxSlice[]
  defaultMailboxSlice: ResolvedMailboxSlice
  /** Sync targets for the **default** slice (folder/label level). */
  mailboxSyncPlan: MailboxSyncPlan
}

export function providerAccountDomainViewFromConfig(config: EmailAccountConfig): ProviderAccountDomainView {
  const slices = resolveMailboxesForAccount(config)
  const defaultSlice = getDefaultMailboxSlice(config)
  return {
    identity: connectedAccountIdentityFromConfig(config),
    capabilities: getProviderAccountCapabilities(config),
    mailboxSlices: slices,
    defaultMailboxSlice: defaultSlice,
    mailboxSyncPlan: mailboxSyncPlanFromLegacyFolders(defaultSlice.folders),
  }
}

/** Full aggregate including every slice’s sync plan (for future multi-slice sync). */
export function providerAccountDomainViewsAllSlices(config: EmailAccountConfig): {
  identity: ConnectedAccountIdentity
  capabilities: ProviderAccountCapabilities
  slices: Array<{ slice: ResolvedMailboxSlice; syncPlan: MailboxSyncPlan }>
} {
  const slices = resolveMailboxesForAccount(config)
  return {
    identity: connectedAccountIdentityFromConfig(config),
    capabilities: getProviderAccountCapabilities(config),
    slices: slices.map((slice) => ({
      slice,
      syncPlan: mailboxSyncPlanFromLegacyFolders(slice.folders),
    })),
  }
}
