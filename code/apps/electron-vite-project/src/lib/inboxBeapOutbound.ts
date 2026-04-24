import type { InboxMessage } from '../stores/useEmailInboxStore'

/** User's own qBEAP echo in inbox — not an incoming message to redirect/clone. */
export function isBeapQbeapOutboundEcho(msg: InboxMessage): boolean {
  if (!msg.depackaged_json) return false
  try {
    const d = JSON.parse(msg.depackaged_json) as { format?: string }
    return d.format === 'beap_qbeap_outbound'
  } catch {
    return false
  }
}
