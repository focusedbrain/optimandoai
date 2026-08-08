/**
 * Generic anti-rollback high-water store (Phase 2 — G4) [IX.4.2, X.7.8]
 *
 * One reusable high-water-version store keyed by (object class, object
 * identity). A validly signed object whose version is BELOW the persisted
 * high-water mark is rejected fail-closed as a rollback — signature validity
 * never overrides version regression. Consumers arrive over Phases 3–6
 * (core-record versions, policies, admissions); the store and its semantics
 * land now.
 *
 * ── Backup/restore semantics (decision, risk register) ──────────────────────
 * The `wr_high_water_versions` table lives IN THE SAME DATABASE as the
 * objects it guards (vault DB / ledger DB via the shared migration chain),
 * inside the same WAL boundary. Consequences, by design:
 *
 *  1. Restoring an older DB snapshot restores objects AND their high-water
 *     marks together, coherently. Legitimate objects are therefore never
 *     mass-rejected after a restore (the mark travels with the data), which
 *     is the primary failure mode the risk register names.
 *  2. The trade-off is stated, not hidden: a whole-DB restore IS a rollback
 *     of the guarded object classes, and the store intentionally cannot
 *     detect it from inside the restored file. Cross-restore rollback
 *     visibility requires an anchor OUTSIDE the backup boundary; that anchor
 *     is the hash-chained evidence store of Phase 5 (Tier-L chain, Q10) —
 *     recorded there as an open item, not silently claimed here [X.0.1
 *     claims discipline: we do not claim rollback protection across
 *     operator-initiated whole-DB restores].
 *  3. A restore procedure therefore: (a) restores the DB file as a unit —
 *     never merges a foreign high-water table into a live DB; (b) treats the
 *     restored marks as authoritative from that point on; (c) leaves an
 *     operator audit_log entry (RESTORE_MARKER) so evidence readers can see
 *     the discontinuity. `recordRestoreMarker` implements (c).
 *
 * The restore scenario is exercised in antiRollback.test.ts.
 */

export interface HighWaterAccept {
  ok: true
  /** True when this call raised (or created) the mark. */
  raised: boolean
  highWater: number
}

export interface HighWaterReject {
  ok: false
  reason: 'rollback'
  highWater: number
  presented: number
}

export type HighWaterResult = HighWaterAccept | HighWaterReject

/**
 * Fail-closed high-water check-and-raise. Rejects versions strictly below
 * the persisted mark; accepts equal versions (idempotent redelivery of the
 * same object version is not a rollback) and raises on higher versions.
 * The read+write runs in one transaction — single writer discipline.
 */
export function enforceHighWater(
  db: any,
  objectClass: string,
  objectId: string,
  version: number,
): HighWaterResult {
  if (!Number.isSafeInteger(version) || version < 0) {
    // Malformed version input is treated as a rollback attempt — fail closed.
    return { ok: false, reason: 'rollback', highWater: Number.MAX_SAFE_INTEGER, presented: version }
  }
  const tx = db.transaction((): HighWaterResult => {
    const row = db
      .prepare(
        'SELECT high_water_version FROM wr_high_water_versions WHERE object_class = ? AND object_id = ?',
      )
      .get(objectClass, objectId) as { high_water_version: number } | undefined
    const current = row?.high_water_version
    if (current !== undefined && version < current) {
      return { ok: false, reason: 'rollback', highWater: current, presented: version }
    }
    if (current === undefined || version > current) {
      db.prepare(
        `INSERT INTO wr_high_water_versions (object_class, object_id, high_water_version, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(object_class, object_id) DO UPDATE SET
           high_water_version = excluded.high_water_version,
           updated_at = excluded.updated_at`,
      ).run(objectClass, objectId, version, new Date().toISOString())
      return { ok: true, raised: true, highWater: version }
    }
    return { ok: true, raised: false, highWater: current }
  })
  return tx()
}

/** Read-only peek at the current mark (diagnostics / tests). */
export function getHighWater(db: any, objectClass: string, objectId: string): number | null {
  const row = db
    .prepare(
      'SELECT high_water_version FROM wr_high_water_versions WHERE object_class = ? AND object_id = ?',
    )
    .get(objectClass, objectId) as { high_water_version: number } | undefined
  return row?.high_water_version ?? null
}

/**
 * Restore-procedure step (c): record the discontinuity in the audit log so
 * evidence readers can distinguish an operator restore from silent rollback.
 */
export function recordRestoreMarker(db: any, detail: { restoredFrom: string; operator: string }): void {
  db.prepare(
    `INSERT INTO audit_log (timestamp, action, reason_code, metadata)
     VALUES (?, 'HIGH_WATER_RESTORE_MARKER', 'operator_restore', ?)`,
  ).run(new Date().toISOString(), JSON.stringify(detail))
}
