/**
 * Validate + extract plaintext for BEAP inbox → internal sandbox clone (new package in renderer; no wire reuse).
 * Source rows are read only via `sealedQuery` (full HMAC verify). Seal gate: `ensureSealedStorageReadyForSandboxClone`.
 * Eligibility: internal ACTIVE host↔sandbox, same identity, peer sandbox role, keys + relay (see internalSandboxesApi).
 */

import { extractClonePrepareSourceFromRow } from './beapRedirectSource'
import { getHandshakeRecord } from '../handshake/db'
import {
  inboxRowIsClonedPlainEmail,
  resolveInboxReplyMode,
  type InboxMessageAiClassificationRow,
} from '../../../src/lib/inboxAiCloneClassification'
import { isKeyProviderUsable, sealedQuery, SealVerificationError } from '../sealed-storage'
import { canPerform } from '../vault/capabilityBroker'
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
   * Passed to BeapPackageConfig.sessionImportArtefact by the renderer (native BEAP clones only).
   */
  session_import_artefact: Record<string, unknown> | null
  /**
   * Provenance `original_inbox_source_type` for the sandbox row — `email_plain` when the clone
   * profile is depackaged email even if the DB row is `email_beap`.
   */
  provenance_original_inbox_source_type: string
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
  /** Outer vault session not active — vault exists but was not unlocked (or auto-locked). */
  | 'outer_vault_or_key_provider_unavailable'
  /** No vault found for the current SSO account — vault not created or all vaults are legacy-unclaimed. */
  | 'outer_vault_unavailable'
  /** Source row uses VMK seal (seal_key_source vmk/null) but inner key provider is not bound. */
  | 'inner_vault_or_key_provider_unavailable'

/** User-facing copy when the vault session is not active (vault exists but locked). */
export const CLONE_PREPARE_SEAL_GATE_USER_MESSAGE =
  'Your vault must be unlocked before cloning this message. Enter your master password and try again.'

/** Same UX as seal gate — master-password vault required for VMK-sealed inbox rows. */
export const CLONE_PREPARE_INNER_VAULT_USER_MESSAGE = CLONE_PREPARE_SEAL_GATE_USER_MESSAGE

/**
 * Metadata-only probe: which seal key verifies this inbox row (no canonical content read).
 */
export function probeInboxMessageSealKeySource(
  db: {
    prepare: (sql: string) => { get: (...args: unknown[]) => { seal_key_source?: string | null } | undefined }
  },
  messageId: string,
): 'ledger' | 'vmk' | null {
  try {
    const row = db
      .prepare('SELECT seal_key_source FROM inbox_messages WHERE id = ?')
      .get(messageId) as { seal_key_source?: string | null } | undefined
    if (!row) return null
    return row.seal_key_source === 'ledger' ? 'ledger' : 'vmk'
  } catch {
    return null
  }
}

import {
  isDepackagedEmailInboxSourceType,
  inboxRowRequiresInnerVault,
} from './inboxRowSealPolicy'

export { isDepackagedEmailInboxSourceType } from './inboxRowSealPolicy'

function depackagedFormatForCloneRow(row: {
  depackaged_json?: string | null
  depackaged_metadata?: string | null
}): string | null {
  for (const src of [row.depackaged_metadata, row.depackaged_json]) {
    if (!src?.trim()) continue
    try {
      const d = JSON.parse(src) as { format?: string }
      if (typeof d.format === 'string') return d.format
    } catch {
      /* continue */
    }
  }
  return null
}

/**
 * Clone-only response-path semantics. Do not use {@link resolveInboxReplyMode} here — it treats
 * `email_beap` + `handshake_id` as native BEAP and breaks sandbox AI / body layout for depackaged mail.
 */
export function resolveClonePrepareResponsePath(
  row: InboxMessageAiClassificationRow & {
    depackaged_metadata?: string | null
  },
): 'email' | 'native_beap' {
  if (inboxRowIsClonedPlainEmail(row)) return 'email'
  const st = String(row.source_type ?? '').trim()
  if (st === 'email_plain' || st === 'email_beap') {
    return rowHasNativeBeapSessionForClone(row) ? 'native_beap' : 'email'
  }
  if (st === 'direct_beap') {
    const fmt = depackagedFormatForCloneRow(row)
    if (rowHasNativeBeapSessionForClone(row)) return 'native_beap'
    if (fmt === 'beap_qbeap_decrypted' || fmt === 'beap_qbeap_pending_main') return 'native_beap'
    return 'native_beap'
  }
  return resolveInboxReplyMode(row) === 'native_beap' ? 'native_beap' : 'email'
}

function rowHasNativeBeapSessionForClone(row: {
  depackaged_json?: string | null
}): boolean {
  return extractSourceSessionImportArtefact(row.depackaged_json) != null
}

/** Provenance field on the sandbox clone — keeps depackaged-email clones on the email AI path. */
export function cloneProvenanceOriginalInboxSourceType(
  row: { source_type?: string | null },
  responsePath: 'email' | 'native_beap',
): string {
  if (responsePath === 'email') return 'email_plain'
  return String(row.source_type ?? 'direct_beap').trim() || 'direct_beap'
}

/**
 * Inner vault is required for clone when:
 * - Native BEAP on a confidential handshake, or
 * - Row was sealed with the inner (VMK) key (`seal_key_source='vmk'`).
 * Depackaged email (`email_plain` / `email_beap`) is never confidential.
 */
export function inboxCloneRequiresInnerVault(opts: {
  sourceType: string | null
  handshakeId: string | null
  sealKeySource?: 'ledger' | 'vmk' | null
}): boolean {
  return inboxRowRequiresInnerVault({
    source_type: opts.sourceType,
    handshake_id: opts.handshakeId,
  })
}

/** @deprecated Use `inboxCloneRequiresInnerVault` — kept for tests that assert legacy seal_key_source helper. */
export function inboxSealKeySourceRequiresInnerVault(sealKeySource: 'ledger' | 'vmk' | null): boolean {
  if (sealKeySource === null) return false
  return sealKeySource !== 'ledger'
}

export type InboxCloneVaultRequirementProbe = {
  sourceType: string | null
  handshakeId: string | null
  sealKeySource: 'ledger' | 'vmk' | null
  requiresInnerVault: boolean
  isDepackagedEmail: boolean
}

export function probeInboxMessageCloneVaultRequirement(
  db: {
    prepare: (sql: string) => {
      get: (...args: unknown[]) =>
        | {
            source_type?: string | null
            handshake_id?: string | null
            seal_key_source?: string | null
          }
        | undefined
    }
  },
  messageId: string,
): InboxCloneVaultRequirementProbe | null {
  try {
    const row = db
      .prepare(
        'SELECT source_type, handshake_id, seal_key_source FROM inbox_messages WHERE id = ?',
      )
      .get(messageId) as
      | { source_type?: string | null; handshake_id?: string | null; seal_key_source?: string | null }
      | undefined
    if (!row) return null
    const sourceType = row.source_type != null ? String(row.source_type) : null
    const handshakeId = row.handshake_id != null ? String(row.handshake_id) : null
    const sealKeySource = row.seal_key_source === 'ledger' ? 'ledger' : 'vmk'
    const isDepackagedEmail = isDepackagedEmailInboxSourceType(sourceType)
    return {
      sourceType,
      handshakeId,
      sealKeySource,
      requiresInnerVault: inboxCloneRequiresInnerVault({ sourceType, handshakeId, sealKeySource }),
      isDepackagedEmail,
    }
  } catch {
    return null
  }
}

/** User-facing copy when no vault exists for the current account. */
export const CLONE_PREPARE_VAULT_UNAVAILABLE_MESSAGE =
  'No vault found for your account. Create or claim a vault to enable cloning.'

export type ClonePrepareSealGateResult =
  | { ok: true }
  | {
      ok: false
      code:
        | 'outer_vault_or_key_provider_unavailable'
        | 'outer_vault_unavailable'
        | 'inner_vault_or_key_provider_unavailable'
      error: string
    }

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
export async function ensureSealedStorageReadyForSandboxClone(
  cloneId: string,
  opts?: {
    requiresInnerVault?: boolean
    sourceSealKeySource?: 'ledger' | 'vmk' | null
    handshakeId?: string | null
  },
): Promise<ClonePrepareSealGateResult> {
  const sourceNeedsInner =
    opts?.requiresInnerVault ??
    inboxSealKeySourceRequiresInnerVault(opts?.sourceSealKeySource ?? null)
  const handshakeId = String(opts?.handshakeId ?? '').trim() || undefined

  const outerKeyBound = isKeyProviderUsable('outer')
  const innerKeyBound = isKeyProviderUsable('inner')
  console.log(
    `[CLONE_PREPARE] sealed_storage_check cloneId=${cloneId} outerKeyBound=${outerKeyBound} innerKeyBound=${innerKeyBound} sourceNeedsInner=${sourceNeedsInner} handshake=${handshakeId ?? 'none'}`,
  )

  const gate = canPerform('beap_clone', handshakeId ? { handshakeId } : undefined)
  if (!gate.allowed) {
    if (gate.reasonCode === 'outer_vault_inactive') {
      return {
        ok: false,
        code: 'outer_vault_or_key_provider_unavailable',
        error: gate.userMessage || CLONE_PREPARE_SEAL_GATE_USER_MESSAGE,
      }
    }
    if (sourceNeedsInner || gate.reasonCode === 'inner_vault_locked') {
      return {
        ok: false,
        code: 'inner_vault_or_key_provider_unavailable',
        error: CLONE_PREPARE_INNER_VAULT_USER_MESSAGE,
      }
    }
    if (gate.reasonCode === 'key_provider_unbound') {
      return {
        ok: false,
        code: 'outer_vault_or_key_provider_unavailable',
        error: CLONE_PREPARE_SEAL_GATE_USER_MESSAGE,
      }
    }
    return {
      ok: false,
      code: sourceNeedsInner ? 'inner_vault_or_key_provider_unavailable' : 'outer_vault_or_key_provider_unavailable',
      error: gate.userMessage || CLONE_PREPARE_SEAL_GATE_USER_MESSAGE,
    }
  }

  if (sourceNeedsInner && !isKeyProviderUsable('inner')) {
    return {
      ok: false,
      code: 'inner_vault_or_key_provider_unavailable',
      error: CLONE_PREPARE_INNER_VAULT_USER_MESSAGE,
    }
  }
  if (!sourceNeedsInner && !isKeyProviderUsable('outer') && !isKeyProviderUsable('inner')) {
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

export type ClonePrepareInboxRow = {
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
}

const CLONE_PREPARE_INBOX_SELECT = `SELECT id, source_type, handshake_id, subject, body_text,
              depackaged_json, depackaged_metadata,
              beap_package_json, has_attachments, from_address,
              account_id, received_at, ingested_at,
              seal, seal_input_json, seal_key_source
       FROM inbox_messages WHERE id = ?`

/**
 * Load and verify an inbox row for clone prepare via `sealedQuery` only.
 */
export function readInboxRowForClonePrepare(
  db: any,
  srcId: string,
  vaultReq: InboxCloneVaultRequirementProbe | null,
): { ok: true; row: ClonePrepareInboxRow } | { ok: false; result: BeapInboxClonePrepareResult } {
  const requiresInnerVault = vaultReq?.requiresInnerVault ?? false
  const sealKeySource = vaultReq?.sealKeySource ?? null

  const exists = db.prepare('SELECT id FROM inbox_messages WHERE id = ?').get(srcId) as { id?: string } | undefined
  if (!exists?.id) {
    console.log(`[CLONE_PREPARE] source_missing sourceMessageId=${srcId}`)
    return {
      ok: false,
      result: {
        ok: false,
        code: 'MESSAGE_NOT_FOUND',
        error: 'Inbox message was not found or could not be verified.',
      },
    }
  }

  let sealedRows: ClonePrepareInboxRow[] = []
  try {
    sealedRows = sealedQuery(db, CLONE_PREPARE_INBOX_SELECT, [srcId], 'depackaged_json') as ClonePrepareInboxRow[]
  } catch (err: unknown) {
    if (err instanceof SealVerificationError) {
      console.warn('[CLONE_PREPARE] sealedQuery SealVerificationError:', err.message)
      return {
        ok: false,
        result: {
          ok: false,
          code: requiresInnerVault || sealKeySource === 'vmk'
            ? 'inner_vault_or_key_provider_unavailable'
            : 'outer_vault_or_key_provider_unavailable',
          error: requiresInnerVault || sealKeySource === 'vmk'
            ? CLONE_PREPARE_INNER_VAULT_USER_MESSAGE
            : CLONE_PREPARE_SEAL_GATE_USER_MESSAGE,
        },
      }
    }
    throw err
  }

  if (sealedRows[0]) {
    console.log(`[CLONE_PREPARE] source_loaded_sealed_query sourceMessageId=${srcId}`)
    return { ok: true, row: sealedRows[0] }
  }

  if (requiresInnerVault && !isKeyProviderUsable('inner')) {
    console.log(
      `[CLONE_PREPARE] source_read_blocked sourceMessageId=${srcId} reason=inner_vault_required sealedQuery=empty`,
    )
    return {
      ok: false,
      result: {
        ok: false,
        code: 'inner_vault_or_key_provider_unavailable',
        error: CLONE_PREPARE_INNER_VAULT_USER_MESSAGE,
      },
    }
  }
  if (
    !requiresInnerVault &&
    sealKeySource === 'ledger' &&
    !isKeyProviderUsable('outer') &&
    !isKeyProviderUsable('inner')
  ) {
    return {
      ok: false,
      result: {
        ok: false,
        code: 'outer_vault_or_key_provider_unavailable',
        error: CLONE_PREPARE_SEAL_GATE_USER_MESSAGE,
      },
    }
  }

  console.log(
    `[CLONE_PREPARE] source_read_blocked sourceMessageId=${srcId} seal_key_source=${sealKeySource ?? 'unknown'} requiresInnerVault=${requiresInnerVault}`,
  )
  return {
    ok: false,
    result: {
      ok: false,
      code: 'MESSAGE_NOT_FOUND',
      error: 'Inbox message was not found or could not be verified.',
    },
  }
}

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

  const vaultReq = probeInboxMessageCloneVaultRequirement(db, srcId)
  const sealKeySource = vaultReq?.sealKeySource ?? probeInboxMessageSealKeySource(db, srcId)
  const requiresInnerVault = vaultReq?.requiresInnerVault ?? false
  console.log(
    `[CLONE_PREPARE] source_vault_requirement cloneId=${auditCloneId} sourceMessageId=${srcId} source_type=${vaultReq?.sourceType ?? 'missing'} seal_key_source=${sealKeySource ?? 'missing'} requiresInnerVault=${requiresInnerVault} isDepackagedEmail=${vaultReq?.isDepackagedEmail ?? false}`,
  )
  if (requiresInnerVault && !isKeyProviderUsable('inner')) {
    console.log(
      `[CLONE_PREPARE] sealed_storage_unavailable cloneId=${auditCloneId} reason=inner_vault_required innerKeyBound=false`,
    )
    return {
      ok: false,
      code: 'inner_vault_or_key_provider_unavailable',
      error: CLONE_PREPARE_INNER_VAULT_USER_MESSAGE,
    }
  }
  if (!requiresInnerVault && !isKeyProviderUsable('outer') && !isKeyProviderUsable('inner')) {
    return {
      ok: false,
      code: 'outer_vault_or_key_provider_unavailable',
      error: CLONE_PREPARE_SEAL_GATE_USER_MESSAGE,
    }
  }

  const rowRead = readInboxRowForClonePrepare(db, srcId, vaultReq)
  if (!rowRead.ok) {
    return rowRead.result
  }
  const row = rowRead.row

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

  const cloneResponsePath = resolveClonePrepareResponsePath(row)
  const extracted = extractClonePrepareSourceFromRow(row, cloneResponsePath)
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
  const originalResponsePath = cloneResponsePath
  const replyTransport = cloneResponsePath
  const provenanceOriginalInboxSourceType = cloneProvenanceOriginalInboxSourceType(row, cloneResponsePath)

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

  // PR 5.2 / Decision A: session import only for native BEAP clones (depackaged email has none).
  const session_import_artefact =
    cloneResponsePath === 'native_beap' ? extractSourceSessionImportArtefact(row.depackaged_json) : null

  console.log(
    `[CLONE_PREPARE] clone_profile cloneId=${auditCloneId} sourceMessageId=${srcId} db_source_type=${row.source_type ?? 'unknown'} response_path=${cloneResponsePath} provenance_source_type=${provenanceOriginalInboxSourceType} has_session=${session_import_artefact != null}`,
  )

  return {
    ok: true,
    source_message_id: extracted.message_id,
    source_type: extracted.source_type,
    original_response_path: originalResponsePath,
    reply_transport: replyTransport,
    provenance_original_inbox_source_type: provenanceOriginalInboxSourceType,
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
