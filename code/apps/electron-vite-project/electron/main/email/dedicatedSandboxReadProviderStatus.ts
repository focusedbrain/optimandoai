/**
 * PROMPT 4 — dedicated topology missing read-provider detection helpers (main process).
 */

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

export function sandboxDedicatedMissingReadProvider(
  accounts: ReadonlyArray<{ readConsentPresent: boolean; lastPollStatus?: string }>,
): boolean {
  if (accounts.length === 0) return true
  return accounts.some(
    (a) => !a.readConsentPresent || isSandboxReadConsentMissingPollStatus(a.lastPollStatus),
  )
}
