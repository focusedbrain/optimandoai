/**
 * Handshake revocation — SILENT [VII.10.7.2–7.4] (Phase 4, V5).
 *
 * 1. Mark REVOKED (historical records intact, tier_snapshot NOT modified).
 * 2. Future activation denied immediately.
 * 3. NO peer notification of any kind: no capsule, no bounce, no state change
 *    visible to the counterparty. Enforcement is exclusively the receiver-side
 *    ingress admission filter (ingressAdmission.ts): transmissions from a
 *    revoked counterparty die pre-visibility with a logged record. Old-build
 *    peers keep a zombie ACTIVE record and keep transmitting — acceptable
 *    BECAUSE the filter kills those transmissions pre-visibility.
 * 4. Q8: revocation does NOT delete context blocks, embeddings, or audit
 *    rows — evidence and digests persist. Content deletion is the separate
 *    explicit operator action `deleteRevokedRelationshipContent`.
 * 5. Re-handshake reanimates nothing.
 */

// ── UX-3 D1: revoke notification callback ────────────────────────────────────
// Called once after removeTopologyForHandshake succeeds (local-user path).
// Registered by main.ts so it can push topology:handshakeRevoked to the renderer.
// NOTE: remote-capsule revoke path (enforcement.ts) does NOT fire this — see DEFERRED.md.
type RevokeNotifyCallback = (handshakeId: string) => void
let _revokeNotifyCallback: RevokeNotifyCallback | null = null

export function setRevokeNotifyCallback(cb: RevokeNotifyCallback | null): void {
  _revokeNotifyCallback = cb
}
// ─────────────────────────────────────────────────────────────────────────────

import { HandshakeState } from './types'
import {
  getHandshakeRecord,
  updateHandshakeRecord,
  deleteBlocksByHandshake,
  deleteEmbeddingsByHandshake,
  insertAuditLogEntry,
} from './db'
import { buildRevocationAuditEntry } from './auditLog'
import { revokeGrantsForHandshake } from './grants'
import { appendEvidenceBestEffort, poacContentDeletionPayload } from './evidenceChain'
import { P2pSessionLogReason, closeSession } from '../internalInference/p2pSession/p2pInferenceSessionManager'

export async function revokeHandshake(
  db: any,
  handshakeId: string,
  source: 'remote-capsule' | 'local-user',
  actorUserId?: string,
): Promise<void> {
  const record = getHandshakeRecord(db, handshakeId)
  if (!record) return

  // Already revoked — idempotent
  if (record.state === HandshakeState.REVOKED) return

  const tx = db.transaction(() => {
    // 1. Mark REVOKED — content, evidence, and digests persist (Q8).
    const revoked = {
      ...record,
      state: HandshakeState.REVOKED,
      revoked_at: new Date().toISOString(),
      revocation_source: source,
    }
    updateHandshakeRecord(db, revoked)

    // 2. Kill ALL grant objects of the counterparty [VII.10.8] (Phase 5, E4).
    //    Enforcement stays the receiver-side ingress filter; each revoked
    //    grant produces its own PoAC record.
    revokeGrantsForHandshake(db, handshakeId, `handshake_revoked:${source}`, actorUserId)

    // 3. Audit log
    insertAuditLogEntry(db, buildRevocationAuditEntry(handshakeId, source, actorUserId))
  })

  tx()

  try {
    closeSession(handshakeId, P2pSessionLogReason.handshake_revoked)
  } catch {
    /* no-op: internal inference P2P session cleanup must not break revocation */
  }

  // Prompt 4: remove the topology auto-wire entry so resolveIngestionOwnership()
  // reverts to host-owned immediately. Best-effort — a wiring error must never
  // block or revert the revocation itself.
  try {
    const { removeTopologyForHandshake } = await import('./topologyAutoWire')
    removeTopologyForHandshake(handshakeId)
    // UX-3 D1: notify main.ts so it can push topology:handshakeRevoked to the renderer.
    try { _revokeNotifyCallback?.(handshakeId) } catch { /* never block revocation */ }
  } catch (err: any) {
    console.warn('[TOPOLOGY_AUTO_WIRE] removeTopologyForHandshake on revoke failed:', err?.message)
  }
}

/**
 * Q8: separate EXPLICIT operator action — delete the shared-content payload
 * (context blocks + embeddings) of an already-revoked relationship. Never
 * called from `revokeHandshake`; a UI/IPC surface must invoke it as its own
 * deliberate step. Audit rows are never deleted here — evidence persists.
 */
export function deleteRevokedRelationshipContent(
  db: any,
  handshakeId: string,
  actorUserId?: string,
): { ok: true; blocks_deleted: number; embeddings_deleted: number } | { ok: false; reason: 'not_found' | 'not_revoked' } {
  const record = getHandshakeRecord(db, handshakeId)
  if (!record) return { ok: false, reason: 'not_found' }
  if (record.state !== HandshakeState.REVOKED) return { ok: false, reason: 'not_revoked' }

  let blocksDeleted = 0
  let embeddingsDeleted = 0
  const tx = db.transaction(() => {
    // Embeddings first (FK cascade would handle it, but explicit is safer),
    // then blocks (crypto-erase: deleting suffices — the DB is encrypted).
    embeddingsDeleted = deleteEmbeddingsByHandshake(db, handshakeId)
    blocksDeleted = deleteBlocksByHandshake(db, handshakeId)
    insertAuditLogEntry(db, {
      timestamp: new Date().toISOString(),
      action: 'revoked_content_deleted',
      handshake_id: handshakeId,
      reason_code: 'OK',
      actor_wrdesk_user_id: actorUserId,
      metadata: { blocks_deleted: blocksDeleted, embeddings_deleted: embeddingsDeleted },
    })
  })
  tx()

  // Content deletion is an authorized change — PoAC-recorded (Q8, Phase 5).
  appendEvidenceBestEffort({
    chainId: handshakeId,
    recordType: 'poac',
    payload: poacContentDeletionPayload({
      handshake_id: handshakeId,
      blocks_deleted: blocksDeleted,
      embeddings_deleted: embeddingsDeleted,
      actor_wrdesk_user_id: actorUserId ?? null,
    }),
  })

  return { ok: true, blocks_deleted: blocksDeleted, embeddings_deleted: embeddingsDeleted }
}
