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
  /** Active handshake(s) exist but P2P keys/endpoint are incomplete — not the “no handshake” setup dialog. */
  | 'keying_incomplete'
  | 'direct_clone'
  | 'open_target_picker'

/**
 * @param sendableTargetCount - Sandboxes with `sandbox_keying_complete` (qBEAP can be built; relay may queue).
 * @param activeInternalHandshakeCount - All identity-complete active internal Host→Sandbox rows (`sandboxes.length`).
 */
export function resolveHostSandboxCloneClickAction(params: {
  internalListLoading: boolean
  sendableTargetCount: number
  activeInternalHandshakeCount: number
}): HostSandboxCloneClickAction {
  const { internalListLoading, sendableTargetCount, activeInternalHandshakeCount } = params

  if (sendableTargetCount > 1) return 'open_target_picker'
  if (sendableTargetCount === 1) return 'direct_clone'
  if (activeInternalHandshakeCount > 0 && sendableTargetCount === 0) return 'keying_incomplete'
  if (internalListLoading && activeInternalHandshakeCount === 0) return 'loading_refresh'
  if (activeInternalHandshakeCount === 0) return 'open_unavailable_dialog'
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
