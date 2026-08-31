/**
 * Run 5 Slice 10 — no silent in-memory production fallbacks.
 *
 * The rule: where security depends on durable state,
 * `persistence unavailable → fail closed`, never
 * `persistence unavailable → start with an empty memory store`.
 *
 * The Slice-0 inventory found exactly that silent degradation in production
 * (the frozen ledger handle never carried the v77/v78 tables, so epoch-floor
 * and use-limit state fell back to memory with only a console warning).
 * These vectors prove the replacement posture:
 *
 *  - a security DB that cannot open THROWS at open time;
 *  - a security DB that dies underneath a running composition makes
 *    submission REFUSE or ERROR — a valid reference is never admitted on
 *    the strength of an empty volatile store;
 *  - the durable stores never mask malformed persisted rows as fresh state.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { buildWrCodeReference } from '@repo/ingestion-core'
import { WrcDirectoryClient } from '../namespaceDirectory'
import { createDbAdmissionReplayStore } from '../capsuleAdmission'
import { WrcResolutionClient } from '../resolutionClient'
import { WrcResolvedRecordStore, createMemoryPersistence } from '../resolvedRecordStore'
import { createDbUseLimitStore } from '../useLimitStore'
import { openWrcSecurityDb, type WrcSecurityDb } from '../wrcSecurityDb'
import {
  handleWrcSubmitReference,
  setWrcAdmissionReplayForTests,
  setWrcClientForTests,
  setWrcDirectoryForTests,
  setWrcIdentityForTests,
  setWrcUseLimitStoreForTests,
} from '../wrcRuntime'
import { buildPublisherFixture, createMultiFixtureTransport, makeKeyPair } from './wrcFixtures'

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

const TENANT = 'WR7X4K'
const I_COMB = 'CTXA01'

const INGEST = makeKeyPair('wrc-ingest-shared')
const OPERATOR = makeKeyPair('dir-op-shared')

const tenantFx = buildPublisherFixture({
  publisherPart: TENANT,
  domain: 'publisher.test',
  ingestKey: INGEST,
  operatorKey: OPERATOR,
  extraEntries: [
    {
      lookupKey: I_COMB,
      entryId: 'CTX001',
      designation: {
        cls: 'I',
        combination: I_COMB,
        receiving_party: { kind: 'principal', id: 'party-1' },
      },
    },
  ],
})

const I_REF = (() => {
  const r = buildWrCodeReference('I', [TENANT, I_COMB])
  if (!r.ok) throw new Error(r.reason)
  return r.canonical
})()

let dir: string

beforeEach(() => {
  if (!Database) return
  dir = mkdtempSync(join(tmpdir(), 'wrc-fc-'))
})

afterEach(() => {
  if (!Database) return
  setWrcClientForTests(null)
  setWrcDirectoryForTests(null)
  setWrcUseLimitStoreForTests(null)
  setWrcAdmissionReplayForTests(null)
  setWrcIdentityForTests(null)
  rmSync(dir, { recursive: true, force: true })
})

describe.skipIf(!Database)('fail-closed persistence [Run 5 Slice 10]', () => {
  it('a security DB path that cannot be opened THROWS — no silent empty store', () => {
    expect(() => openWrcSecurityDb(join(dir, 'no-such-dir', 'deeper', 'wrc-security.db'))).toThrow()
  })

  it('a corrupted security DB file THROWS at open/migrate time', () => {
    const path = join(dir, 'wrc-security.db')
    writeFileSync(path, 'this is not a sqlite database, and never will be')
    expect(() => openWrcSecurityDb(path)).toThrow()
  })

  it('a security DB that dies under a running composition refuses submissions — never admits from empty volatile state', async () => {
    const path = join(dir, 'wrc-security.db')
    const db: WrcSecurityDb = openWrcSecurityDb(path)

    const transport = createMultiFixtureTransport([tenantFx])
    setWrcClientForTests(
      new WrcResolutionClient({
        transport,
        store: new WrcResolvedRecordStore(createMemoryPersistence()),
        ingestPublicKey: INGEST.pub,
      }),
    )
    setWrcDirectoryForTests(
      new WrcDirectoryClient({ transport, operator: { kid: OPERATOR.kid, pub: OPERATOR.pub } }),
    )
    setWrcUseLimitStoreForTests(createDbUseLimitStore(db))
    setWrcAdmissionReplayForTests(createDbAdmissionReplayStore(db))
    setWrcIdentityForTests({
      receiver: { party_id: 'party-1' },
      claimIdentity: null,
      decryptKey: null,
    })

    // Healthy composition admits.
    const before = await handleWrcSubmitReference({ raw: I_REF, requestInstanceId: 'req-a' })
    expect(before.success && before.result.ok).toBe(true)

    // The persistence dies underneath the running process.
    db.close()

    // The SAME submission now refuses or errors — the composition must not
    // conjure an empty in-memory ledger and admit as if history were clean.
    const after = await handleWrcSubmitReference({ raw: I_REF, requestInstanceId: 'req-b' })
    if (after.success) {
      expect(after.result.ok).toBe(false)
    } else {
      expect(after.error.length).toBeGreaterThan(0)
    }
  })
})
