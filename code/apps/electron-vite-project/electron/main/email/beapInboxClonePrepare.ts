/**
 * Validate + extract plaintext for BEAP inbox → internal sandbox clone (new package in renderer; no wire reuse).
 * Source rows are read **only** via `sealedQuery` (vault-unlocked seal gate — see `ensureSealedStorageReadyForSandboxClone`).
 * Eligibility: internal ACTIVE host↔sandbox, same identity, peer sandbox role, keys + relay (see internalSandboxesApi).
 */

import { extractInboxMessageRedirectSourceFromRow } from './beapRedirectSource'
import { getHandshakeRecord } from '../handshake/db'
import { resolveInboxReplyMode } from '../../../src/lib/inboxAiCloneClassification'
import { isKeyProviderBound, sealedQuery, SealVerificationError } from '../sealed-storage'
import { ensureValidatorAndSealedStorageReady } from '../validatorReadiness'
import { vaultService } from '../vault/service'
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
  /**
   * PR 5.2 / Decision B: source body bytes, no provenance appended.
   * Provenance moves to `inboxResponsePathMetadata.sandbox_clone_provenance` in the
   * new qBEAP package, keeping the cloned body byte-equivalent to the source.
   */
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
  /**
   * PR 5.2 / Decision A: session import artefact extracted from the source row's
   * canonical `depackaged_json`. Null when absent or extraction fails.
   * Passed to BeapPackageConfig.sessionImportArtefact by the renderer.
   */
  session_import_artefact: Record<string, unknown> | null
}

export type BeapInboxClonePrepareOptions = {
  clone_reason?: 'sandbox_test' | 'external_link_or_artifact_review'
  /** URL the user was about to open; embedded in provenance (not a wire reuse). */
  triggered_url?: string
  /** Correlates `[CLONE_PREPARE]` logs with renderer `_cloneId` / IPC clone id. */
  clone_audit_id?: string
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
  /** Outer vault not ready or validator seal gate not bound — sealed inbox reads require outer vault + bound key provider. */
  | 'outer_vault_or_key_provider_unavailable'

/** User-facing copy when sealed-storage gate blocks clone prepare (avoid leaking gate internals). */
export const CLONE_PREPARE_SEAL_GATE_USER_MESSAGE =
  'Vault must be unlocked before cloning this message.'

export type ClonePrepareSealGateResult =
  | { ok: true }
  | { ok: false; code: 'outer_vault_or_key_provider_unavailable'; error: string }

/**
 * Preflight for sandbox clone prepare: sealedQuery requires `bindKeyProvider`
 * (wired when `ValidatorOrchestrator.start` completes after vault unlock/create).
 *
 * Delegates to `ensureValidatorAndSealedStorageReady` which handles:
 * - Fast path when key provider is already bound.
 * - Vault locked → immediate failure.
 * - In-flight start (vault.unlock fired start() non-awaited): polls up to 15 s.
 * - Unstarted or dead subprocess: awaits start() directly.
 *
 * All outcomes map to `ClonePrepareSealGateResult` for the existing ipc.ts caller.
 */
export async function ensureSealedStorageReadyForSandboxClone(cloneId: string): Promise<ClonePrepareSealGateResult> {
  const status = vaultService.getStatus()
  // outerVaultReady: outer vault session active (master-password unlocked, VMK in memory).
  // The inner vault (HA mode) must NOT be required for clone prepare.
  const outerVaultReady = status?.isUnlocked === true

  const keyProviderBound = isKeyProviderBound()

  console.log(
    `[CLONE_PREPARE] sealed_storage_check cloneId=${cloneId} outerVaultReady=${outerVaultReady} keyProviderBound=${keyProviderBound}`,
  )

  if (keyProviderBound) {
    console.log(`[CLONE_PREPARE] sealed_storage_ready cloneId=${cloneId} ready=true`)
    return { ok: true }
  }

  if (!outerVaultReady) {
    console.log(
      `[CLONE_PREPARE] sealed_storage_unavailable cloneId=${cloneId} reason=outer_vault_or_key_provider_unavailable`,
    )
    return {
      ok: false,
      code: 'outer_vault_or_key_provider_unavailable',
      error: CLONE_PREPARE_SEAL_GATE_USER_MESSAGE,
    }
  }

  console.log(`[CLONE_PREPARE] sealed_storage_rebind_attempt cloneId=${cloneId}`)
  const result = await ensureValidatorAndSealedStorageReady('clone_prepare')

  if (!result.ok) {
    console.log(
      `[CLONE_PREPARE] sealed_storage_unavailable cloneId=${cloneId} reason=outer_vault_or_key_provider_unavailable`,
    )
    return {
      ok: false,
      code: 'outer_vault_or_key_provider_unavailable',
      error: CLONE_PREPARE_SEAL_GATE_USER_MESSAGE,
    }
  }

  console.log(`[CLONE_PREPARE] sealed_storage_ready cloneId=${cloneId} ready=true`)
  return { ok: true }
}

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

  const auditCloneId = cloneOptions?.clone_audit_id ?? 'unknown'

  // B-9 Decision B: source read goes through sealedQuery so the parent seal is
  // verified and tampered rows are filtered before their content is extracted.
  // A tampered row returns an empty array → MESSAGE_NOT_FOUND → no clone.
  // seal and seal_input_json are included in the SELECT so sealedQuery can
  // verify the HMAC; they are not used by the prepare logic itself.
  let sealedRows: Array<{
    id: string
    source_type?: string | null
    handshake_id?: string | null
    subject?: string | null
    body_text?: string | null
    depackaged_json?: string | null
    depackaged_metadata?: string | null
    beap_package_json?: string | null
    has_attachments?: number | null
    from_address?: string | null
    account_id?: string | null
    received_at?: string | null
    ingested_at?: string | null
    seal: string
    seal_input_json: string
  }>
  try {
    sealedRows = sealedQuery(
      db,
      // PR 5.2 / Step A: include depackaged_metadata so the prepare function can
      // use it for format-based routing and artefact extraction fallbacks.
      `SELECT id, source_type, handshake_id, subject, body_text,
              depackaged_json, depackaged_metadata,
              beap_package_json, has_attachments, from_address,
              account_id, received_at, ingested_at,
              seal, seal_input_json
       FROM inbox_messages WHERE id = ?`,
      [srcId],
      'depackaged_json',
    )
  } catch (err: unknown) {
    if (err instanceof SealVerificationError) {
      console.warn('[CLONE_PREPARE] sealedQuery SealVerificationError:', err.message)
      return {
        ok: false,
        code: 'outer_vault_or_key_provider_unavailable',
        error: CLONE_PREPARE_SEAL_GATE_USER_MESSAGE,
      }
    }
    throw err
  }
  const row = sealedRows[0]

  if (!row) {
    return { ok: false, code: 'MESSAGE_NOT_FOUND', error: 'Inbox message was not found.' }
  }

  console.log(`[CLONE_PREPARE] source_loaded cloneId=${auditCloneId} sourceMessageId=${srcId}`)

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

  // PR 5.2 / Decision B: body is source bytes only — provenance moves to
  // `inboxResponsePathMetadata.sandbox_clone_provenance` in the new qBEAP package.
  // No provenance append here.

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

  // PR 5.2 / Decision A: extract session import artefact from canonical position.
  const session_import_artefact = extractSourceSessionImportArtefact(row.depackaged_json)

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
    encrypted_text: extracted.encrypted_text,
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
    session_import_artefact,
  }
}

/**
 * PR 5.2 / Step B: Extract the session import artefact from the canonical top-level
 * position in `depackaged_json`. Returns null when absent, malformed, or not an object.
 *
 * Does NOT validate the artefact's structure — the sandbox's receive pipeline
 * (validator gate per PR 2 / 2.1 / 2.2) is the canonical validation point.
 * If extraction fails, clone proceeds without an artefact per Decision E.
 */
function extractSourceSessionImportArtefact(
  depackaged_json: string | null | undefined,
): Record<string, unknown> | null {
  if (!depackaged_json?.trim()) return null
  try {
    const parsed = JSON.parse(depackaged_json) as Record<string, unknown>
    const artefact = parsed.session_import_artefact
    if (artefact && typeof artefact === 'object' && !Array.isArray(artefact)) {
      return artefact as Record<string, unknown>
    }
    return null
  } catch (err) {
    console.warn(
      '[CLONE_PREPARE] extractSourceSessionImportArtefact: failed to parse depackaged_json —',
      (err as Error)?.message ?? err,
    )
    return null
  }
}
