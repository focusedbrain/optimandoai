/**
 * Inbox AI cloud policy (roadmap item 0.15, decision D-37).
 *
 * A stored API key is not consent. Inbox AI may send message content to a remote model
 * only when the caller has checked the content: BEAP-origin messages follow their
 * handshake's AI policy (`ai_processing_mode`); a BEAP row whose handshake is unknown,
 * or a message id that does not resolve, denies. Plain e-mail is the user's own data
 * and follows the user's explicit cloud preference.
 */

import { baselineFromHandshake } from '../handshake/contextGovernance'
import { getHandshakeRecord } from '../handshake/db'

export interface InboxCloudPolicy {
  readonly cloudAllowed: boolean
  readonly reason: string
}

export const INBOX_CLOUD_POLICY_UNCHECKED: InboxCloudPolicy = { cloudAllowed: false, reason: 'content_not_checked' }

export function inboxCloudPolicyForMessages(db: any, messageIds: readonly string[]): InboxCloudPolicy {
  if (!db || messageIds.length === 0) return INBOX_CLOUD_POLICY_UNCHECKED
  const stmt = db.prepare('SELECT source_type, handshake_id FROM inbox_messages WHERE id = ?')
  for (const id of messageIds) {
    const row = stmt.get(id) as { source_type?: string; handshake_id?: string | null } | undefined
    if (!row) return { cloudAllowed: false, reason: 'message_not_found' }
    if (row.source_type === 'email_plain' && !row.handshake_id) continue
    if (!row.handshake_id) return { cloudAllowed: false, reason: 'beap_without_handshake' }
    const record = getHandshakeRecord(db, row.handshake_id)
    if (!record) return { cloudAllowed: false, reason: 'handshake_not_found' }
    if (!baselineFromHandshake(record).cloud_ai_allowed) {
      return { cloudAllowed: false, reason: 'handshake_ai_policy_local_only' }
    }
  }
  return { cloudAllowed: true, reason: 'checked' }
}
