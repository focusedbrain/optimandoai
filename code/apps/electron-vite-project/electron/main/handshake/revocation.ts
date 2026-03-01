/**
 * Handshake revocation.
 *
 * 1. Mark REVOKED (historical records intact, tier_snapshot NOT modified).
 * 2. Future activation denied immediately.
 * 3. Crypto-erase or delete per receiver policy.
 * 4. Delete derived data (embeddings cascade via FK).
 * 5. Best-effort peer notification if local-user initiated.
 */

import { HandshakeState } from './types'
import {
  getHandshakeRecord,
  updateHandshakeRecord,
  deleteBlocksByHandshake,
  deleteEmbeddingsByHandshake,
  insertAuditLogEntry,
} from './db'
import { buildRevocationAuditEntry } from './auditLog'

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
}
