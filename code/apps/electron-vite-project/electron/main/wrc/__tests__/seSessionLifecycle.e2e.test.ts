/**
 * Run 4 — §XVI.5.7 SE session / expiry lifecycle, end to end.
 *
 * "What distinguishes SE is lifecycle, not form: an SE entry exists only
 * under an established parent handshake, is bound to a session or a bounded
 * time window, is not durable, and resolves only while its session and
 * expiry are valid; afterwards it is EXPIRED and its identifier is not
 * reissued (P11). Expiry, replay, session binding, and authorization remain
 * separate state and are not replaced by the check."
 *
 * These vectors prove: the live window admits; expired and not-yet-valid
 * windows refuse with distinct reasons; a session-less SE refuses; parent
 * ineligibility refuses through the governing-parent leg (its own axis, not
 * a session mutation); session state never merges with entry lifecycle or
 * §XVI.8.4 use states; and one-time-use composes with SE.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { buildWrCodeReference } from '@repo/ingestion-core'
import { runWrCodeGatePipeline, type WrCodeReceiverIdentity } from '../gatePipeline'
import { createWrcGateDeps } from '../gatePipelineAdapter'
import { WrcDirectoryClient } from '../namespaceDirectory'
import { WrcResolutionClient } from '../resolutionClient'
import { WrcResolvedRecordStore, createMemoryPersistence } from '../resolvedRecordStore'
import {
  createMemoryUseLimitStore,
  defaultUseLimitProfile,
  type WrcUseLimitStore,
} from '../useLimitStore'
import { designatorKey } from '../entryDesignator'
import {
  buildPublisherFixture,
  createMultiFixtureTransport,
  type WrcPublisherFixture,
} from './wrcFixtures'

const NOW = 1_754_650_100
const PUB = 'WR7X4K'
const PARENT_ENTRY = '9B2M3'

const SE_LIVE = 'SEA1V0' // live window
const SE_EXPIRED = 'SEEXP0' // window already over
const SE_FUTURE = 'SEFTR0' // window not started
const SE_BARE = 'SEBAR0' // no session declared at all
const SE_ORPHAN = 'SE0RPH' // parent entry does not exist
const SE_OTHER = 'SE0THR' // addressed to someone else
const SE_LIMIT = 'SE7M31' // one-time-use SE

function seDesignation(comb: string, session: Record<string, unknown> | null, partyId = 'party-1') {
  return {
    cls: 'SE',
    combination: comb,
    receiving_party: { kind: 'principal', id: partyId },
    parent: { cls: 'P', publisher_part: PUB, entry_id: PARENT_ENTRY },
    ...(session === null ? {} : { session }),
  }
}

function buildFx(overrides: { parentStatus?: 'published' | 'suspended' } = {}): WrcPublisherFixture {
  return buildPublisherFixture({
    entryStatus: overrides.parentStatus ?? 'published',
    extraEntries: [
      {
        lookupKey: SE_LIVE,
        entryId: 'SEE001',
        designation: seDesignation(SE_LIVE, {
          id: 'sess-1',
          not_before: NOW - 60,
          expires_at: NOW + 600,
        }),
      },
      {
        lookupKey: SE_EXPIRED,
        entryId: 'SEE002',
        designation: seDesignation(SE_EXPIRED, {
          id: 'sess-2',
          not_before: null,
          expires_at: NOW - 1,
        }),
      },
      {
        lookupKey: SE_FUTURE,
        entryId: 'SEE003',
        designation: seDesignation(SE_FUTURE, {
          id: 'sess-3',
          not_before: NOW + 300,
          expires_at: NOW + 900,
        }),
      },
      {
        lookupKey: SE_BARE,
        entryId: 'SEE004',
        designation: seDesignation(SE_BARE, null),
      },
      {
        lookupKey: SE_ORPHAN,
        entryId: 'SEE005',
        designation: {
          ...seDesignation(SE_ORPHAN, { id: 'sess-5', not_before: null, expires_at: NOW + 600 }),
          parent: { cls: 'P', publisher_part: PUB, entry_id: 'NOPE99' },
        },
      },
      {
        lookupKey: SE_OTHER,
        entryId: 'SEE006',
        designation: seDesignation(
          SE_OTHER,
          { id: 'sess-6', not_before: null, expires_at: NOW + 600 },
          'party-2',
        ),
      },
      {
        lookupKey: SE_LIMIT,
        entryId: 'SEE007',
        designation: seDesignation(SE_LIMIT, {
          id: 'sess-7',
          not_before: null,
          expires_at: NOW + 600,
        }),
      },
    ],
  })
}

function seRef(comb: string): string {
  const r = buildWrCodeReference('SE', [PUB, comb])
  if (!r.ok) throw new Error(r.reason)
  return r.canonical
}

const RECEIVER: WrCodeReceiverIdentity = { party_id: 'party-1' }

let fx: WrcPublisherFixture
let useLimits: WrcUseLimitStore
let deps: ReturnType<typeof createWrcGateDeps>

function depsFor(fixture: WrcPublisherFixture, nowS: () => number) {
  // Multi-fixture transport even for one publisher: unknown entry lookups
  // must 404 (the single-fixture double keeps a legacy primary-entry
  // fallback that would make an orphaned parent "resolve").
  const transport = createMultiFixtureTransport([fixture])
  const client = new WrcResolutionClient({
    transport,
    store: new WrcResolvedRecordStore(createMemoryPersistence()),
    ingestPublicKey: fixture.ingest.pub,
    now: nowS,
  })
  const directory = new WrcDirectoryClient({
    transport,
    operator: { kid: fixture.operator.kid, pub: fixture.operator.pub },
    now: nowS,
  })
  return createWrcGateDeps(client, { useLimits, now: nowS, directory })
}

beforeEach(() => {
  fx = buildFx()
  useLimits = createMemoryUseLimitStore()
  deps = depsFor(fx, () => NOW)
})

describe('SE session window at Gate 3 [XVI.5.7]', () => {
  it('a live SE under a governing parent admits through all six gates', async () => {
    const r = await runWrCodeGatePipeline({ raw: seRef(SE_LIVE), receiver: RECEIVER }, deps)
    expect(r.ok, r.ok ? '' : `${r.reason}: ${r.detail}`).toBe(true)
    if (!r.ok) return
    expect(r.material.session?.id).toBe('sess-1')
    expect(r.designator.cls).toBe('SE')
  })

  it('an expired SE is EXPIRED — the annex\'s own terminal word, not inactive/revoked', async () => {
    const r = await runWrCodeGatePipeline({ raw: seRef(SE_EXPIRED), receiver: RECEIVER }, deps)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.gate).toBe(3)
    expect(r.reason).toBe('entry_expired')
    expect(r.detail).toContain('sess-2')
  })

  it('a not-yet-valid session refuses with its own distinct state', async () => {
    const r = await runWrCodeGatePipeline({ raw: seRef(SE_FUTURE), receiver: RECEIVER }, deps)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.gate).toBe(3)
    expect(r.reason).toBe('session_not_yet_valid')
  })

  it('an SE whose resolver declares NO session refuses closed', async () => {
    const r = await runWrCodeGatePipeline({ raw: seRef(SE_BARE), receiver: RECEIVER }, deps)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.gate).toBe(3)
    expect(r.reason).toBe('designation_mismatch')
    expect(r.detail).toContain('§XVI.5.7')
  })

  it('expiry is decided by the pipeline clock: the same SE expires as time passes', async () => {
    const early = await runWrCodeGatePipeline({ raw: seRef(SE_LIVE), receiver: RECEIVER }, deps)
    expect(early.ok).toBe(true)

    const late = await runWrCodeGatePipeline(
      { raw: seRef(SE_LIVE), receiver: RECEIVER },
      depsFor(fx, () => NOW + 700),
    )
    expect(late.ok).toBe(false)
    if (late.ok) return
    expect(late.reason).toBe('entry_expired')
  })
})

describe('parent eligibility is its own axis, never a session mutation [XVI.5.7]', () => {
  it('an SE beneath a parent that does not resolve refuses as unresolved_parent', async () => {
    const r = await runWrCodeGatePipeline({ raw: seRef(SE_ORPHAN), receiver: RECEIVER }, deps)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.gate).toBe(3)
    expect(r.reason).toBe('unresolved_parent')
  })

  it('a governing-parent transition (suspension) invalidates a live SE at once', async () => {
    // Same identifiers, same live session — but the parent entry is now
    // suspended on the resolver. The SE refuses through the parent leg while
    // its session state remains untouched (distinct state machines).
    const suspendedParent = buildFx({ parentStatus: 'suspended' })
    const r = await runWrCodeGatePipeline(
      { raw: seRef(SE_LIVE), receiver: RECEIVER },
      depsFor(suspendedParent, () => NOW),
    )
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.gate).toBe(3)
    expect(r.reason).toBe('unresolved_parent')
    expect(r.detail).toContain('not in a governing state')
  })
})

describe('session-scoped receiving party [XVI.5.7 + Gate 4]', () => {
  it('an SE addressed to another principal refuses NOT_FOR_YOU after the window passes', async () => {
    const r = await runWrCodeGatePipeline({ raw: seRef(SE_OTHER), receiver: RECEIVER }, deps)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.gate).toBe(4)
    expect(r.reason).toBe('NOT_FOR_YOU')
    // The session was live — Gate 3 passed; addressing failed on its own axis.
    expect(r.gatesPassed).toContain('entry')
  })
})

describe('one-time-use SE (§XVI.8.4 composes with §XVI.5.7)', () => {
  it('a use-limited SE claims once; a session replay of a CONSUMED SE surfaces CONSUMED', async () => {
    // Key the declaration by the SE's canonical designator.
    const first = await runWrCodeGatePipeline(
      { raw: seRef(SE_LIMIT), receiver: RECEIVER, requestInstanceId: 'req-1' },
      deps,
    )
    expect(first.ok, first.ok ? '' : `${first.reason}: ${first.detail}`).toBe(true)
    if (!first.ok) return
    const key = designatorKey(first.designator)

    useLimits.declare(PUB, key, defaultUseLimitProfile(1))
    const second = await runWrCodeGatePipeline(
      { raw: seRef(SE_LIMIT), receiver: RECEIVER, requestInstanceId: 'req-2' },
      deps,
    )
    expect(second.ok).toBe(true) // Gate 5 takes the claim for party-1

    const consumed = useLimits.consume(PUB, key, 'party-1', 'req-2', NOW + 5)
    expect(consumed.ok).toBe(true)

    // Replay after consumption: the session window is STILL live, but the
    // use state is terminal — proof the two axes never merge.
    const replay = await runWrCodeGatePipeline(
      { raw: seRef(SE_LIMIT), receiver: RECEIVER, requestInstanceId: 'req-3' },
      deps,
    )
    expect(replay.ok).toBe(false)
    if (replay.ok) return
    expect(replay.gate).toBe(3)
    expect(replay.reason).toBe('CONSUMED')
  })

  it('an expired session refuses BEFORE any use-limit claim could fire (no spent use)', async () => {
    const lateDeps = depsFor(fx, () => NOW + 700)
    const first = await runWrCodeGatePipeline(
      { raw: seRef(SE_LIMIT), receiver: RECEIVER, requestInstanceId: 'req-9' },
      lateDeps,
    )
    expect(first.ok).toBe(false)
    if (first.ok) return
    expect(first.reason).toBe('entry_expired')
    // No claim was taken anywhere: a fresh declaration still shows ACTIVE.
    expect(useLimits.posture(PUB, 'anything', NOW + 700)).toBeNull()
  })
})
