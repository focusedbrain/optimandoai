/**
 * Run 5 Slice 2 â€” durable Â§XVI.6.4 Directory generation floors.
 *
 * The floor is TRUST state: "every change increments the record generation;
 * a cached record whose generation no longer matches is invalid immediately."
 * A process restart must never lower the effective floor, concurrent
 * resolution must never race it backwards, and a store that cannot answer
 * refuses the lookup â€” fail closed, never "no floor, proceed".
 *
 * These vectors run against the REAL native security DB
 * (`wrcSecurityDb.ts`), with restart modeled as: close the handle, reopen
 * the same file, build a fresh WrcDirectoryClient. Nothing in-process
 * survives between the two halves except the file.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// Native binding probe (same pattern as the Run-2 suites): these vectors are
// PROVEN under the sanctioned native runner (`pnpm test:native-db`, Electron's
// node); under a plain-node vitest run they skip rather than fake the DB.
const _require = createRequire(import.meta.url)
let Database: unknown = null
try {
  const D = _require('better-sqlite3')
  const probe = new D(':memory:')
  probe.close()
  Database = D
} catch {
  Database = null
}
import {
  WrcDirectoryClient,
  type WrcGenerationFloorStore,
} from '../namespaceDirectory'
import {
  WRC_SECURITY_MIGRATIONS,
  createDbDirectoryGenerationFloorStore,
  migrateWrcSecuritySchema,
  openWrcSecurityDb,
  type WrcSecurityDb,
} from '../wrcSecurityDb'
import { runWrCodeGatePipeline } from '../gatePipeline'
import { createWrcGateDeps } from '../gatePipelineAdapter'
import { WrcResolutionClient } from '../resolutionClient'
import { WrcResolvedRecordStore, createMemoryPersistence } from '../resolvedRecordStore'
import {
  buildOperatorRollover,
  buildPublisherFixture,
  createFixtureTransport,
  makeKeyPair,
  signDirectoryRecord,
  type FixtureTransportOverrides,
  type WrcPublisherFixture,
} from './wrcFixtures'

const NOW = 1_754_650_100
const PART = 'WR7X4K'

/** Unsigned base of a fixture's directory record, for crafting variants. */
function unsignedOf(fx: WrcPublisherFixture): Record<string, unknown> {
  const {
    operator_sig: _o,
    publisher_countersig: _p,
    ...base
  } = fx.directoryRecord as unknown as Record<string, unknown>
  return base
}

let dir: string
let dbPath: string
let db: WrcSecurityDb

beforeEach(() => {
  if (!Database) return
  dir = mkdtempSync(join(tmpdir(), 'wrc-sec-'))
  dbPath = join(dir, 'wrc-security.db')
  db = openWrcSecurityDb(dbPath)
})

afterEach(() => {
  if (!Database) return
  try {
    db.close()
  } catch {
    /* already closed by the restart step */
  }
  rmSync(dir, { recursive: true, force: true })
})

/** "Restart": close the handle, reopen the same file. */
function restart(): WrcSecurityDb {
  db.close()
  db = openWrcSecurityDb(dbPath)
  return db
}

function clientOver(
  fx: WrcPublisherFixture,
  handle: WrcSecurityDb,
  overrides: FixtureTransportOverrides = {},
  extra?: { rollovers?: Parameters<typeof buildOperatorRollover>[]; floors?: WrcGenerationFloorStore },
): { client: WrcDirectoryClient; overrides: FixtureTransportOverrides } {
  const client = new WrcDirectoryClient({
    transport: createFixtureTransport(fx, overrides),
    operator: { kid: fx.operator.kid, pub: fx.operator.pub },
    now: () => NOW,
    generationFloors: extra?.floors ?? createDbDirectoryGenerationFloorStore(handle),
  })
  return { client, overrides }
}

// â”€â”€ Schema â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe.skipIf(!Database)('security DB schema chain', () => {
  it('applies the versioned additive chain exactly once and is idempotent', () => {
    const rows = db.prepare('SELECT version FROM wrc_schema_migrations ORDER BY version').all() as Array<{
      version: number
    }>
    expect(rows.map((r) => r.version)).toEqual(WRC_SECURITY_MIGRATIONS.map((m) => m.version))
    migrateWrcSecuritySchema(db) // second run: no throw, no duplicate
    const again = db.prepare('SELECT COUNT(*) AS n FROM wrc_schema_migrations').get() as { n: number }
    expect(again.n).toBe(WRC_SECURITY_MIGRATIONS.length)
  })

  it('an existing DB with no Run-5 rows serves the empty state safely', () => {
    const floors = createDbDirectoryGenerationFloorStore(db)
    expect(floors.get('NEVER1')).toBeNull()
  })
})

// â”€â”€ Floor lifecycle â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe.skipIf(!Database)('generation floor: accept, hold, refuse rollback [XVI.6.4]', () => {
  it('first acceptance sets the floor; same generation re-verifies; higher raises', async () => {
    const fx = buildPublisherFixture() // generation 3
    const { client } = clientOver(fx, db)

    const first = await client.getVerifiedRecord(PART)
    expect(first.ok).toBe(true)
    expect(createDbDirectoryGenerationFloorStore(db).get(PART)).toBe(3)

    const same = await client.getVerifiedRecord(PART)
    expect(same.ok).toBe(true)

    const overrides: FixtureTransportOverrides = {
      directoryRecord: {
        ok: true,
        value: signDirectoryRecord({ ...unsignedOf(fx), generation: 5 }, fx.operator, fx.root),
      },
    }
    const { client: higher } = clientOver(fx, db, overrides)
    const up = await higher.getVerifiedRecord(PART)
    expect(up.ok).toBe(true)
    expect(createDbDirectoryGenerationFloorStore(db).get(PART)).toBe(5)
  })

  it('a lower generation refuses as stale, and STILL refuses after restart', async () => {
    const fx = buildPublisherFixture()
    const { client } = clientOver(fx, db)
    expect((await client.getVerifiedRecord(PART)).ok).toBe(true) // floor = 3

    const stale = signDirectoryRecord({ ...unsignedOf(fx), generation: 2 }, fx.operator, fx.root)
    const { client: staleClient } = clientOver(fx, db, {
      directoryRecord: { ok: true, value: stale },
    })
    const refused = await staleClient.getVerifiedRecord(PART)
    expect(refused.ok).toBe(false)
    if (refused.ok) return
    expect(refused.leg).toBe('generation_stale')

    // Restart: fresh handle over the same file, fresh client â€” the floor
    // came back from the DB, not from any in-process state.
    const reopened = restart()
    const { client: afterRestart } = clientOver(fx, reopened, {
      directoryRecord: { ok: true, value: stale },
    })
    const stillRefused = await afterRestart.getVerifiedRecord(PART)
    expect(stillRefused.ok).toBe(false)
    if (stillRefused.ok) return
    expect(stillRefused.leg).toBe('generation_stale')

    // The current generation still verifies after restart.
    const { client: current } = clientOver(fx, reopened)
    expect((await current.getVerifiedRecord(PART)).ok).toBe(true)
  })

  it('concurrent higher/lower updates cannot race the floor backwards', async () => {
    const floors = createDbDirectoryGenerationFloorStore(db)
    // Interleaved raises in adversarial order â€” the conditional upsert keeps
    // the maximum regardless of arrival order.
    floors.raise(PART, 7)
    floors.raise(PART, 3)
    floors.raise(PART, 10)
    floors.raise(PART, 4)
    expect(floors.get(PART)).toBe(10)

    // A resolution that verified against a stale read is refused at the
    // post-raise re-check: the record's generation is below the settled floor.
    const fx = buildPublisherFixture() // generation 3 < 10
    const { client } = clientOver(fx, db)
    const r = await client.getVerifiedRecord(PART)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.leg).toBe('generation_stale')
  })
})

// â”€â”€ Operator rollover across restart â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe.skipIf(!Database)('operator-key rollover, then restart [XVI.6.4]', () => {
  it('post-rollover records verify; pre-rollover stale generations stay refused after restart', async () => {
    const fx = buildPublisherFixture()
    const newOperator = makeKeyPair('dir-op-next')
    const rollover = buildOperatorRollover(fx.operator, newOperator)

    // Accept a generation-4 record signed by the ROLLED-OVER operator key.
    const g4 = signDirectoryRecord(
      { ...unsignedOf(fx), generation: 4, operator_kid: newOperator.kid },
      newOperator,
      fx.root,
    )
    const clientA = new WrcDirectoryClient({
      transport: createFixtureTransport(fx, { directoryRecord: { ok: true, value: g4 } }),
      operator: { kid: fx.operator.kid, pub: fx.operator.pub },
      rollovers: [rollover],
      now: () => NOW,
      generationFloors: createDbDirectoryGenerationFloorStore(db),
    })
    expect((await clientA.getVerifiedRecord(PART)).ok).toBe(true)

    // Restart. The pre-rollover generation-3 record is validly signed by the
    // still-trusted outgoing key â€” but its generation is below the durable
    // floor, so the stale pre-rollover trust material stays refused.
    const reopened = restart()
    const clientB = new WrcDirectoryClient({
      transport: createFixtureTransport(fx), // serves the original generation-3 record
      operator: { kid: fx.operator.kid, pub: fx.operator.pub },
      rollovers: [rollover],
      now: () => NOW,
      generationFloors: createDbDirectoryGenerationFloorStore(reopened),
    })
    const r = await clientB.getVerifiedRecord(PART)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.leg).toBe('generation_stale')
  })
})

// â”€â”€ Failure behavior: fail closed â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe.skipIf(!Database)('floor store failure refuses the lookup (fail closed)', () => {
  it('a store whose read throws (transaction failure) refuses, never proceeds floorless', async () => {
    const fx = buildPublisherFixture()
    const broken: WrcGenerationFloorStore = {
      get() {
        throw new Error('SQLITE_IOERR: disk I/O error')
      },
      raise() {
        throw new Error('SQLITE_IOERR: disk I/O error')
      },
    }
    const { client } = clientOver(fx, db, {}, { floors: broken })
    const r = await client.getVerifiedRecord(PART)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.leg).toBe('directory_unavailable')
    expect(r.detail).toContain('generation floor unavailable')
  })

  it('a store whose RAISE throws after verification also refuses', async () => {
    const fx = buildPublisherFixture()
    const halfBroken: WrcGenerationFloorStore = {
      get: () => null,
      raise() {
        throw new Error('SQLITE_FULL: database or disk is full')
      },
    }
    const { client } = clientOver(fx, db, {}, { floors: halfBroken })
    const r = await client.getVerifiedRecord(PART)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.leg).toBe('directory_unavailable')
  })

  it('a malformed persisted floor row refuses â€” unknown history is not "never seen"', async () => {
    const fx = buildPublisherFixture()
    db.prepare(
      `INSERT INTO wrc_directory_generation_floor (publisher_part, generation_floor, updated_at)
       VALUES (?, ?, ?)`,
    ).run(PART, 'garbage-not-a-number', new Date().toISOString())
    const { client } = clientOver(fx, db)
    const r = await client.getVerifiedRecord(PART)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.leg).toBe('directory_unavailable')
    expect(r.detail).toContain('malformed generation floor')
  })
})

// â”€â”€ No directory configured: unchanged Run-4 refusal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe.skipIf(!Database)('no configured directory fails exactly as Run 4 specifies', () => {
  it('Gate 2 refuses with directory_not_configured; no floor state is created', async () => {
    const fx = buildPublisherFixture()
    const client = new WrcResolutionClient({
      transport: createFixtureTransport(fx),
      store: new WrcResolvedRecordStore(createMemoryPersistence()),
      ingestPublicKey: fx.ingest.pub,
      now: () => NOW,
    })
    const deps = createWrcGateDeps(client, { now: () => NOW })
    const r = await runWrCodeGatePipeline(
      { raw: 'P-WR7X4K-9B2M3C', receiver: {} },
      deps,
    )
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.gate).toBe(2)
    expect(r.detail).toContain('directory_not_configured')
    const rows = db.prepare('SELECT COUNT(*) AS n FROM wrc_directory_generation_floor').get() as {
      n: number
    }
    expect(rows.n).toBe(0)
  })
})
