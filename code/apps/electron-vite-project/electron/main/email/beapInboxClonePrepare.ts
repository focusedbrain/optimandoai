/**
 * Validate + extract plaintext for BEAP inbox → internal sandbox clone (new package in renderer; no wire reuse).
 */

import { extractBeapRedirectSourceFromRow } from './beapRedirectSource'
import { getHandshakeRecord } from '../handshake/db'
import { isEligibleActiveInternalHostSandboxRecord, listAvailableInternalSandboxes } from '../handshake/internalSandboxesApi'
import type { SSOSession } from '../handshake/types'

export type BeapInboxClonePrepareOk = {
  ok: true
  source_message_id: string
  source_type: string
  original_handshake_id: string | null
  subject: string
  public_text: string
  encrypted_text: string
  has_attachments: boolean
  content_warning?: string
  from_address: string | null
  target_handshake_id: string
  sandbox_target_device_id: string
  sandbox_target_handshake_id: string
  /** P2P / relay hint from internal sandbox list + health (same as toolbar). */
  live_status_optional: 'relay_connected' | 'relay_disconnected' | 'coordination_disabled'
  last_known_delivery_status: string
  p2p_endpoint_set: boolean
  account_tag: string | null
}

export type BeapInboxClonePrepareResult = BeapInboxClonePrepareOk | { ok: false; error: string }

/**
 * @param session - Current SSO session (account scope).
 */
export function prepareBeapInboxSandboxClone(
  db: any,
  session: SSOSession | null | undefined,
  sourceMessageId: string,
  targetHandshakeId: string,
  accountTag: string | null,
): BeapInboxClonePrepareResult {
  if (!db) return { ok: false, error: 'Database unavailable' }
  if (!session) return { ok: false, error: 'Not logged in' }

  const srcId = String(sourceMessageId ?? '').trim()
  const tgtId = String(targetHandshakeId ?? '').trim()
  if (!srcId || !tgtId) {
    return { ok: false, error: 'sourceMessageId and targetHandshakeId are required' }
  }

  const targetRecord = getHandshakeRecord(db, tgtId)
  if (!targetRecord) {
    return { ok: false, error: 'Target handshake not found' }
  }
  if (!isEligibleActiveInternalHostSandboxRecord(targetRecord, session)) {
    return {
      ok: false,
      error:
        'Target is not an eligible ACTIVE internal host→sandbox handshake for this account (identity and roles must match).',
    }
  }
  if (!targetRecord.p2p_endpoint?.trim()) {
    return { ok: false, error: 'Sandbox handshake has no P2P endpoint' }
  }
  if (!targetRecord.local_x25519_public_key_b64?.trim()) {
    return { ok: false, error: 'ERR_HANDSHAKE_LOCAL_KEY_MISSING: sandbox handshake has no bound local X25519 key' }
  }

  const list = listAvailableInternalSandboxes(db, session)
  if (!list.success) {
    return { ok: false, error: list.error || 'Could not list internal sandboxes' }
  }
  const entry = list.sandboxes.find((s) => s.handshake_id === tgtId)
  if (!entry) {
    return { ok: false, error: 'Target handshake is not in the current internal sandbox list' }
  }

  const row = db
    .prepare(
      `SELECT id, source_type, handshake_id, subject, body_text, depackaged_json, has_attachments, from_address
       FROM inbox_messages WHERE id = ?`,
    )
    .get(srcId) as
    | {
        id: string
        source_type?: string | null
        handshake_id?: string | null
        subject?: string | null
        body_text?: string | null
        depackaged_json?: string | null
        has_attachments?: number | null
        from_address?: string | null
      }
    | undefined

  if (!row) {
    return { ok: false, error: 'Source message not found' }
  }

  const extracted = extractBeapRedirectSourceFromRow(row)
  if (!extracted.ok) {
    return extracted
  }

  const live = entry.live_status_optional ?? 'coordination_disabled'

  return {
    ok: true,
    source_message_id: extracted.message_id,
    source_type: extracted.source_type,
    original_handshake_id: extracted.original_handshake_id,
    subject: extracted.subject,
    public_text: extracted.public_text,
    encrypted_text: extracted.encrypted_text,
    has_attachments: (row.has_attachments ?? 0) > 0,
    ...(extracted.content_warning ? { content_warning: extracted.content_warning } : {}),
    from_address: row.from_address?.trim() || null,
    target_handshake_id: tgtId,
    sandbox_target_device_id: entry.peer_device_id,
    sandbox_target_handshake_id: tgtId,
    live_status_optional: live,
    last_known_delivery_status: entry.last_known_delivery_status,
    p2p_endpoint_set: entry.p2p_endpoint_set,
    account_tag: accountTag,
  }
}
