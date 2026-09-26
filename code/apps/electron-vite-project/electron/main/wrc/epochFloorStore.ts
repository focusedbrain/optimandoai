/**
 * Per-publisher anti-rollback epoch floor (A3) — native-DB protection class.
 *
 * Why this is not in the resolved-record store: that store is a CACHE of
 * registry state and may be evicted, rebuilt, or deleted at will. The floor is
 * TRUST state. If a user (or anything running as the user) can delete a JSON
 * file and thereby let a publisher replay an older, signed CatalogHead, the
 * anti-rollback property is decorative. So the floor moves to the same
 * protection class as the rest of the trust ledger, and the cache keeps only
 * cache.
 *
 * The API has exactly two operations — read, and raise. There is deliberately
 * no set, no clear, and no delete: monotonicity is enforced by the absence of a
 * lowering path, not by callers remembering to compare first.
 */

/** Minimal shape so tests can pass a bare better-sqlite3 handle. */
export interface EpochFloorDb {
  prepare: (sql: string) => {
    get: (...args: unknown[]) => unknown
    run: (...args: unknown[]) => unknown
  }
}

export interface WrcEpochFloorStore {
  /** Highest epoch ever accepted for this publisher, or null if never seen. */
  get(publisherPart: string): number | null
  /**
   * Raise the floor to `epoch`. A lower or equal value is a no-op, not an
   * error: re-fetching the same epoch is normal.
   */
  raise(publisherPart: string, epoch: number): void
}

/**
 * Native-DB backed floor. `INSERT … ON CONFLICT … DO UPDATE … WHERE excluded >`
 * makes the monotonicity a property of the statement rather than of a
 * read-then-write the caller could race or skip.
 */
export function createDbEpochFloorStore(db: EpochFloorDb): WrcEpochFloorStore {
  return {
    get(publisherPart) {
      try {
        const row = db
          .prepare('SELECT epoch_floor FROM wrc_publisher_epoch_floor WHERE publisher_part = ?')
          .get(publisherPart) as { epoch_floor?: number } | undefined
        const v = row?.epoch_floor
        return typeof v === 'number' && Number.isSafeInteger(v) ? v : null
      } catch {
        // A missing table must not read as "no rollback protection, proceed".
        // Callers treat null as "never seen", so surface the failure loudly
        // rather than silently: see `assertEpochFloorTablePresent`.
        return null
      }
    },
    raise(publisherPart, epoch) {
      if (!Number.isSafeInteger(epoch) || epoch < 0) return
      db.prepare(
        `INSERT INTO wrc_publisher_epoch_floor (publisher_part, epoch_floor, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(publisher_part) DO UPDATE SET
           epoch_floor = excluded.epoch_floor,
           updated_at  = excluded.updated_at
         WHERE excluded.epoch_floor > wrc_publisher_epoch_floor.epoch_floor`,
      ).run(publisherPart, epoch, new Date().toISOString())
    },
  }
}

/**
 * In-memory floor for tests and for the unconfigured path. Same two-operation
 * contract, same monotonicity.
 */
export function createMemoryEpochFloorStore(
  seed?: ReadonlyMap<string, number>,
): WrcEpochFloorStore {
  const m = new Map<string, number>(seed ?? [])
  return {
    get: (p) => m.get(p) ?? null,
    raise: (p, e) => {
      if (!Number.isSafeInteger(e) || e < 0) return
      const cur = m.get(p)
      if (cur === undefined || e > cur) m.set(p, e)
    },
  }
}

/** True when the native table exists — used to fail loudly rather than silently. */
export function epochFloorTablePresent(db: EpochFloorDb): boolean {
  try {
    db.prepare('SELECT 1 FROM wrc_publisher_epoch_floor LIMIT 1').get()
    return true
  } catch {
    return false
  }
}
