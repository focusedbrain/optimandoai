/**
 * Validate + extract plaintext for BEAP inbox → internal sandbox clone (new package in renderer; no wire reuse).
 * Eligibility: internal ACTIVE host↔sandbox, same identity, peer sandbox role, keys + relay (see internalSandboxesApi).
 */

import { extractBeapRedirectSourceFromRow } from './beapRedirectSource'
import { getHandshakeRecord } from '../handshake/db'
import {
  isBeapCloneEligibleForRecord,
  isEligibleActiveInternalHostSandboxRecord,
  listAvailableInternalSandboxes,
  P2P_BEAP_INBOX_ACCOUNT_ID,
  type SandboxOrchestratorAvailabilityStatus,
} from '../handshake/internalSandboxesApi'
import type { SSOSession } from '../handshake/types'

export type BeapInboxClonePrepareOk = {
  ok: true
  source_message_id: string
  source_type: string
  original_handshake_id: string | null
  original_received_at: string | null
  subject: string
  public_text: string
  encrypted_text: string
  has_attachments: boolean
  content_warning?: string
  from_address: string | null
  target_handshake_id: string
  sandbox_target_device_id: string
  sandbox_target_handshake_id: string
  /** Display name of the sandbox peer device (audit + UI). */
  target_sandbox_device_name: string | null
  sandbox_target_pairing_code: string | null
  /** Fixed audit value for this product path. */
  clone_reason: 'sandbox_test'
  /** ISO time when clone is prepared; renderer may refresh `cloned_at` at send time. */
  cloned_at: string
  cloned_by_account: string | null
  /** P2P / relay hint from internal sandbox list + health (same as toolbar). */
  live_status_optional: 'relay_connected' | 'relay_disconnected' | 'coordination_disabled'
  last_known_delivery_status: string
  p2p_endpoint_set: boolean
  account_tag: string | null
}

/** Structured failure for `inbox:cloneBeapToSandbox` / prepare (UI + logs). */
export type BeapInboxCloneErrorCode =
  | 'NO_SANDBOX_CONNECTED'
  | 'TARGET_HANDSHAKE_REQUIRED'
  | 'SOURCE_NOT_RECEIVED_BEAP'
  | 'PREPARE_FAILED'

export type BeapInboxCloneNoSandboxDetails = {
  eligible_count: 0
  /** Internal host↔sandbox rows (identity-complete; may lack keying or relay). */
  internal_sandbox_list_count: number
  relay_connected: boolean
  use_coordination: boolean
  /** Tri-state from `listAvailableInternalSandboxes` — which dialog variant to show. */
  availability_status: SandboxOrchestratorAvailabilityStatus
}

export type BeapInboxClonePrepareResult =
  | BeapInboxClonePrepareOk
  | { ok: false; error: string; code?: BeapInboxCloneErrorCode; details?: BeapInboxCloneNoSandboxDetails | Record<string, unknown> }

function assertInboxMessageOwned(
  accountId: string,
  sourceType: string | null | undefined,
  allowedAccountIds: ReadonlySet<string>,
): { ok: true } | { ok: false; error: string } {
  const id = (accountId ?? '').trim()
  if (!id) {
    return { ok: false, error: 'Inbox message has no account' }
  }
  if (id === P2P_BEAP_INBOX_ACCOUNT_ID) {
    if (sourceType === 'direct_beap' || sourceType === 'email_beap' || !sourceType) {
      return { ok: true }
    }
  }
  if (allowedAccountIds.has(id)) {
    return { ok: true }
  }
  return { ok: false, error: 'Inbox message does not belong to the current account' }
}

/**
 * @param session - Current SSO session (account scope).
 * @param targetHandshakeId - When omitted, must be exactly one `beap_clone_eligible` sandbox in the list.
 * @param allowedInboxAccountIds - Email `account_id` values for the logged-in user (from gateway).
 */
export function prepareBeapInboxSandboxClone(
  db: any,
  session: SSOSession | null | undefined,
  sourceMessageId: string,
  targetHandshakeId: string | undefined,
  accountTag: string | null,
  allowedInboxAccountIds: ReadonlySet<string>,
): BeapInboxClonePrepareResult {
  if (!db) return { ok: false, error: 'Database unavailable' }
  if (!session) return { ok: false, error: 'Not logged in' }

  const srcId = String(sourceMessageId ?? '').trim()
  if (!srcId) {
    return { ok: false, error: 'sourceMessageId is required' }
  }

  const row = db
    .prepare(
      `SELECT id, source_type, handshake_id, subject, body_text, depackaged_json, has_attachments, from_address, account_id, received_at, ingested_at
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
        account_id?: string | null
        received_at?: string | null
        ingested_at?: string | null
      }
    | undefined

  if (!row) {
    return { ok: false, error: 'Source message not found' }
  }

  const depStr = typeof row.depackaged_json === 'string' ? row.depackaged_json.trim() : ''
  if (depStr) {
    try {
      const dj = JSON.parse(depStr) as { format?: string }
      if (dj?.format === 'beap_qbeap_outbound') {
        return {
          ok: false,
          code: 'SOURCE_NOT_RECEIVED_BEAP',
          error: 'Sandbox clone applies only to received BEAP messages, not outbound sends.',
        }
      }
    } catch {
      /* ignore */
    }
  }

  const own = assertInboxMessageOwned(row.account_id ?? '', row.source_type, allowedInboxAccountIds)
  if (!own.ok) {
    return own
  }

  const list = listAvailableInternalSandboxes(db, session)
  if (!list.success) {
    return { ok: false, error: list.error || 'Could not list internal sandboxes' }
  }

  let tgtId = String(targetHandshakeId ?? '').trim()
  const eligible = list.sandboxes.filter((s) => s.beap_clone_eligible)
  if (!tgtId) {
    if (eligible.length === 0) {
      const sa = list.sandbox_availability
      const details: BeapInboxCloneNoSandboxDetails = {
        eligible_count: 0,
        internal_sandbox_list_count: list.sandboxes.length,
        relay_connected: sa.relay_connected,
        use_coordination: sa.use_coordination,
        availability_status: sa.status,
      }
      return {
        ok: false,
        code: 'NO_SANDBOX_CONNECTED',
        error: 'No eligible sandbox orchestrator is connected for the live send path.',
        details,
      }
    }
    if (eligible.length > 1) {
      return {
        ok: false,
        code: 'TARGET_HANDSHAKE_REQUIRED',
        error: 'targetHandshakeId is required when multiple sandboxes are available',
        details: { eligible_count: eligible.length },
      }
    }
    tgtId = eligible[0]!.handshake_id
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
  const liveForTgt = list.sandboxes.find((s) => s.handshake_id === tgtId)?.live_status_optional ?? 'coordination_disabled'
  if (!isBeapCloneEligibleForRecord(targetRecord, liveForTgt)) {
    return { ok: false, error: 'Target sandbox is not connected or is missing key material' }
  }

  const entry = list.sandboxes.find((s) => s.handshake_id === tgtId)
  if (!entry) {
    return { ok: false, error: 'Target handshake is not in the current internal sandbox list' }
  }
  if (!entry.beap_clone_eligible) {
    return { ok: false, error: 'Target sandbox is not available for clone (relay or keys)' }
  }

  const extracted = extractBeapRedirectSourceFromRow(row)
  if (!extracted.ok) {
    return extracted
  }

  const live = entry.live_status_optional ?? 'coordination_disabled'
  const receivedAt = row.received_at?.trim() || row.ingested_at?.trim() || null
  const pairing =
    (targetRecord.internal_peer_pairing_code?.trim() &&
      /^\d{6}$/.test(targetRecord.internal_peer_pairing_code.trim()) &&
      targetRecord.internal_peer_pairing_code.trim()) ||
    entry.peer_pairing_code_six
  const clonedBy =
    (session.email && String(session.email).trim()) ||
    (session.sub && String(session.sub).trim()) ||
    (session.wrdesk_user_id && String(session.wrdesk_user_id).trim()) ||
    null

  const deviceName = entry.peer_device_name?.trim() || null

  return {
    ok: true,
    source_message_id: extracted.message_id,
    source_type: extracted.source_type,
    original_handshake_id: extracted.original_handshake_id,
    original_received_at: receivedAt,
    subject: extracted.subject,
    public_text: extracted.public_text,
    encrypted_text: extracted.encrypted_text,
    has_attachments: (row.has_attachments ?? 0) > 0,
    ...(extracted.content_warning ? { content_warning: extracted.content_warning } : {}),
    from_address: row.from_address?.trim() || null,
    target_handshake_id: tgtId,
    sandbox_target_device_id: entry.peer_device_id,
    sandbox_target_handshake_id: tgtId,
    target_sandbox_device_name: deviceName,
    sandbox_target_pairing_code: pairing,
    clone_reason: 'sandbox_test',
    cloned_at: new Date().toISOString(),
    cloned_by_account: clonedBy,
    live_status_optional: live,
    last_known_delivery_status: entry.last_known_delivery_status,
    p2p_endpoint_set: entry.p2p_endpoint_set,
    account_tag: accountTag,
  }
}
