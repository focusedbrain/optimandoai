/**
 * Core nonce store — freshness/replay check for signed core records
 * (Phase 2 — A1) [VII.3.1].
 *
 * A nonce may be observed once per scope. Idempotent redelivery of the SAME
 * object (same bound hash) is not a replay — transports retry; the
 * duplicate-capsule dedup owns that path. A seen nonce arriving with a
 * DIFFERENT bound hash is a replay: a fresh object reusing spent freshness.
 */

export const WR_CORE_NONCE_SCOPE = 'wr.handshake.core'

export type NonceCheckResult =
  | { ok: true; firstSeen: boolean }
  | { ok: false; reason: 'replay'; boundHash: string | null }

/**
 * Check-and-record in one transaction. `boundHash` binds the nonce to the
 * object it arrived with (the capsule_hash for v3 capsules).
 */
export function checkAndRecordNonce(
  db: any,
  scope: string,
  nonce: string,
  boundHash: string,
): NonceCheckResult {
  const tx = db.transaction((): NonceCheckResult => {
    const row = db
      .prepare('SELECT bound_hash FROM wr_core_nonces WHERE scope = ? AND nonce = ?')
      .get(scope, nonce) as { bound_hash: string | null } | undefined
    if (row) {
      if (row.bound_hash === boundHash) return { ok: true, firstSeen: false }
      return { ok: false, reason: 'replay', boundHash: row.bound_hash }
    }
    db.prepare(
      'INSERT INTO wr_core_nonces (scope, nonce, bound_hash, seen_at) VALUES (?, ?, ?, ?)',
    ).run(scope, nonce, boundHash, new Date().toISOString())
    return { ok: true, firstSeen: true }
  })
  return tx()
}
