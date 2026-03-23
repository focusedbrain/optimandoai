/**
 * tryEnqueueContextSync — Build and enqueue context_sync capsule, or defer when vault is locked.
 *
 * When vault is locked, sets context_sync_pending=1 so UI can show "Unlock vault" guidance
 * and onVaultUnlocked can complete the exchange automatically.
 */

import type { SSOSession } from './types'
import type { ContextBlockForCommitment } from './contextCommitment'
import type { ContextBlockInput } from './types'
import { getHandshakeRecord, updateHandshakeContextSyncPending } from './db'
import { getContextStoreByHandshake } from './db'
import { buildContextSyncCapsuleWithContent } from './capsuleBuilder'
import { enqueueOutboundCapsule } from './outboundQueue'
import { persistContextBlocks } from './contextBlocks'
import { getP2PConfig, getEffectiveRelayEndpoint } from '../p2p/p2pConfig'
import { vaultService } from '../vault/rpc'
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
    const lastSeq = opts.lastSeqReceived ?? 0
    const contextSyncCapsule = buildContextSyncCapsuleWithContent(session, {
      handshake_id: handshakeId,
      counterpartyUserId,
      counterpartyEmail,
      last_seq_received: lastSeq,
      last_capsule_hash_received: opts.lastCapsuleHash,
      context_blocks: contextBlocks,
      local_public_key: localPub,
      local_private_key: localPriv,
    })
    const cap = contextSyncCapsule as unknown as Record<string, unknown>
    console.log('[ContextSync] Building capsule:', {
      handshake_id: handshakeId,
      seq: cap?.seq,
      prev_hash: cap?.prev_hash,
      lastCapsuleHash: opts.lastCapsuleHash,
      lastSeqReceived: lastSeq,
      blockCount: contextBlocks.length,
      targetEndpoint,
    })
    enqueueOutboundCapsule(db, handshakeId, targetEndpoint, contextSyncCapsule)
    updateHandshakeContextSyncPending(db, handshakeId, false)
    console.log('[ContextSync] Enqueued successfully for handshake:', handshakeId, 'seq=', cap?.seq)
    return { success: true }
  } catch (err: any) {
    console.warn('[ContextSync] Enqueue failed:', err?.message)
    return { success: false, reason: err?.message ?? 'ENQUEUE_FAILED' }
  }
}

/**
 * Complete all handshakes with context_sync_pending=1 (deferred due to vault lock).
 * Call this when vault is unlocked.
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
        if (record && record.last_seq_received >= 1) {
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
