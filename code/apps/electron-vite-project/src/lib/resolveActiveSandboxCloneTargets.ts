/**
 * Canonical Sandbox clone target resolution for Host inbox (row, detail, link dialog).
 * Uses `internalSandboxes.listAvailable` rows — not relay / beap_clone_eligible as “exists”.
 */

import type {
  InternalSandboxIncompleteWire,
  InternalSandboxTargetWire,
} from '../hooks/useInternalSandboxesList'

export type ResolveActiveSandboxCloneTargetsResult = {
  /** Identity-complete rows with sendable clone material. */
  sendableTargets: InternalSandboxTargetWire[]
  /** All identity-complete rows (may lack keying). */
  identityCompleteRows: InternalSandboxTargetWire[]
  incompleteRows: InternalSandboxIncompleteWire[]
  activeHostSandboxCount: number
  liveEligibleCount: number
}

/**
 * Derive counts and sendable subset from a fresh `listAvailable` snapshot (or hook state).
 */
export function resolveActiveSandboxCloneTargets(
  sandboxes: InternalSandboxTargetWire[],
  incomplete: InternalSandboxIncompleteWire[],
): ResolveActiveSandboxCloneTargetsResult {
  const sendableTargets = sandboxes.filter((s) => s.sandbox_keying_complete === true)
  const liveEligibleCount = sandboxes.filter((s) => s.beap_clone_eligible === true).length
  const activeHostSandboxCount = sandboxes.length + incomplete.length
  return {
    sendableTargets,
    identityCompleteRows: sandboxes,
    incompleteRows: incomplete,
    activeHostSandboxCount,
    liveEligibleCount,
  }
}
