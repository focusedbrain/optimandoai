/**
 * Host inbox Sandbox clone — pure click routing (list row + message detail).
 * Keep in sync: EmailInboxView handleInboxRowSandbox, EmailMessageDetail handleHostSandboxClick.
 */

import type { BeapSandboxUnavailableVariant } from '../components/BeapSandboxUnavailableDialog'
import type { SandboxOrchestratorAvailability } from '../types/sandboxOrchestratorAvailability'

/** Next UX step when the user invokes Sandbox (clone-eligible target count from host list). */
export type HostSandboxCloneClickAction =
  | 'loading_refresh'
  | 'open_unavailable_dialog'
  | 'direct_clone'
  | 'open_target_picker'

/**
 * @param internalListLoading - Internal sandbox list RPC in flight
 * @param cloneEligibleTargetCount - `cloneEligibleSandboxes.length` / `internalSandboxTargets` filtered
 */
export function resolveHostSandboxCloneClickAction(params: {
  internalListLoading: boolean
  cloneEligibleTargetCount: number
}): HostSandboxCloneClickAction {
  const n = params.cloneEligibleTargetCount
  if (params.internalListLoading && n === 0) return 'loading_refresh'
  if (n === 0) return 'open_unavailable_dialog'
  if (n === 1) return 'direct_clone'
  return 'open_target_picker'
}

export function sandboxCloneUnavailableDialogVariant(
  availability: Pick<SandboxOrchestratorAvailability, 'status'>,
): BeapSandboxUnavailableVariant {
  return availability.status === 'exists_but_offline' ? 'exists_but_offline' : 'not_configured'
}
