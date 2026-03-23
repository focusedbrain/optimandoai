/**
 * Handshake revocation.
 *
 * 1. Mark REVOKED (historical records intact, tier_snapshot NOT modified).
 * 2. Future activation denied immediately.
 * 3. Crypto-erase or delete per receiver policy.
 * 4. Delete derived data (embeddings cascade via FK).
 * 5. Best-effort peer notification if local-user initiated.
 */

import type { SSOSession } from './types'
import { HandshakeState } from './types'
import {
  getHandshakeRecord,
  updateHandshakeRecord,
  deleteBlocksByHandshake,
  deleteEmbeddingsByHandshake,
  insertAuditLogEntry,
} from './db'
import { buildRevocationAuditEntry } from './auditLog'
import { buildRevokeCapsule } from './capsuleBuilder'
import { enqueueOutboundCapsule, processOutboundQueue } from './outboundQueue'
import { getP2PConfig, getEffectiveRelayEndpoint } from '../p2p/p2pConfig'

export async function revokeHandshake(
  db: any,
  handshakeId: string,
  source: 'remote-capsule' | 'local-user',
  actorUserId?: string,
  session?: SSOSession,
  getOidcToken?: () => Promise<string | null>,
): Promise<void> {
  const record = getHandshakeRecord(db, handshakeId)
  if (!record) return

  // Already revoked — idempotent
  if (record.state === HandshakeState.REVOKED) return

  // Snapshot signing keys before the transaction deletes context blocks.
  // We need them after the transaction to build the outbound revoke capsule.
  const localPub = record.local_public_key ?? ''
  const localPriv = record.local_private_key ?? ''
  const lastSeqReceived = record.last_seq_received ?? 0
  const lastCapsuleHash = record.last_capsule_hash_received ?? ''
  const counterpartyUserId = record.local_role === 'initiator'
    ? record.acceptor?.wrdesk_user_id ?? ''
    : record.initiator?.wrdesk_user_id ?? ''
  const counterpartyEmail = record.local_role === 'initiator'
    ? record.acceptor?.email ?? ''
    : record.initiator?.email ?? ''

  const tx = db.transaction(() => {
    // 1. Mark REVOKED
    const revoked = {
      ...record,
      state: HandshakeState.REVOKED,
      revoked_at: new Date().toISOString(),
      revocation_source: source,
    }
    updateHandshakeRecord(db, revoked)

    // 2. Delete embeddings first (FK cascade would handle it, but explicit is safer)
    deleteEmbeddingsByHandshake(db, handshakeId)

    // 3. Delete context blocks (crypto-erase: deleting is sufficient since DB is encrypted)
    deleteBlocksByHandshake(db, handshakeId)

    // 4. Audit log
    insertAuditLogEntry(db, buildRevocationAuditEntry(handshakeId, source, actorUserId))
  })

  tx()

  // 5. Best-effort peer notification: build and enqueue a signed revoke capsule.
  //    Only for local-user initiated revocations (remote-capsule means we already received theirs).
  //    Requires a session, signing keys, and a known counterparty.
  if (
    source === 'local-user' &&
    session &&
    localPub &&
    localPriv &&
    counterpartyUserId &&
    counterpartyEmail
  ) {
    try {
      const p2pConfig = getP2PConfig(db)
      const targetEndpoint = record.p2p_endpoint?.trim() || getEffectiveRelayEndpoint(p2pConfig, null)
      if (!targetEndpoint) {
        console.warn('[Revoke] No target endpoint for peer notification, handshake:', handshakeId)
        return
      }

      const revokeCapsule = buildRevokeCapsule(session, {
        handshake_id: handshakeId,
        counterpartyUserId,
        counterpartyEmail,
        last_seq_received: lastSeqReceived,
        last_capsule_hash_received: lastCapsuleHash,
        local_public_key: localPub,
        local_private_key: localPriv,
      })

      enqueueOutboundCapsule(db, handshakeId, targetEndpoint, revokeCapsule)
      console.log('[Revoke] Revoke capsule enqueued for peer delivery, handshake:', handshakeId)

      if (getOidcToken) {
        processOutboundQueue(db, getOidcToken).catch((err: any) => {
          console.warn('[Revoke] processOutboundQueue error:', err?.message)
        })
      }
    } catch (err: any) {
      // Best-effort: log but never block the local revoke
      console.warn('[Revoke] Failed to enqueue revoke capsule for peer:', err?.message)
    }
  }
}
