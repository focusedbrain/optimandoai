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
 */

import type { InboxMessage } from '../stores/useEmailInboxStore'
import { isBeapQbeapOutboundEcho } from './inboxBeapOutbound'

/** Inbox rows the product treats as received BEAP for Sandbox/Redirect (clone + redirect). */
export function isReceivedBeapMessageForSandbox(m: Pick<InboxMessage, 'source_type'> | null | undefined): boolean {
  if (!m) return false
  const t = m.source_type
  return t === 'email_beap' || t === 'direct_beap'
}

/**
 * True when the row must not offer Sandbox: user's outbound qBEAP echo, not a received message.
 * (Same as list logic; use this everywhere for consistent visibility with `canShowSandboxAction`.)
 */
export function isOutboundQbeapEchoForSandboxAction(message: InboxMessage | null | undefined): boolean {
  if (!message) return false
  return isBeapQbeapOutboundEcho(message)
}

/**
 * When orchestrator mode is known and the device is the Host, show Sandbox for received BEAP
 * that is not an outbound echo. When mode is not ready or the device is not Host (including
 * Sandbox orchestrator or unknown), do not show — avoids flicker and wrong mode.
 */
export function canShowSandboxAction(params: {
  modeReady: boolean
  isHost: boolean
  message: InboxMessage | null | undefined
}): boolean {
  const { modeReady, isHost, message } = params
  if (!modeReady || !isHost || !message) return false
  if (!isReceivedBeapMessageForSandbox(message)) return false
  if (isOutboundQbeapEchoForSandboxAction(message)) return false
  return true
}
