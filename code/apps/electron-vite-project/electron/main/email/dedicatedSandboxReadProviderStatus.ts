/**
 * PROMPT 4 — dedicated topology missing read-provider detection helpers (main process).
 */

import { effectiveIngestionPollStatus } from './ipcSyncResultShape'

export function isSandboxReadConsentMissingPollStatus(status: string | undefined): boolean {
  return status === 'held_read_consent_missing'
}

export function isSandboxPollUnreachableStatus(status: string | undefined): boolean {
  return status === 'held_fetch_failed' || status === 'trigger_unreachable'
}

export function hostAckIndicatesMissingReadProvider(
  acks: ReadonlyMap<string, { pollStatus: string }>,
  accountIds: readonly string[],
): boolean {
  const ids = accountIds.length > 0 ? accountIds : [...acks.keys()]
  return ids.some((id) => isSandboxReadConsentMissingPollStatus(acks.get(id)?.pollStatus))
}

export function hostAckIndicatesPollUnreachable(
  acks: ReadonlyMap<string, { pollStatus: string }>,
  accountIds: readonly string[],
): boolean {
  const ids = accountIds.length > 0 ? accountIds : [...acks.keys()]
  return ids.some((id) => isSandboxPollUnreachableStatus(acks.get(id)?.pollStatus))
}

/** The sandbox fetched (and unpacked) mail the host never received — never a green state. */
export function hostAckIndicatesDeliveryFailed(
  acks: ReadonlyMap<string, { pollStatus: string; fetched: number; depackaged: number; delivered: number; held: number }>,
  accountIds: readonly string[],
): boolean {
  const ids = accountIds.length > 0 ? accountIds : [...acks.keys()]
  return ids.some((id) => {
    const ack = acks.get(id)
    return !!ack && effectiveIngestionPollStatus(ack) === 'held_delivery_failed'
  })
}

export function sandboxDedicatedMissingReadProvider(
  accounts: ReadonlyArray<{ readConsentPresent: boolean; lastPollStatus?: string }>,
): boolean {
  if (accounts.length === 0) return true
  return accounts.some(
    (a) => !a.readConsentPresent || isSandboxReadConsentMissingPollStatus(a.lastPollStatus),
  )
}
