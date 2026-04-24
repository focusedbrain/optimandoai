/**
 * Host inbox Sandbox clone — pure click routing (list row + message detail).
 * Uses **active internal Host↔Sandbox handshakes** + **keying** — not live relay / beap_clone_eligible.
 * Keep in sync: EmailInboxView handleInboxRowSandbox, EmailMessageDetail handleHostSandboxClick.
 */

import type { BeapSandboxUnavailableVariant } from '../components/BeapSandboxUnavailableDialog'
import type { SandboxOrchestratorAvailability } from '../types/sandboxOrchestratorAvailability'

/** Next UX step when the user invokes Sandbox. */
export type HostSandboxCloneClickAction =
  | 'loading_refresh'
  | 'open_unavailable_dialog'
  /** Active identity-complete handshake(s) but P2P keys/endpoint are incomplete — not the “no handshake” setup dialog. */
  | 'keying_incomplete'
  /** ACTIVE host↔sandbox row exists in DB but `internal_coordination_identity_complete` is false — not “no sandbox”. */
  | 'identity_incomplete'
  | 'direct_clone'
  | 'open_target_picker'

/**
 * @param sendableTargetCount - Sandboxes with `sandbox_keying_complete` (qBEAP can be built; relay may queue).
 * @param activeIdentityCompleteHostSandboxCount - Rows in `listAvailable.sandboxes` (identity complete).
 * @param identityIncompleteHostSandboxCount - Rows in `listAvailable.incomplete` (active host↔sandbox, identity not complete).
 * @param listLastSuccess - At least one successful `internalSandboxes.listAvailable`; if false, prefer refresh over “no sandbox”.
 */
export function resolveHostSandboxCloneClickAction(params: {
  internalListLoading: boolean
  listLastSuccess: boolean
  sendableTargetCount: number
  activeIdentityCompleteHostSandboxCount: number
  identityIncompleteHostSandboxCount: number
}): HostSandboxCloneClickAction {
  const {
    internalListLoading,
    listLastSuccess,
    sendableTargetCount,
    activeIdentityCompleteHostSandboxCount,
    identityIncompleteHostSandboxCount,
  } = params

  const activeHostSandboxHandshakeCount =
    activeIdentityCompleteHostSandboxCount + identityIncompleteHostSandboxCount

  if (!listLastSuccess && !internalListLoading) return 'loading_refresh'
  if (sendableTargetCount > 1) return 'open_target_picker'
  if (sendableTargetCount === 1) return 'direct_clone'
  if (internalListLoading && activeHostSandboxHandshakeCount === 0) return 'loading_refresh'
  if (activeHostSandboxHandshakeCount > 0 && sendableTargetCount === 0) {
    if (activeIdentityCompleteHostSandboxCount > 0) return 'keying_incomplete'
    return 'identity_incomplete'
  }
  if (activeHostSandboxHandshakeCount === 0) return 'open_unavailable_dialog'
  return 'open_unavailable_dialog'
}

export function sandboxCloneUnavailableDialogVariant(
  _availability: Pick<SandboxOrchestratorAvailability, 'status'>,
): BeapSandboxUnavailableVariant {
  return 'not_configured'
}

/** Shown when an internal Host↔Sandbox row exists but P2P / BEAP key material is incomplete. */
export const SANDBOX_KEYING_INCOMPLETE_USER_MESSAGE =
  'Sandbox handshake is active but missing BEAP key material. Reconnect or repair the internal handshake.'

/** Shown when ACTIVE host↔sandbox is listed but internal coordination identity is not complete. */
export const SANDBOX_IDENTITY_INCOMPLETE_USER_MESSAGE =
  'Internal Host ↔ Sandbox coordination is not complete on this device. Open Handshakes to finish device identity, then try again.'

export type SandboxTargetResolutionLogDecision =
  | 'host_active_target_send_now'
  | 'host_multiple_targets_open_picker'
  | 'host_no_active_target_show_setup'
  | 'host_keying_incomplete_feedback'
  | 'host_identity_incomplete_feedback'
  | 'host_list_loading_or_unavailable_refetch'
  | 'sandbox_mode_hide_action'
  | 'mode_not_ready_hide_action'

const RESOLUTION_LOG_PREFIX = '[SANDBOX_TARGET_RESOLUTION]'

/**
 * Dev-only structured log for Sandbox click routing. Does not use relay, email, or isBeap as gating “reasons”.
 */
export function logSandboxTargetResolution(p: {
  source: 'inbox_row' | 'message_detail' | 'external_link_dialog' | 'bulk_inbox'
  messageId: string | null
  modeReady: boolean
  orchestratorMode: 'host' | 'sandbox' | null
  isHost: boolean
  /** `sandboxes.length` from listAvailable */
  internalSandboxRowsCount: number
  /** Identity-complete + identity-incomplete host↔sandbox active rows (same as routing input). */
  activeSandboxTargetsCount: number
  /** `beap_clone_eligible` — live path proxy; not used to block. */
  liveSandboxTargetsCount: number
  selectedTargetHandshakeId: string | null
  action: HostSandboxCloneClickAction | null
  decision: SandboxTargetResolutionLogDecision
  reason: string
}): void {
  if (!import.meta.env.DEV) return
  // eslint-disable-next-line no-console
  console.log(RESOLUTION_LOG_PREFIX, {
    source: p.source,
    message_id: p.messageId,
    modeReady: p.modeReady,
    orchestratorMode: p.orchestratorMode,
    isHost: p.isHost,
    internalSandboxRowsCount: p.internalSandboxRowsCount,
    activeSandboxTargetsCount: p.activeSandboxTargetsCount,
    liveSandboxTargetsCount: p.liveSandboxTargetsCount,
    selectedTargetHandshakeId: p.selectedTargetHandshakeId,
    action: p.action,
    decision: p.decision,
    reason: p.reason,
  })
}

export function mapSandboxClickActionToResolutionDecision(
  a: HostSandboxCloneClickAction,
): SandboxTargetResolutionLogDecision {
  switch (a) {
    case 'direct_clone':
      return 'host_active_target_send_now'
    case 'open_target_picker':
      return 'host_multiple_targets_open_picker'
    case 'open_unavailable_dialog':
      return 'host_no_active_target_show_setup'
    case 'keying_incomplete':
      return 'host_keying_incomplete_feedback'
    case 'identity_incomplete':
      return 'host_identity_incomplete_feedback'
    case 'loading_refresh':
    default:
      return 'host_list_loading_or_unavailable_refetch'
  }
}
