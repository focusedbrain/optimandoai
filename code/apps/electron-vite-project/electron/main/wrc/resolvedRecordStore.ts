/**
 * D6 — per-publisher resolved record, plus the persisted epoch floor (A3).
 *
 * This store is a CACHE of registry state. It may be demoted, refreshed, or
 * discarded at any time (§XVI.15.3); the authoritative append-only assignment
 * ledger lives in the registry service.
 *
 * The anti-rollback epoch floor (A3) USED to live here too, in the same plain
 * JSON file. It no longer does. A floor that a deletable userData file can
 * reset is decorative: anyone able to remove the file could let a publisher
 * replay an older, correctly signed CatalogHead. The floor now lives in the
 * native DB protection class — see `epochFloorStore.ts` — and this module holds
 * only a snapshot of it for display, never as the source of truth.
 *
 * `TierSignals` / `tierSteps` are untouched by this module, per 3B.5 — a
 * resolved publisher is not a trust tier and must not feed one.
 *
 * Persistence is injectable so tests are in-memory and deterministic.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createMemoryEpochFloorStore, type WrcEpochFloorStore } from './epochFloorStore'
import type { WrcDelegationRecord, WrcPublisherStatus } from './wrcContract'

/** Cache demotion states per §XVI.15.3 / A3. */
export type WrcCacheState =
  /** Verified against a fresh head. Usable for new admissions. */
  | 'validated'
  /** Authentic but past its freshness window: displayable, no NEW admissions. */
  | 'stale'
  /** Registry says the publisher is no longer active; retained for display. */
  | 'demoted'

export interface WrcResolvedRecord {
  publisher_part: string
  /** Established by the dual channel, not copied from the registry answer. */
  domain: string
  status: WrcPublisherStatus
  generation: number
  root_kid: string
  root_pub: string
  root_fingerprint: string
  /** Delta 3D additions. */
  last_seen_epoch: number
  catalog_root: string
  head_issued_at: number
  freshness_window_s: number
  delegation_kid: string | null
  /** Bookkeeping. */
  cache_state: WrcCacheState
  resolved_at: number
  delegations: WrcDelegationRecord[]
}

/**
 * §XVI.15.1 — a code that captured and passed its local check but has not
 * completed resolution is NEVER presented as validated. This is the state such
 * a capture sits in, and it is a first-class value rather than the absence of
 * a record, so a caller cannot mistake "not yet resolved" for "no such thing".
 */
export type WrcUnresolvedCaptureState =
  | 'awaiting_resolution'
  | 'resolution_failed'
  | 'unknown_identifier'

export interface WrcStorePersistence {
  read(): Record<string, unknown> | null
  write(value: Record<string, unknown>): void
}

/** In-memory persistence — the default for tests. */
export function createMemoryPersistence(seed?: Record<string, unknown>): WrcStorePersistence {
  let state: Record<string, unknown> = seed ? { ...seed } : {}
  return {
    read: () => state,
    write: (v) => {
      state = v
    },
  }
}

/** JSON file persistence with atomic replace. */
export function createFilePersistence(filePath: string): WrcStorePersistence {
  return {
    read() {
      try {
        if (!existsSync(filePath)) return null
        return JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>
      } catch {
        return null
      }
    },
    write(value) {
      try {
        mkdirSync(dirname(filePath), { recursive: true })
        const tmp = `${filePath}.tmp`
        writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8')
        renameSync(tmp, filePath)
      } catch {
        /* cache write failure must never break resolution */
      }
    },
  }
}

export function defaultResolvedRecordPath(userDataDir: string): string {
  return join(userDataDir, 'wrc-resolved-publishers.json')
}

export class WrcResolvedRecordStore {
  private records = new Map<string, WrcResolvedRecord>()

  /**
   * @param persistence cache persistence (plain JSON is fine — it is cache)
   * @param epochFloor  the authoritative anti-rollback floor. Native-DB backed
   *   in production; in-memory only in tests. Never read from `persistence`.
   */
  constructor(
    private readonly persistence: WrcStorePersistence,
    private readonly epochFloor: WrcEpochFloorStore = createMemoryEpochFloorStore(),
  ) {
    const raw = persistence.read()
    if (!raw) return
    const recs = raw.records
    if (recs && typeof recs === 'object') {
      for (const [k, v] of Object.entries(recs as Record<string, unknown>)) {
        this.records.set(k, v as WrcResolvedRecord)
      }
    }
    // `epoch_floor` in a legacy cache file is deliberately ignored. Reading it
    // back would reintroduce exactly the reset path this move removes.
  }

  private flush(): void {
    this.persistence.write({
      version: 2,
      records: Object.fromEntries(this.records),
    })
  }

  get(publisherPart: string): WrcResolvedRecord | null {
    return this.records.get(publisherPart) ?? null
  }

  /**
   * The anti-rollback floor, read from the protected store. Survives eviction
   * of the cached record on purpose: forgetting a publisher must not reopen a
   * rollback window.
   */
  lastSeenEpoch(publisherPart: string): number | null {
    return this.epochFloor.get(publisherPart)
  }

  /** Raise the floor. There is no lowering path here or in the floor store. */
  noteAcceptedEpoch(publisherPart: string, epoch: number): void {
    this.epochFloor.raise(publisherPart, epoch)
  }

  upsert(record: WrcResolvedRecord): void {
    this.records.set(record.publisher_part, record)
    this.epochFloor.raise(record.publisher_part, record.last_seen_epoch)
    this.flush()
  }

  /** §XVI.15.3 cache demotion — visible state change, never a silent delete. */
  demote(publisherPart: string, to: WrcCacheState): void {
    const rec = this.records.get(publisherPart)
    if (!rec) return
    rec.cache_state = to
    this.records.set(publisherPart, rec)
    this.flush()
  }
}
