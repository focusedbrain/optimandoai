/**
 * tryEnqueueContextSync — Build and enqueue context_sync capsule, or defer when vault is locked.
 *
 * When vault is locked, sets context_sync_pending=1 so UI can show "Unlock vault" guidance
 * and onVaultUnlocked can complete the exchange automatically.
 */

import type { SSOSession } from './types'
import type { ContextBlockForCommitment } from './contextCommitment'
import { getHandshakeRecord, updateHandshakeContextSyncPending } from './db'
import { getContextStoreByHandshake } from './db'
import { buildContextSyncCapsuleWithContent } from './capsuleBuilder'
import { enqueueOutboundCapsule } from './outboundQueue'

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
      const { vaultService } = require('../vault/rpc')
      return vaultService.getStatus()
    } catch {
      return { isUnlocked: false }
    }
  })

  const status = getVaultStatus()
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
    return { success: false, reason: 'HANDSHAKE_NOT_FOUND' }
  }
  if (record.state !== 'ACCEPTED') {
    return { success: false, reason: 'INVALID_STATE' }
  }

  const targetEndpoint = record.p2p_endpoint?.trim()
  if (!targetEndpoint) {
    return { success: false, reason: 'NO_P2P_ENDPOINT' }
  }

  const pending = getContextStoreByHandshake(db, handshakeId, 'pending_delivery')
  if (pending.length === 0) {
    return { success: true }
  }

  const localPub = record.local_public_key ?? ''
  const localPriv = record.local_private_key ?? ''
  if (!localPub || !localPriv) {
    console.warn('[ContextSync] Skipping — handshake has no signing keys')
    return { success: false, reason: 'NO_SIGNING_KEYS' }
  }

  const counterpartyUserId = record.local_role === 'initiator'
    ? record.acceptor!.wrdesk_user_id
    : record.initiator.wrdesk_user_id
  const counterpartyEmail = record.local_role === 'initiator'
    ? record.acceptor!.email
    : record.initiator.email

  const contextBlocks: ContextBlockForCommitment[] = pending.map((b) => ({
    block_id: b.block_id,
    block_hash: b.block_hash,
    scope_id: b.scope_id ?? undefined,
    type: b.type,
    content: b.content ?? '',
  }))

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
    enqueueOutboundCapsule(db, handshakeId, targetEndpoint, contextSyncCapsule)
    updateHandshakeContextSyncPending(db, handshakeId, false)
    console.log('[ContextSync] Enqueued for handshake:', handshakeId)
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
