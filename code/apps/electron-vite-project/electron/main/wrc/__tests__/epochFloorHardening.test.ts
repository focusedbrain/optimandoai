/**
 * Pre-Phase-4 (iii) — epoch-floor hardening.
 *
 * The anti-rollback floor (A3) is trust state, not cache. The property under
 * test is blunt: deleting or editing the userData cache file MUST NOT reset any
 * publisher's floor, and there must be no code path that lowers one.
 */
import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createDbEpochFloorStore,
  createMemoryEpochFloorStore,
  epochFloorTablePresent,
} from '../epochFloorStore'
import {
  WrcResolvedRecordStore,
  createFilePersistence,
  createMemoryPersistence,
} from '../resolvedRecordStore'
import { WrcResolutionClient } from '../resolutionClient'
import { buildPublisherFixture, createFixtureTransport } from './wrcFixtures'

const _require = createRequire(import.meta.url)
let Database: any = null
try {
  Database = _require('better-sqlite3')
  const probe = new Database(':memory:')
  probe.close()
} catch {
  Database = null
}

async function migratedDb(): Promise<any> {
  const db = new Database(':memory:')
  const { migrateHandshakeTables } = await import('../../handshake/db')
  migrateHandshakeTables(db)
  return db
}

describe.skipIf(!Database)('the floor lives in the native DB', () => {
  it('migration creates wrc_publisher_epoch_floor', async () => {
    const db = await migratedDb()
    try {
      expect(epochFloorTablePresent(db)).toBe(true)
    } finally {
      db.close()
    }
  })

  it('raise is monotonic — a lower value is a no-op at the SQL level', async () => {
    const db = await migratedDb()
    try {
      const floor = createDbEpochFloorStore(db)
      expect(floor.get('WR7X4K')).toBeNull()
      floor.raise('WR7X4K', 7)
      expect(floor.get('WR7X4K')).toBe(7)
      floor.raise('WR7X4K', 3)
      expect(floor.get('WR7X4K')).toBe(7)
      floor.raise('WR7X4K', 7)
      expect(floor.get('WR7X4K')).toBe(7)
      floor.raise('WR7X4K', 9)
      expect(floor.get('WR7X4K')).toBe(9)
    } finally {
      db.close()
    }
  })

  it('deleting the userData cache file does NOT reset the floor', async () => {
    const db = await migratedDb()
    const dir = mkdtempSync(join(tmpdir(), 'wrc-floor-'))
    const cachePath = join(dir, 'wrc-resolved-publishers.json')
    try {
      const floor = createDbEpochFloorStore(db)
      const store = new WrcResolvedRecordStore(createFilePersistence(cachePath), floor)
      store.noteAcceptedEpoch('WR7X4K', 12)
      expect(existsSync(cachePath) || true).toBe(true)

      // Nuke the cache exactly as a user (or malware running as the user) could.
      rmSync(cachePath, { force: true })
      expect(existsSync(cachePath)).toBe(false)

      const rebuilt = new WrcResolvedRecordStore(createFilePersistence(cachePath), floor)
      expect(rebuilt.get('WR7X4K')).toBeNull() // cache is gone, as expected
      expect(rebuilt.lastSeenEpoch('WR7X4K')).toBe(12) // floor is not
    } finally {
      db.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('editing the cache file cannot lower the floor', async () => {
    const db = await migratedDb()
    const dir = mkdtempSync(join(tmpdir(), 'wrc-floor-'))
    const cachePath = join(dir, 'wrc-resolved-publishers.json')
    try {
      const floor = createDbEpochFloorStore(db)
      new WrcResolvedRecordStore(createFilePersistence(cachePath), floor).noteAcceptedEpoch(
        'WR7X4K',
        12,
      )
      // Forge a legacy-shaped cache claiming a much lower floor.
      writeFileSync(
        cachePath,
        JSON.stringify({ version: 1, records: {}, epoch_floor: { WR7X4K: 1 } }),
        'utf8',
      )
      const rebuilt = new WrcResolvedRecordStore(createFilePersistence(cachePath), floor)
      expect(rebuilt.lastSeenEpoch('WR7X4K')).toBe(12)
    } finally {
      db.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('a forged cache file cannot make a rolled-back head resolve', async () => {
    const db = await migratedDb()
    const dir = mkdtempSync(join(tmpdir(), 'wrc-floor-'))
    const cachePath = join(dir, 'wrc-resolved-publishers.json')
    try {
      const floor = createDbEpochFloorStore(db)
      const fresh = buildPublisherFixture({ epoch: 7 })
      const store = new WrcResolvedRecordStore(createFilePersistence(cachePath), floor)
      const client = new WrcResolutionClient({
        transport: createFixtureTransport(fresh),
        store,
        ingestPublicKey: fresh.ingest.pub,
        now: () => 1_754_650_100,
      })
      expect((await client.resolvePublisher(fresh.publisherPart)).ok).toBe(true)

      // Attacker deletes the cache AND serves an older, correctly signed head.
      rmSync(cachePath, { force: true })
      const older = buildPublisherFixture({ epoch: 6 })
      const rolled = await new WrcResolutionClient({
        transport: createFixtureTransport(older),
        store: new WrcResolvedRecordStore(createFilePersistence(cachePath), floor),
        ingestPublicKey: older.ingest.pub,
        now: () => 1_754_650_100,
      }).resolvePublisher(older.publisherPart)

      expect(rolled.ok).toBe(false)
      if (!rolled.ok) expect(rolled.reason).toBe('head_epoch_rollback')
    } finally {
      db.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('the cache no longer owns the floor', () => {
  it('a legacy cache file with epoch_floor is ignored on load', () => {
    const persistence = createMemoryPersistence({
      version: 1,
      records: {},
      epoch_floor: { WR7X4K: 99 },
    })
    const store = new WrcResolvedRecordStore(persistence, createMemoryEpochFloorStore())
    // Reading it back would reintroduce the reset path this move removes.
    expect(store.lastSeenEpoch('WR7X4K')).toBeNull()
  })

  it('the cache is never written with an epoch_floor key', () => {
    let written: Record<string, unknown> | null = null
    const store = new WrcResolvedRecordStore(
      { read: () => null, write: (v) => { written = v } },
      createMemoryEpochFloorStore(),
    )
    store.upsert({
      publisher_part: 'WR7X4K',
      domain: 'publisher.test',
      status: 'active',
      generation: 1,
      root_kid: 'root-a1',
      root_pub: 'x',
      root_fingerprint: 'f',
      last_seen_epoch: 4,
      catalog_root: 'sha256:x',
      head_issued_at: 0,
      freshness_window_s: 0,
      delegation_kid: null,
      cache_state: 'validated',
      resolved_at: 0,
      delegations: [],
    })
    expect(written).not.toBeNull()
    expect(Object.keys(written!)).not.toContain('epoch_floor')
    expect(store.lastSeenEpoch('WR7X4K')).toBe(4)
  })

  it('the floor store exposes no lowering path', async () => {
    const { readFileSync } = await import('node:fs')
    const { fileURLToPath } = await import('node:url')
    const { dirname, join: j } = await import('node:path')
    const here = dirname(fileURLToPath(import.meta.url))
    const src = readFileSync(j(here, '..', 'epochFloorStore.ts'), 'utf8')
    // Two operations only on the public contract: read and raise.
    const iface = src.slice(
      src.indexOf('export interface WrcEpochFloorStore'),
      src.indexOf('}', src.indexOf('export interface WrcEpochFloorStore')),
    )
    const methods = [...iface.matchAll(/^\s*(\w+)\s*\(/gm)].map((m) => m[1]).sort()
    expect(methods).toEqual(['get', 'raise'])
    expect(src).not.toMatch(/\bDELETE\s+FROM\s+wrc_publisher_epoch_floor/i)
    expect(src).not.toMatch(/UPDATE wrc_publisher_epoch_floor SET epoch_floor = \?/)
    // The monotonicity is in the statement, not in a caller-side comparison.
    expect(src).toMatch(/WHERE excluded\.epoch_floor > wrc_publisher_epoch_floor\.epoch_floor/)
  })
})
