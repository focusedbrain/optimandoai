/**
 * Provider capability registry — static facts per `EmailProvider` plus per-account auth interpretation.
 * UI launch / wizard code should not duplicate this; gateway and future orchestration use it.
 */

import type { EmailAccountConfig, EmailProvider, ProviderAccountCapabilities } from '../types'

/** Transport-level capabilities for a provider implementation (excluding per-row auth type). */
export interface ProviderImplementationProfile {
  /** Provider id (redundant with map key; useful for logging). */
  provider: EmailProvider
  inboundSyncCapable: boolean
  outboundSendCapable: boolean
  remoteFolderMutationCapable: boolean
  /**
   * If our adapter **automatically** discovers additional distinct mailboxes from the vendor API
   * under one saved row (vs user-defined `mailboxes` slices). Not implemented for Gmail/Graph/IMAP yet.
   */
  adapterAutoListsAdditionalMailboxes: boolean
}

export const PROVIDER_IMPLEMENTATION_PROFILE: Record<EmailProvider, ProviderImplementationProfile> = {
  gmail: {
    provider: 'gmail',
    inboundSyncCapable: true,
    outboundSendCapable: true,
    remoteFolderMutationCapable: true,
    adapterAutoListsAdditionalMailboxes: false,
  },
  microsoft365: {
    provider: 'microsoft365',
    inboundSyncCapable: true,
    outboundSendCapable: true,
    remoteFolderMutationCapable: true,
    adapterAutoListsAdditionalMailboxes: false,
  },
  zoho: {
    provider: 'zoho',
    inboundSyncCapable: true,
    outboundSendCapable: true,
    remoteFolderMutationCapable: true,
    adapterAutoListsAdditionalMailboxes: false,
  },
  imap: {
    provider: 'imap',
    inboundSyncCapable: true,
    outboundSendCapable: true,
    remoteFolderMutationCapable: true,
    adapterAutoListsAdditionalMailboxes: false,
  },
}

/**
 * Full capability view for API / UI: combines static provider profile with row `authType`.
 */
export function getProviderAccountCapabilities(
  account: Pick<EmailAccountConfig, 'provider' | 'authType'>,
): ProviderAccountCapabilities {
  const profile = PROVIDER_IMPLEMENTATION_PROFILE[account.provider]
  const oauthBased = account.authType === 'oauth2'
  const passwordBased = account.authType === 'password' || account.authType === 'app_password'

  return {
    oauthBased,
    passwordBased,
    inboundSyncCapable: profile.inboundSyncCapable,
    outboundSendCapable: profile.outboundSendCapable,
    remoteFolderMutationCapable: profile.remoteFolderMutationCapable,
    multiMailboxPerAuthGrantSupported: profile.adapterAutoListsAdditionalMailboxes,
    supportsMultipleMailboxSlicesOnRow: true,
  }
}
