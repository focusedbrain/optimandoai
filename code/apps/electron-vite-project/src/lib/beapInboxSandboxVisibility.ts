/**
 * UI rules for the inbox Sandbox (Host → internal Sandbox) clone action.
 * Does not affect main-process host checks (ipc) or crypto.
 *
 * Received-BEAP rows (show Sandbox in Host mode when not echo):
 * - `source_type === 'direct_beap'`: P2P / native BEAP delivery.
 * - `source_type === 'email_beap'`: same logical message after email ingress; depackaging uses
 *   `depackaged_json` (e.g. `beap_qbeap_decrypted`, `beap_qbeap_pending`, …) — there is no separate
 *   inbox `source_type` for “depackaged” vs “raw capsule”.
 * Not clone-eligible in UI: outbound qBEAP echo (`isBeapQbeapOutboundEcho`), non-Host orchestrator,
 * or `source_type` outside the two above (e.g. `email_plain`). Prepare/clone may still return
 * `SOURCE_NO_EXTRACTABLE_CONTENT` when plaintext is not yet available.
 *
 * Gating uses **local persisted** `orchestratorMode` from `useOrchestratorMode()` / `orchestrator:getMode`
 * only — not remote handshake peer `mode`.
 */

import type { InboxMessage } from '../stores/useEmailInboxStore'
import { isBeapQbeapOutboundEcho } from './inboxBeapOutbound'

/** Inbox rows the product treats as received BEAP for Sandbox/Redirect (clone + redirect). */
export function isReceivedBeapMessageForSandbox(m: Pick<InboxMessage, 'source_type'> | null | undefined): boolean {
  if (!m) return false
  const t = m.source_type
  return t === 'email_beap' || t === 'direct_beap'
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
 * `modeReady && orchestratorMode === 'host' && isReceivedBeapMessage(m) && !isOutboundQbeapEcho(m)`.
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
