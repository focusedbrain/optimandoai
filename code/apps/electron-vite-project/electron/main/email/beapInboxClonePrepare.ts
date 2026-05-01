/**
 * Validate + extract plaintext for BEAP inbox → internal sandbox clone (new package in renderer; no wire reuse).
 * Eligibility: internal ACTIVE host↔sandbox, same identity, peer sandbox role, keys + relay (see internalSandboxesApi).
 */

import { extractInboxMessageRedirectSourceFromRow } from './beapRedirectSource'
import { getHandshakeRecord } from '../handshake/db'
import { resolveInboxReplyMode } from '../../../src/lib/inboxAiCloneClassification'
import {
  isEligibleActiveInternalHostSandboxRecord,
  listAvailableInternalSandboxes,
  type SandboxOrchestratorAvailabilityStatus,
} from '../handshake/internalSandboxesApi'
import type { SSOSession } from '../handshake/types'

export type BeapInboxClonePrepareOk = {
  ok: true
  source_message_id: string
  source_type: string
  original_response_path: 'email' | 'native_beap'
  reply_transport: 'email' | 'native_beap'
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
  /** Audit: default inbox toolbar clone, or link-warning / artifact review flow. */
  clone_reason: 'sandbox_test' | 'external_link_or_artifact_review'
  /** ISO time when clone is prepared; renderer may refresh `cloned_at` at send time. */
  cloned_at: string
  cloned_by_account: string | null
  /** P2P / relay hint from internal sandbox list + health (same as toolbar). */
  live_status_optional: 'relay_connected' | 'relay_disconnected' | 'coordination_disabled'
  last_known_delivery_status: string
  p2p_endpoint_set: boolean
  account_tag: string | null
  /** Set when the user invoked clone from the external-link warning dialog. */
  triggered_url?: string | null
}

export type BeapInboxClonePrepareOptions = {
  clone_reason: 'sandbox_test' | 'external_link_or_artifact_review'
  /** URL the user was about to open; embedded in provenance (not a wire reuse). */
  triggered_url?: string
}

/** Structured failure for `inbox:cloneBeapToSandbox` / prepare (UI + logs). */
export type BeapInboxCloneErrorCode =
  | 'MESSAGE_NOT_FOUND'
  | 'MESSAGE_CONTENT_NOT_EXTRACTABLE'
  | 'NO_ACTIVE_SANDBOX_HANDSHAKE'
  | 'INCOMPLETE_SANDBOX_KEYING'
  | 'TARGET_HANDSHAKE_REQUIRED'
  | 'SANDBOX_TARGET_NOT_CONNECTED'
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

/**
 * Inbox list / query is the access boundary. Prepare does not re-check row `account_id` or
 * email/BEAP identities against the session; isolation belongs in listing and storage.
 *
 * @param session - Current SSO session (for sandbox target filtering only).
 * @param targetHandshakeId - When omitted, must be exactly one `sandbox_keying_complete` sandbox in the list.
 */
export function prepareBeapInboxSandboxClone(
  db: any,
  session: SSOSession | null | undefined,
  sourceMessageId: string,
  targetHandshakeId: string | undefined,
  accountTag: string | null,
  cloneOptions?: BeapInboxClonePrepareOptions,
): BeapInboxClonePrepareResult {
  if (!db) return { ok: false, error: 'Database unavailable' }
  if (!session) return { ok: false, error: 'Not logged in' }

  const srcId = String(sourceMessageId ?? '').trim()
  if (!srcId) {
    return { ok: false, error: 'sourceMessageId is required' }
  }

  const row = db
    .prepare(
      `SELECT id, source_type, handshake_id, subject, body_text, depackaged_json, beap_package_json, has_attachments, from_address, account_id, received_at, ingested_at
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
        beap_package_json?: string | null
        has_attachments?: number | null
        from_address?: string | null
        account_id?: string | null
        received_at?: string | null
        ingested_at?: string | null
      }
    | undefined

  if (!row) {
    return { ok: false, code: 'MESSAGE_NOT_FOUND', error: 'Inbox message was not found.' }
  }

  const list = listAvailableInternalSandboxes(db, session)
  if (!list.success) {
    return { ok: false, error: list.error || 'Could not list internal sandboxes' }
  }

  const sendable = list.sandboxes.filter((s) => s.sandbox_keying_complete)
  let tgtId = String(targetHandshakeId ?? '').trim()
  if (!tgtId) {
    if (list.sandboxes.length === 0) {
      const sa = list.sandbox_availability
      const details: BeapInboxCloneNoSandboxDetails = {
        eligible_count: 0,
        internal_sandbox_list_count: 0,
        relay_connected: sa.relay_connected,
        use_coordination: sa.use_coordination,
        availability_status: sa.status,
      }
      return {
        ok: false,
        code: 'NO_ACTIVE_SANDBOX_HANDSHAKE',
        error: 'No active internal Host ↔ Sandbox handshake is available.',
        details,
      }
    }
    if (sendable.length === 0) {
      return {
        ok: false,
        code: 'INCOMPLETE_SANDBOX_KEYING',
        error:
          'Sandbox handshake is active but missing BEAP key material. Reconnect or repair the internal handshake.',
        details: { internal_sandbox_list_count: list.sandboxes.length },
      }
    }
    if (sendable.length > 1) {
      return {
        ok: false,
        code: 'TARGET_HANDSHAKE_REQUIRED',
        error: 'targetHandshakeId is required when multiple sandboxes are available',
        details: { eligible_count: sendable.length },
      }
    }
    tgtId = sendable[0]!.handshake_id
  }

  const targetRecord = getHandshakeRecord(db, tgtId)
  if (!targetRecord) {
    return { ok: false, code: 'SANDBOX_TARGET_NOT_CONNECTED', error: 'Sandbox target handshake was not found.' }
  }
  if (!isEligibleActiveInternalHostSandboxRecord(targetRecord, session)) {
    return {
      ok: false,
      code: 'SANDBOX_TARGET_NOT_CONNECTED',
      error: 'Sandbox target is not an eligible ACTIVE internal Host → Sandbox handshake for this device.',
    }
  }
  if (!targetRecord.p2p_endpoint?.trim()) {
    return { ok: false, code: 'SANDBOX_TARGET_NOT_CONNECTED', error: 'Sandbox handshake has no P2P endpoint.' }
  }
  if (!targetRecord.local_x25519_public_key_b64?.trim()) {
    return { ok: false, code: 'SANDBOX_TARGET_NOT_CONNECTED', error: 'Sandbox handshake has no bound local encryption key.' }
  }
  const entry = list.sandboxes.find((s) => s.handshake_id === tgtId)
  if (!entry) {
    return { ok: false, code: 'SANDBOX_TARGET_NOT_CONNECTED', error: 'Target handshake is not in the current internal Sandbox list.' }
  }
  if (!entry.sandbox_keying_complete) {
    return {
      ok: false,
      code: 'INCOMPLETE_SANDBOX_KEYING',
      error:
        'Sandbox handshake is active but missing BEAP key material. Reconnect or repair the internal handshake.',
    }
  }

  const extracted = extractInboxMessageRedirectSourceFromRow(row)
  if (!extracted.ok) {
    return {
      ok: false,
      code: 'MESSAGE_CONTENT_NOT_EXTRACTABLE',
      error: extracted.error,
      details: { reason: 'extraction_failed' as const, extraction_error: extracted.error },
    }
  }

  const reason: 'sandbox_test' | 'external_link_or_artifact_review' =
    cloneOptions?.clone_reason === 'external_link_or_artifact_review'
      ? 'external_link_or_artifact_review'
      : 'sandbox_test'
  const provTriggered = (cloneOptions?.triggered_url ?? '').trim()
  const originalResponsePath = resolveInboxReplyMode(row)
  const replyTransport = originalResponsePath
  const provenance = {
    source_message_id: extracted.message_id,
    original_source_type: extracted.source_type,
    original_response_path: originalResponsePath,
    reply_transport: replyTransport,
    sandbox_clone: true,
    original_handshake_id: extracted.original_handshake_id,
    clone_reason: reason,
    cloned_at: new Date().toISOString(),
    target_sandbox_handshake_id: tgtId,
    ...(provTriggered ? { triggered_url: provTriggered } : {}),
  }
  const encWithProvenance = `${extracted.encrypted_text}\n\n---\n${JSON.stringify({ inbox_sandbox_clone_provenance: provenance })}`

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
    original_response_path: originalResponsePath,
    reply_transport: replyTransport,
    original_handshake_id: extracted.original_handshake_id,
    original_received_at: receivedAt,
    subject: extracted.subject,
    public_text: extracted.public_text,
    encrypted_text: encWithProvenance,
    has_attachments: (row.has_attachments ?? 0) > 0,
    ...(extracted.content_warning ? { content_warning: extracted.content_warning } : {}),
    from_address: row.from_address?.trim() || null,
    target_handshake_id: tgtId,
    sandbox_target_device_id: entry.peer_device_id,
    sandbox_target_handshake_id: tgtId,
    target_sandbox_device_name: deviceName,
    sandbox_target_pairing_code: pairing,
    clone_reason: reason,
    cloned_at: new Date().toISOString(),
    cloned_by_account: clonedBy,
    live_status_optional: live,
    last_known_delivery_status: entry.last_known_delivery_status,
    p2p_endpoint_set: entry.p2p_endpoint_set,
    account_tag: accountTag,
    ...(provTriggered ? { triggered_url: provTriggered } : {}),
  }
}
