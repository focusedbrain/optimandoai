/**
 * Run 5 Slice 9 — explicit acceptance and atomic consumption.
 *
 * Run 4 established the distinction; this suite pins its RUNTIME boundary:
 *
 *  - `wrc.submitReference` (admission) does NOT consume — it mints an opaque
 *    acceptance token bound to what the admission established;
 *  - `wrc.acceptReference` is the only consumption surface, single-shot per
 *    token; a caller can never name an arbitrary entry and consume it;
 *  - consumption is the Run-2 durable CAS, conditional on the claimant still
 *    holding the §XVI.8.4 claim — failed acceptance never consumes, racing
 *    acceptance has one winner, restart never restores a taken use, and a
 *    crash before committed acceptance never falsely records consumption.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { buildWrCodeReference, captureWrCodeReference } from '@repo/ingestion-core'
import { WrcDirectoryClient } from '../namespaceDirectory'
import { deriveEntryDesignator, useLimitEntryKey } from '../entryDesignator'
import { createDbAdmissionReplayStore } from '../capsuleAdmission'
import { WrcResolutionClient } from '../resolutionClient'
import { WrcResolvedRecordStore, createMemoryPersistence } from '../resolvedRecordStore'
import { createDbUseLimitStore, defaultUseLimitProfile, type WrcUseLimitStore } from '../useLimitStore'
import { openWrcSecurityDb, type WrcSecurityDb } from '../wrcSecurityDb'
import {
  clearWrcPendingAcceptancesForTests,
  handleWrcAcceptReference,
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
const FREE_COMB = 'FREEB2'

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
    {
      lookupKey: FREE_COMB,
      entryId: 'FREE01',
      designation: {
        cls: 'I',
        combination: FREE_COMB,
        receiving_party: { kind: 'principal', id: 'party-1' },
      },
    },
  ],
})

function refOf(comb: string): string {
  const r = buildWrCodeReference('I', [TENANT, comb])
  if (!r.ok) throw new Error(r.reason)
  return r.canonical
}
const I_REF = refOf(I_COMB)
const FREE_REF = refOf(FREE_COMB)

const I_ENTRY_KEY = (() => {
  const captured = captureWrCodeReference(I_REF)
  if (!captured.ok) throw new Error(captured.reason)
  const derived = deriveEntryDesignator(
    captured,
    { cls: 'I', combination: I_COMB, receiving_party: { kind: 'principal', id: 'party-1' } },
    'CTX001',
  )
  if (!derived.ok) throw new Error(derived.reason)
  return derived.designator
})()

let dir: string
let dbPath: string
let db: WrcSecurityDb
let useLimits: WrcUseLimitStore

function compose(handle: WrcSecurityDb, useLimitsOverride?: WrcUseLimitStore) {
  const transport = createMultiFixtureTransport([tenantFx])
  const client = new WrcResolutionClient({
    transport,
    store: new WrcResolvedRecordStore(createMemoryPersistence()),
    ingestPublicKey: INGEST.pub,
  })
  const directory = new WrcDirectoryClient({
    transport,
    operator: { kid: OPERATOR.kid, pub: OPERATOR.pub },
  })
  useLimits = useLimitsOverride ?? createDbUseLimitStore(handle)
  setWrcClientForTests(client)
  setWrcDirectoryForTests(directory)
  setWrcUseLimitStoreForTests(useLimits)
  setWrcAdmissionReplayForTests(createDbAdmissionReplayStore(handle))
  setWrcIdentityForTests({
    receiver: { party_id: 'party-1' },
    claimIdentity: null,
    decryptKey: null,
  })
}

beforeEach(() => {
  if (!Database) return
  dir = mkdtempSync(join(tmpdir(), 'wrc-accept-'))
  dbPath = join(dir, 'wrc-security.db')
  db = openWrcSecurityDb(dbPath)
  compose(db)
  clearWrcPendingAcceptancesForTests()
})

afterEach(() => {
  if (!Database) return
  setWrcClientForTests(null)
  setWrcDirectoryForTests(null)
  setWrcUseLimitStoreForTests(null)
  setWrcAdmissionReplayForTests(null)
  setWrcIdentityForTests(null)
  clearWrcPendingAcceptancesForTests()
  try {
    db.close()
  } catch {
    /* closed by restart */
  }
  rmSync(dir, { recursive: true, force: true })
})

function declareSingleUse() {
  useLimits.declare(TENANT, useLimitEntryKey(I_ENTRY_KEY), defaultUseLimitProfile(1))
}

async function submitOk(raw = I_REF, requestInstanceId = 'req-1') {
  const r = await handleWrcSubmitReference({ raw, requestInstanceId })
  expect(r.success).toBe(true)
  if (!r.success) throw new Error('submit failed')
  expect(r.result.ok, r.result.ok ? '' : JSON.stringify(r.result)).toBe(true)
  expect(typeof r.acceptanceToken).toBe('string')
  return r.acceptanceToken as string
}

describe.skipIf(!Database)('explicit acceptance boundary [XVI.8.4 consume_at = acceptance]', () => {
  it('admission claims but does not consume; acceptance consumes exactly once', async () => {
    declareSingleUse()
    const token = await submitOk()

    // Post-admission: CLAIMED, not consumed — admission is not acceptance.
    const claimed = useLimits.read(TENANT, useLimitEntryKey(I_ENTRY_KEY))
    expect(claimed?.state).toBe('claimed')

    const accepted = await handleWrcAcceptReference({ acceptanceToken: token })
    expect(accepted.success, accepted.success ? '' : accepted.error).toBe(true)
    if (!accepted.success) return
    expect(accepted.result.consumed).toBe(true)

    const after = useLimits.read(TENANT, useLimitEntryKey(I_ENTRY_KEY))
    expect(after?.state).toBe('consumed')

    // The spent token buys nothing more.
    const again = await handleWrcAcceptReference({ acceptanceToken: token })
    expect(again.success).toBe(false)
    if (again.success) return
    expect(again.error).toBe('acceptance_unknown')
  })

  it('a caller cannot mark an arbitrary entry consumed: only a runtime-minted token works', async () => {
    declareSingleUse()
    await submitOk()
    const forged = await handleWrcAcceptReference({ acceptanceToken: 'A'.repeat(32) })
    expect(forged.success).toBe(false)
    if (forged.success) return
    expect(forged.error).toBe('acceptance_unknown')
    // And the state did not move.
    expect(useLimits.read(TENANT, useLimitEntryKey(I_ENTRY_KEY))?.state).toBe('claimed')
  })

  it('a failed acceptance does not consume (claim no longer held)', async () => {
    declareSingleUse()
    const token = await submitOk()
    // The claim evaporates before acceptance (decline path / timeout model).
    useLimits.release(TENANT, useLimitEntryKey(I_ENTRY_KEY), 'party-1')

    const r = await handleWrcAcceptReference({ acceptanceToken: token })
    expect(r.success).toBe(false)
    if (r.success) return
    expect(r.error).toContain('acceptance_refused')
    expect(useLimits.read(TENANT, useLimitEntryKey(I_ENTRY_KEY))?.state).toBe('active')
  })

  it('crash BEFORE committed acceptance never records consumption', async () => {
    declareSingleUse()
    await submitOk()
    // Crash: pending acceptances are process memory and die with the process.
    clearWrcPendingAcceptancesForTests()
    // The durable state never saw a consumption; the claim times out normally.
    const row = useLimits.read(TENANT, useLimitEntryKey(I_ENTRY_KEY))
    expect(row?.state).toBe('claimed')
    expect(row?.uses_taken).toBe(0)
  })

  it('crash/restart AFTER consumption does not restore the use', async () => {
    declareSingleUse()
    const token = await submitOk()
    const accepted = await handleWrcAcceptReference({ acceptanceToken: token })
    expect(accepted.success).toBe(true)

    // Restart: reopen the file, recompose, drop all process state.
    db.close()
    db = openWrcSecurityDb(dbPath)
    compose(db)
    clearWrcPendingAcceptancesForTests()

    expect(useLimits.read(TENANT, useLimitEntryKey(I_ENTRY_KEY))?.state).toBe('consumed')
    // A second resolution attempt refuses on the consumed state.
    const r = await handleWrcSubmitReference({ raw: I_REF, requestInstanceId: 'req-2' })
    expect(r.success).toBe(true)
    if (!r.success) return
    expect(r.result.ok).toBe(false)
    if (r.result.ok) return
    expect(r.result.reason).toBe('CONSUMED')
  })

  it('racing acceptances on one token: exactly one winner', async () => {
    declareSingleUse()
    const token = await submitOk()
    const [a, b] = await Promise.all([
      handleWrcAcceptReference({ acceptanceToken: token }),
      handleWrcAcceptReference({ acceptanceToken: token }),
    ])
    const wins = [a, b].filter((r) => r.success)
    expect(wins.length).toBe(1)
    expect(useLimits.read(TENANT, useLimitEntryKey(I_ENTRY_KEY))?.uses_taken).toBe(1)
  })

  it('an entry with no declared profile accepts trivially (nothing to consume)', async () => {
    const token = await submitOk(FREE_REF, 'req-free')
    const r = await handleWrcAcceptReference({ acceptanceToken: token })
    expect(r.success).toBe(true)
    if (!r.success) return
    expect(r.result.accepted).toBe(true)
    expect(r.result.consumed).toBe(false)
  })

  it('an infrastructure failure fails closed but does NOT spend the token', async () => {
    declareSingleUse()
    const token = await submitOk()

    // A store whose consume throws once (DB briefly unavailable).
    let threw = false
    const flaky: WrcUseLimitStore = {
      ...useLimits,
      declare: useLimits.declare.bind(useLimits),
      posture: useLimits.posture.bind(useLimits),
      claim: useLimits.claim.bind(useLimits),
      release: useLimits.release.bind(useLimits),
      read: useLimits.read.bind(useLimits),
      consume: (...args) => {
        if (!threw) {
          threw = true
          throw new Error('SQLITE_BUSY: database is locked')
        }
        return useLimits.consume(...args)
      },
    }
    const durable = useLimits
    setWrcUseLimitStoreForTests(flaky)

    const failed = await handleWrcAcceptReference({ acceptanceToken: token })
    expect(failed.success).toBe(false)
    if (failed.success) return
    expect(failed.error).toContain('SQLITE_BUSY')
    // Nothing consumed by the failure.
    expect(durable.read(TENANT, useLimitEntryKey(I_ENTRY_KEY))?.state).toBe('claimed')

    // The decision was never made — the token still works once the store is back.
    const retry = await handleWrcAcceptReference({ acceptanceToken: token })
    expect(retry.success, retry.success ? '' : retry.error).toBe(true)
    if (!retry.success) return
    expect(retry.result.consumed).toBe(true)
  })
})
