import type { InboxMessage } from '../stores/useEmailInboxStore'
import { depackagedFormatFromJson } from './inboxBeapRowEligibility'

/** User's own qBEAP echo in inbox — not an incoming message to redirect/clone. */
export function isBeapQbeapOutboundEcho(msg: InboxMessage): boolean {
  // PR 5.1: read format from depackaged_metadata first; fallback to depackaged_json.
  const fmt = depackagedFormatFromJson(msg.depackaged_json, msg.depackaged_metadata)
  return fmt === 'beap_qbeap_outbound'
}
