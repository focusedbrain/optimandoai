/**
 * tryEnqueueContextSync — Build and enqueue context_sync capsule, or defer when the send
 * cannot proceed yet.
 *
 * Sets context_sync_pending=1 when: vault is locked, or (internal handshake) relay wire fields
 * are incomplete (INTERNAL_RELAY_ENDPOINTS_INCOMPLETE). P2P startup retries via
 * completePendingContextSyncs. Successful enqueue sets last_seq_sent/last_capsule_hash_sent
 * and clears pending (durable local proof; ACCEPTED → ACTIVE does not use pending alone).
 */

import type { HandshakeProcessResult, SSOSession } from './types'
import { HandshakeState as HS } from './types'
import type { ContextBlockForCommitment } from './contextCommitment'
import type { ContextBlockInput } from './types'
import { getHandshakeRecord, updateHandshakeContextSyncPending, updateHandshakeContextSyncEnqueued } from './db'
import { getContextStoreByHandshake } from './db'
import { buildContextSyncCapsuleWithContent } from './capsuleBuilder'
import { enqueueOutboundCapsule, processOutboundQueue } from './outboundQueue'
import { formatLocalInternalRelayValidationJson } from './internalRelayOutboundGuards'
import { persistContextBlocks } from './contextBlocks'
import { getP2PConfig, getEffectiveRelayEndpoint } from '../p2p/p2pConfig'
import { vaultService } from '../vault/rpc'
import { getInstanceId } from '../orchestrator/orchestratorModeStore'
import { internalRelayCapsuleWireOptsFromRecord } from './internalCoordinationWire'
import {
  parseGovernanceJson,
  resolveEffectiveGovernance,
  filterBlocksForPeerTransmission,
  baselineFromHandshake,
  type LegacyBlockInput,
} from './contextGovernance'

export interface TryEnqueueContextSyncOpts {
  /** Accept capsule hash (seq 0) or last received capsule hash */
  lastCapsuleHash: string
  /** 0 = initial (after accept), 1 = reverse (after receiving context_sync seq 1) */
  lastSeqReceived?: number
  /** Optional: override vault status check (for testing or when vault not available) */
  getVaultStatus?: () => { isUnlocked: boolean }
}

export interface TryEnqueueContextSyncResult {
  success: boolean
  reason?: string
}

/**
 * Try to build and enqueue context_sync. If vault is locked, set context_sync_pending and return.
 */
export function tryEnqueueContextSync(
  db: any,
  handshakeId: string,
  session: SSOSession,
  opts: TryEnqueueContextSyncOpts,
): TryEnqueueContextSyncResult {
  const getVaultStatus = opts.getVaultStatus ?? (() => {
    try {
      const status = vaultService.getStatus()
      return status
    } catch (err: any) {
      console.error('[ContextSync] Failed to read vault status:', err?.message ?? err)
      return { isUnlocked: false }
    }
  })

  const status = getVaultStatus()
  console.log('[ContextSync] Vault status for handshake', handshakeId, ':', JSON.stringify({ isUnlocked: status?.isUnlocked }))
  if (!status?.isUnlocked) {
    try {
      updateHandshakeContextSyncPending(db, handshakeId, true)
      console.log('[ContextSync] Deferred — vault is locked. handshake:', handshakeId)
      return { success: false, reason: 'VAULT_LOCKED' }
    } catch (err: any) {
      console.warn('[ContextSync] Failed to set context_sync_pending:', err?.message)
      return { success: false, reason: 'DB_ERROR' }
    }
  }

  const record = getHandshakeRecord(db, handshakeId)
  if (!record) {
    console.warn('[ContextSync] HANDSHAKE_NOT_FOUND:', handshakeId)
    return { success: false, reason: 'HANDSHAKE_NOT_FOUND' }
  }
  if (record.state !== 'ACCEPTED') {
    console.warn('[ContextSync] INVALID_STATE:', handshakeId, 'state=', record.state)
    return { success: false, reason: 'INVALID_STATE' }
  }

  let localCoordId = ''
  try {
    localCoordId = getInstanceId()?.trim() ?? ''
  } catch {
    localCoordId = ''
  }
  const internalRelayWire = internalRelayCapsuleWireOptsFromRecord(record, localCoordId)
  if (record.handshake_type === 'internal' && !internalRelayWire) {
    console.warn('[ContextSync] INTERNAL_RELAY_ENDPOINTS_INCOMPLETE:', handshakeId)
    // Do not let callers treat this as "our context_sync is out" — ownSent in
    // buildContextSyncRecord uses last_seq_sent >= 1, not `context_sync_pending` alone, for the ACTIVE gate.
    try {
      updateHandshakeContextSyncPending(db, handshakeId, true)
      console.log(
        '[ContextSync] Deferred — internal relay device ids not ready. context_sync_pending=1 handshake:',
        handshakeId,
      )
    } catch (err: any) {
      console.warn('[ContextSync] Failed to set context_sync_pending (INTERNAL_RELAY):', err?.message)
    }
    return { success: false, reason: 'INTERNAL_RELAY_ENDPOINTS_INCOMPLETE' }
  }

  // Resolve the target endpoint: use the stored p2p_endpoint (counterparty's direct address),
  // or fall back to the coordination relay URL when use_coordination=true.
  const p2pConfig = getP2PConfig(db)
  const targetEndpoint = record.p2p_endpoint?.trim() || getEffectiveRelayEndpoint(p2pConfig, null)
  if (!targetEndpoint) {
    console.warn('[ContextSync] NO_P2P_ENDPOINT:', handshakeId)
    return { success: false, reason: 'NO_P2P_ENDPOINT' }
  }

  const localPub = record.local_public_key ?? ''
  const localPriv = record.local_private_key ?? ''
  if (!localPub || !localPriv) {
    console.warn('[ContextSync] NO_SIGNING_KEYS:', handshakeId, 'pub=', !!localPub, 'priv=', !!localPriv)
    return { success: false, reason: 'NO_SIGNING_KEYS' }
  }

  // Resolve allowed blocks (may be empty — we still send an empty context_sync to close the roundtrip)
  const pending = getContextStoreByHandshake(db, handshakeId, 'pending_delivery')
  let allowed: typeof pending = []
  if (pending.length > 0) {
    const baseline = baselineFromHandshake(record)
    allowed = filterBlocksForPeerTransmission(
      pending.map((b) => {
        const legacy: LegacyBlockInput = {
          block_id: b.block_id,
          type: b.type,
          data_classification: undefined,
          scope_id: b.scope_id ?? undefined,
          sender_wrdesk_user_id: b.publisher_id,
          publisher_id: b.publisher_id,
          source: undefined,
        }
        const itemGov = parseGovernanceJson(b.governance_json)
        const governance = resolveEffectiveGovernance(itemGov, legacy, record, record.relationship_id)
        return { ...b, governance }
      }),
      baseline,
    )
  }

  const counterpartyUserId = record.local_role === 'initiator'
    ? record.acceptor!.wrdesk_user_id
    : record.initiator.wrdesk_user_id
  const counterpartyEmail = record.local_role === 'initiator'
    ? record.acceptor!.email
    : record.initiator.email

  const contextBlocks: ContextBlockForCommitment[] = allowed.map((b) => ({
    block_id: b.block_id,
    block_hash: b.block_hash,
    scope_id: b.scope_id ?? undefined,
    type: b.type,
    content: b.content ?? '',
  }))

  // Persist our sent blocks to context_blocks so the UI can show them when filtering by "Sent"
  if (allowed.length > 0) {
    const toPersist: ContextBlockInput[] = allowed.map((b) => ({
      block_id: b.block_id,
      block_hash: b.block_hash,
      relationship_id: record.relationship_id,
      handshake_id: handshakeId,
      scope_id: b.scope_id ?? undefined,
      type: b.type,
      data_classification: 'public',
      version: 1,
      valid_until: undefined,
      payload: typeof b.content === 'string' ? b.content : JSON.stringify(b.content ?? ''),
      visibility: 'public',
    }))
    try {
      persistContextBlocks(db, handshakeId, toPersist, 'sent', session.wrdesk_user_id)
    } catch (err: any) {
      console.warn('[ContextSync] Failed to persist sent blocks to context_blocks:', err?.message)
    }
  }

  try {
    console.log('[HANDSHAKE-DEBUG] Creating context_sync capsule', handshakeId)
    const lastSeq = opts.lastSeqReceived ?? 0
    const contextSyncCapsule = buildContextSyncCapsuleWithContent(session, {
      handshake_id: handshakeId,
      counterpartyUserId,
      counterpartyEmail,
      last_seq_sent: record.last_seq_sent ?? 0,
      last_seq_received: lastSeq,
      last_capsule_hash_received: opts.lastCapsuleHash,
      context_blocks: contextBlocks,
      local_public_key: localPub,
      local_private_key: localPriv,
      ...(record.local_p2p_auth_token?.trim() ? { p2p_auth_token: record.local_p2p_auth_token.trim() } : {}),
      ...(internalRelayWire ?? {}),
    })
    const cap = contextSyncCapsule as unknown as Record<string, unknown>
    const sentSeq =
      typeof cap.seq === 'number' && Number.isFinite(cap.seq)
        ? cap.seq
        : Math.floor(Number(cap.seq))
    const sentHash =
      typeof cap.capsule_hash === 'string' && cap.capsule_hash.trim().length > 0
        ? cap.capsule_hash.trim()
        : ''
    if (!Number.isFinite(sentSeq) || sentSeq < 1 || !sentHash) {
      console.error('[ContextSync] Built context_sync missing seq (>=1) or capsule_hash — not enqueuing', handshakeId, {
        sentSeq,
        hasHash: Boolean(sentHash),
      })
      return { success: false, reason: 'CONTEXT_SYNC_INVARIANT' }
    }
    console.log('[ContextSync] Building capsule:', {
      handshake_id: handshakeId,
      seq: sentSeq,
      prev_hash: cap?.prev_hash,
      lastCapsuleHash: opts.lastCapsuleHash,
      lastSeqReceived: lastSeq,
      blockCount: contextBlocks.length,
      targetEndpoint,
    })
    const enq = enqueueOutboundCapsule(db, handshakeId, targetEndpoint, contextSyncCapsule)
    if (!enq.enqueued) {
      const reason = formatLocalInternalRelayValidationJson({
        phase: 'enqueue_guard',
        invariant: enq.invariant,
        message: enq.message,
        missing_fields: enq.missing_fields,
      })
      console.warn('[ContextSync] enqueue blocked:', reason)
      return { success: false, reason }
    }
    console.log('[HANDSHAKE-DEBUG] context_sync enqueued', handshakeId)
    // Durable local proof: outbound queue + persisted seq/hash (enforced by buildContextSyncRecord).
    updateHandshakeContextSyncEnqueued(db, handshakeId, sentSeq, sentHash)
    console.log('[ContextSync] Enqueued successfully for handshake:', handshakeId, 'seq=', sentSeq)
    return { success: true }
  } catch (err: any) {
    console.warn('[ContextSync] Enqueue failed:', err?.message)
    return { success: false, reason: err?.message ?? 'ENQUEUE_FAILED' }
  }
}

/**
 * Shared ingest outcome hook: after an inbound `accept` capsule is committed as ACCEPTED on the
 * initiator row, attempt the first `context_sync` enqueue (same as coordination relay / vault /
 * internal deferral rules inside `tryEnqueueContextSync`). Acceptor-side local accept is skipped
 * (`local_role !== 'initiator'`). Call from every transport that runs `processHandshakeCapsule`.
 *
 * Emits exactly one `[POST_ACCEPT_CONTEXT_SYNC]` line per successful inbound `accept` process
 * (see `ingress_path` + `enqueue_attempted` / `reason` in the JSON payload).
 */
export function maybeEnqueueInitialContextSyncAfterInboundAccept(
  db: any,
  session: SSOSession,
  args: {
    handshakeResult: HandshakeProcessResult
    /** Canonical wire `capsule_type` (e.g. `rebuildResult.capsule.capsule_type`) */
    wireCapsuleType: unknown
    acceptCapsuleHash: string
    /** Stable id for the ingest stack (e.g. `coordination_ws`, `ingestion_rpc/email`). */
    ingress_path: string
  },
): void {
  if (!args.handshakeResult.success) return
  const ct = typeof args.wireCapsuleType === 'string' ? args.wireCapsuleType.trim() : ''
  if (ct !== 'accept') return

  const r = args.handshakeResult.handshakeRecord
  const logLine = (payload: Record<string, unknown>): void => {
    console.log('[POST_ACCEPT_CONTEXT_SYNC]', JSON.stringify(payload))
  }

  const base = {
    handshake_id: r.handshake_id,
    local_role: r.local_role,
    ingress_path: args.ingress_path,
    newState: r.state,
  }

  if (r.local_role !== 'initiator') {
    logLine({
      ...base,
      enqueue_attempted: false,
      reason: 'skip_not_initiator',
    })
    return
  }
  if (r.state !== HS.ACCEPTED) {
    logLine({
      ...base,
      enqueue_attempted: false,
      reason: 'skip_not_accepted_state',
    })
    return
  }

  const hash = args.acceptCapsuleHash?.trim() ?? ''
  if (!hash) {
    logLine({
      ...base,
      enqueue_attempted: false,
      reason: 'missing_accept_capsule_hash',
    })
    return
  }

  const contextResult = tryEnqueueContextSync(db, r.handshake_id, session, {
    lastCapsuleHash: hash,
    lastSeqReceived: 0,
  })
  if (contextResult.success) {
    logLine({
      ...base,
      enqueue_attempted: true,
    })
    setImmediate(() => {
      void import('./ipc').then((m) => {
        processOutboundQueue(db, m.getCoordinationOidcToken).catch(() => {})
      })
    })
  } else {
    logLine({
      ...base,
      enqueue_attempted: true,
      reason: contextResult.reason ?? 'unknown',
    })
  }
}

/**
 * Re-try `tryEnqueueContextSync` for a single internal handshake in ACCEPTED state with
 * `context_sync_pending` (e.g. after INTERNAL_RELAY_ENDPOINTS_INCOMPLETE). Scoped to
 * one `handshake_id` — no table scan, no polling. Call on events that may make
 * `internal_coordination_identity_complete` / device ids resolvable, or right after
 * successful relay re-registration.
 */
export function retryDeferredInitialContextSyncForInternalHandshake(
  db: any,
  handshakeId: string,
  session: SSOSession | null | undefined,
  getOidcToken?: () => Promise<string | null>,
): void {
  if (!db || !session) return
  const r0 = getHandshakeRecord(db, handshakeId)
  if (!r0) return
  if (r0.handshake_type !== 'internal' || r0.state !== 'ACCEPTED' || !r0.context_sync_pending) {
    return
  }
  const result = tryEnqueueContextSync(db, handshakeId, session, {
    lastCapsuleHash: r0.last_capsule_hash_received ?? '',
    lastSeqReceived: 0,
  })
  if (result.success && getOidcToken) {
    setImmediate(() => {
      void processOutboundQueue(db, getOidcToken)
    })
  }
}

/**
 * Complete all handshakes with context_sync_pending=1 (e.g. vault was locked, or
 * internal relay device ids were incomplete and tryEnqueue set pending).
 * Called from P2P startup; safe to re-call.
 */
export function completePendingContextSyncs(db: any, session: SSOSession | undefined): void {
  if (!db || !session) return
  try {
    const rows = db.prepare(
      "SELECT handshake_id, last_capsule_hash_received, last_seq_received FROM handshakes WHERE state = 'ACCEPTED' AND context_sync_pending = 1"
    ).all() as Array<{ handshake_id: string; last_capsule_hash_received: string; last_seq_received: number }>
    if (rows.length === 0) return
    console.log(`[Vault] Unlocked — completing ${rows.length} pending context sync(s)`)
    for (const row of rows) {
      const result = tryEnqueueContextSync(db, row.handshake_id, session, {
        lastCapsuleHash: row.last_capsule_hash_received ?? '',
        lastSeqReceived: row.last_seq_received ?? 0,
      })
      if (result.success) {
        console.log(`[Vault] Context sync sent for ${row.handshake_id}`)
        // If we had already received their context_sync (seq>=1), we can now transition to ACTIVE
        const record = getHandshakeRecord(db, row.handshake_id)
        if (record && record.last_seq_received >= 1 && record.last_seq_sent >= 1) {
          db.prepare("UPDATE handshakes SET state = 'ACTIVE' WHERE handshake_id = ?").run(row.handshake_id)
          console.log(`[Vault] Handshake ACTIVE (roundtrip complete):`, row.handshake_id)
        }
      } else {
        console.warn(`[Vault] Context sync failed for ${row.handshake_id}:`, result.reason)
      }
    }
  } catch (err: any) {
    console.error('[Vault] completePendingContextSyncs error:', err?.message)
  }
}
