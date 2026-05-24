/**
 * Pure edge-fetch eligibility + state merge rules (no Electron / session imports).
 */

import type { EmailAccountInfo, EmailProvider } from '../types.js'
import type { EdgeFetchEligibility, EdgeFetchLocalState } from './types.js'

function mapProviderToEmailFetch(provider: EmailProvider): 'google' | 'microsoft' | null {
  if (provider === 'gmail') return 'google'
  if (provider === 'microsoft365') return 'microsoft'
  return null
}

export function mergeEdgeFetchState(
  local: EdgeFetchLocalState | undefined,
  remote?: string,
): EdgeFetchLocalState {
  if (local === 'migrating' || local === 'migrating_back') return local
  if (local === 'degraded') return 'degraded'
  if (remote === 'degraded') return 'degraded'
  if (remote === 'active' || local === 'active') return 'active'
  if (remote === 'awaiting_key' || local === 'awaiting_key') return 'awaiting_key'
  return local ?? 'not_on_edge'
}

export function accountSupportsEdgeFetch(account: Pick<EmailAccountInfo, 'provider' | 'status'>): boolean {
  if (account.status !== 'active') return false
  return mapProviderToEmailFetch(account.provider as EmailProvider) !== null
}

export function edgeFetchEligibilityForAccount(
  account: Pick<EmailAccountInfo, 'provider' | 'status' | 'edgeFetch'>,
  eligibility: EdgeFetchEligibility,
): { allowed: boolean; reason?: string } {
  const state = account.edgeFetch?.state ?? 'not_on_edge'
  if (state !== 'not_on_edge' && state !== 'degraded') {
    return { allowed: false, reason: 'Account is already on or moving to the edge.' }
  }
  if (!accountSupportsEdgeFetch(account)) {
    return {
      allowed: false,
      reason: 'Only active Gmail or Microsoft 365 OAuth accounts can move to the edge.',
    }
  }
  if (!eligibility.edgeReady) {
    return { allowed: false, reason: eligibility.reason ?? 'Edge tier is not ready.' }
  }
  return { allowed: true }
}
