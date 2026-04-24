/**
 * UI rules for the inbox Sandbox (Host → internal Sandbox) clone action.
 * Does not affect main-process host checks (ipc) or crypto.
 *
 * Received-BEAP rows (show Sandbox in Host mode when not echo) include:
 * - `source_type === 'direct_beap'` (P2P) or `email_beap` (email-carried / merged BEAP)
 * - `source_type === 'email_plain'` when the row still has BEAP payload (`beap_package_json` and/or
 *   depackaged JSON with a `beap_*` / qBEAP format) — e.g. BEAP from email before/after depackaging.
 * Not clone-eligible in UI: outbound qBEAP echo (`isBeapQbeapOutboundEcho`), non-Host orchestrator.
 *
 * Gating uses **local persisted** `orchestratorMode` from `useOrchestratorMode()` / `orchestrator:getMode`
 * only — not remote handshake peer `mode`. Row classification matches `inboxBeapRowEligibility` / main
 * `inboxRowIsReceivedBeapForRedirectOrClone`.
 */

import type { InboxMessage } from '../stores/useEmailInboxStore'
import { isReceivedBeapInboxMessage } from './inboxBeapRowEligibility'
import { isBeapQbeapOutboundEcho } from './inboxBeapOutbound'

/**
 * Inbox rows the product treats as received BEAP for Sandbox/Redirect (clone + redirect), including
 * depackaged BEAP from email when stored as `email_plain` with BEAP fields.
 */
export function isReceivedBeapMessageForSandbox(
  m: Pick<InboxMessage, 'source_type' | 'beap_package_json' | 'depackaged_json'> | null | undefined,
): boolean {
  if (!m) return false
  return isReceivedBeapInboxMessage(m)
}

/** Alias for docs / call sites that match the name `isReceivedBeapMessage`. */
export const isReceivedBeapMessage = isReceivedBeapMessageForSandbox

/**
 * True when the row must not offer Sandbox: user's outbound qBEAP echo, not a received message.
 * (Same as list logic; use this everywhere for consistent visibility with `canShowSandboxCloneAction`.)
 */
export function isOutboundQbeapEchoForSandboxAction(message: InboxMessage | null | undefined): boolean {
  if (!message) return false
  return isBeapQbeapOutboundEcho(message)
}

type SandboxCloneActionParams = {
  modeReady: boolean
  /** From `useOrchestratorMode().mode` / `window.orchestratorMode.getMode()` — must be `'host'`. */
  orchestratorMode: 'host' | 'sandbox' | null
  message: InboxMessage | null | undefined
}

/**
 * `canShowSandboxCloneAction` ⇔
 * `modeReady && orchestratorMode === 'host' && isReceivedBeapInboxMessage(m) && !isOutboundQbeapEcho(m)`.
 * Never true when the local device is configured as a Sandbox orchestrator.
 */
export function canShowSandboxCloneAction(params: SandboxCloneActionParams): boolean {
  const { modeReady, orchestratorMode, message } = params
  if (!modeReady || orchestratorMode !== 'host' || !message) return false
  if (!isReceivedBeapMessageForSandbox(message)) return false
  if (isOutboundQbeapEchoForSandboxAction(message)) return false
  return true
}

/** Same as `canShowSandboxCloneAction` (kept for existing imports). */
export const canShowSandboxAction = canShowSandboxCloneAction
