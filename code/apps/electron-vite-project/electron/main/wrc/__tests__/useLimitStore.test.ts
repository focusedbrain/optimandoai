/**
 * §XVI.8.4 one-time-use — claim cycle, atomic compare-and-set, timeout
 * release, consume/decrement, idempotency, terminal permanence.
 *
 * The same conformance block runs against BOTH backends (in-memory and
 * native-DB), because the two must be incapable of divergent semantics; the
 * DB block is skipped only where better-sqlite3 has no prebuilt binary.
 *
 * Concurrency is mandatory here: two racing claims produce exactly one
 * winner, and the loser gets the deterministic CLAIMED_BY_OTHER — at the
 * store level AND through the full six-gate pipeline.
 */
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { buildWrCodeReference } from '@repo/ingestion-core'
import {
  WRC_DEFAULT_CLAIM_TIMEOUT_S,
  createDbUseLimitStore,
  createMemoryUseLimitStore,
  defaultUseLimitProfile,
  useLimitTablePresent,
  type WrcUseLimitStore,
} from '../useLimitStore'
import { runWrCodeGatePipeline } from '../gatePipeline'
import { deriveEntryDesignator, useLimitEntryKey } from '../entryDesignator'
import { createWrcGateDeps } from '../gatePipelineAdapter'
import { WrcResolutionClient } from '../resolutionClient'
import { WrcResolvedRecordStore, createMemoryPersistence } from '../resolvedRecordStore'
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

const USE_STATE_SQL = `CREATE TABLE wrc_entry_use_state (
  publisher_part TEXT NOT NULL,
  entry_id TEXT NOT NULL,
  use_limit INTEGER NOT NULL,
  use_scope TEXT NOT NULL,
  consume_at TEXT NOT NULL,
  claim_timeout_s INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'active',
  uses_taken INTEGER NOT NULL DEFAULT 0,
  claimed_by TEXT,
  claimed_at_s INTEGER,
  claim_request_id TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (publisher_part, entry_id)
)`

function dbStore(): WrcUseLimitStore {
  const d = new Database(':memory:')
  d.exec(USE_STATE_SQL)
  expect(useLimitTablePresent(d)).toBe(true)
  return createDbUseLimitStore(d)
}

const PUB = 'WR7X4K'
const ENTRY = '9B2M3'
const T0 = 1_754_650_100

// ── Backend-shared conformance ────────────────────────────────────────────────

function conformance(name: string, make: () => WrcUseLimitStore, enabled: boolean) {
  describe.skipIf(!enabled)(`${name} backend — §XVI.8.4 conformance`, () => {
    it('undeclared entries have no posture: the unbounded default', () => {
      const s = make()
      expect(s.posture(PUB, ENTRY, T0)).toBeNull()
    })

    it('claim cycle: ACTIVE → CLAIMED → CONSUMED on acceptance; further capture reports CONSUMED', () => {
      const s = make()
      s.declare(PUB, ENTRY, defaultUseLimitProfile(1))
      expect(s.posture(PUB, ENTRY, T0)).toEqual({ state: 'active', claimed_by: null })

      const claim = s.claim(PUB, ENTRY, 'party-1', 'req-1', T0)
      expect(claim).toEqual({ ok: true, state: 'claimed' })
      expect(s.posture(PUB, ENTRY, T0)).toEqual({ state: 'claimed', claimed_by: 'party-1' })

      const consumed = s.consume(PUB, ENTRY, 'party-1', 'req-1', T0 + 10)
      expect(consumed.ok).toBe(true)
      if (consumed.ok) expect(consumed.state).toBe('consumed')
      expect(s.posture(PUB, ENTRY, T0 + 20)?.state).toBe('consumed')

      // A later claim resolves to the truth: CONSUMED, never a new offer.
      const late = s.claim(PUB, ENTRY, 'party-2', 'req-2', T0 + 30)
      expect(late).toEqual({ ok: false, reason: 'CONSUMED' })
    })

    it('two racing claims: ONE winner, loser gets deterministic CLAIMED_BY_OTHER and no material', async () => {
      const s = make()
      s.declare(PUB, ENTRY, defaultUseLimitProfile(1))
      const [a, b] = await Promise.all([
        (async () => s.claim(PUB, ENTRY, 'party-A', 'req-A', T0))(),
        (async () => s.claim(PUB, ENTRY, 'party-B', 'req-B', T0))(),
      ])
      const winners = [a, b].filter((r) => r.ok)
      const losers = [a, b].filter((r) => !r.ok)
      expect(winners).toHaveLength(1)
      expect(losers).toHaveLength(1)
      const loser = losers[0]!
      if (!loser.ok) {
        expect(loser.reason).toBe('CLAIMED_BY_OTHER')
        expect(loser.claimedBy).toBe(a.ok ? 'party-A' : 'party-B')
      }
    })

    it('a retry of the same claim by the same party is NOT a second use (idempotency)', () => {
      const s = make()
      s.declare(PUB, ENTRY, defaultUseLimitProfile(1))
      expect(s.claim(PUB, ENTRY, 'party-1', 'req-1', T0).ok).toBe(true)
      expect(s.claim(PUB, ENTRY, 'party-1', 'req-1', T0 + 5)).toEqual({ ok: true, state: 'claimed' })
      // And an idempotent re-acceptance after consuming:
      expect(s.consume(PUB, ENTRY, 'party-1', 'req-1', T0 + 10).ok).toBe(true)
      const again = s.consume(PUB, ENTRY, 'party-1', 'req-1', T0 + 15)
      expect(again.ok).toBe(true)
      if (again.ok) expect(again.usesTaken).toBe(1)
    })

    it('claim timeout reverts the reservation: the entry reads ACTIVE and is claimable again', () => {
      const s = make()
      s.declare(PUB, ENTRY, defaultUseLimitProfile(1))
      expect(s.claim(PUB, ENTRY, 'party-1', 'req-1', T0).ok).toBe(true)

      const beforeTimeout = T0 + WRC_DEFAULT_CLAIM_TIMEOUT_S - 1
      const afterTimeout = T0 + WRC_DEFAULT_CLAIM_TIMEOUT_S
      expect(s.posture(PUB, ENTRY, beforeTimeout)?.state).toBe('claimed')
      expect(s.posture(PUB, ENTRY, afterTimeout)?.state).toBe('active')

      const second = s.claim(PUB, ENTRY, 'party-2', 'req-2', afterTimeout)
      expect(second).toEqual({ ok: true, state: 'claimed' })
      // The expired holder cannot consume what it no longer holds.
      const stale = s.consume(PUB, ENTRY, 'party-1', 'req-1', afterTimeout + 1)
      expect(stale.ok).toBe(false)
    })

    it('decline releases the claim: reverts to ACTIVE, never consumes a use', () => {
      const s = make()
      s.declare(PUB, ENTRY, defaultUseLimitProfile(1))
      expect(s.claim(PUB, ENTRY, 'party-1', 'req-1', T0).ok).toBe(true)
      s.release(PUB, ENTRY, 'party-1')
      expect(s.posture(PUB, ENTRY, T0 + 1)).toEqual({ state: 'active', claimed_by: null })
      expect(s.read(PUB, ENTRY)?.uses_taken).toBe(0)
      // Another party's release is a no-op — it cannot free someone's claim.
      expect(s.claim(PUB, ENTRY, 'party-2', 'req-2', T0 + 2).ok).toBe(true)
      s.release(PUB, ENTRY, 'party-9')
      expect(s.posture(PUB, ENTRY, T0 + 3)?.state).toBe('claimed')
    })

    it('n > 1 decrements and returns to ACTIVE; the last use is terminal', () => {
      const s = make()
      s.declare(PUB, ENTRY, defaultUseLimitProfile(2))
      expect(s.claim(PUB, ENTRY, 'party-1', 'req-1', T0).ok).toBe(true)
      const first = s.consume(PUB, ENTRY, 'party-1', 'req-1', T0 + 1)
      expect(first.ok).toBe(true)
      if (first.ok) {
        expect(first.state).toBe('active')
        expect(first.usesTaken).toBe(1)
      }
      expect(s.claim(PUB, ENTRY, 'party-2', 'req-2', T0 + 2).ok).toBe(true)
      const second = s.consume(PUB, ENTRY, 'party-2', 'req-2', T0 + 3)
      expect(second.ok).toBe(true)
      if (second.ok) expect(second.state).toBe('consumed')
    })

    it('automation scope exhausts instead of consuming; refusal is CONTEXT_EXHAUSTED', () => {
      const s = make()
      s.declare(PUB, ENTRY, { ...defaultUseLimitProfile(1), use_scope: 'automation', consume_at: 'execution' })
      expect(s.claim(PUB, ENTRY, 'party-1', 'req-1', T0).ok).toBe(true)
      const done = s.consume(PUB, ENTRY, 'party-1', 'req-1', T0 + 1)
      expect(done.ok).toBe(true)
      if (done.ok) expect(done.state).toBe('exhausted')
      expect(s.claim(PUB, ENTRY, 'party-2', 'req-2', T0 + 2)).toEqual({
        ok: false,
        reason: 'CONTEXT_EXHAUSTED',
      })
    })

    it('consume_at = resolution (bearer) spends the use at the claim itself', () => {
      const s = make()
      s.declare(PUB, ENTRY, { ...defaultUseLimitProfile(1), consume_at: 'resolution' })
      const r = s.claim(PUB, ENTRY, 'party-1', 'req-1', T0)
      expect(r).toEqual({ ok: true, state: 'consumed' })
      expect(s.posture(PUB, ENTRY, T0 + 1)?.state).toBe('consumed')
    })

    it('terminal permanence (P11): re-declaration never resurrects a consumed identifier', () => {
      const s = make()
      s.declare(PUB, ENTRY, defaultUseLimitProfile(1))
      expect(s.claim(PUB, ENTRY, 'party-1', 'req-1', T0).ok).toBe(true)
      expect(s.consume(PUB, ENTRY, 'party-1', 'req-1', T0 + 1).ok).toBe(true)
      s.declare(PUB, ENTRY, defaultUseLimitProfile(5))
      expect(s.posture(PUB, ENTRY, T0 + 2)?.state).toBe('consumed')
      expect(s.claim(PUB, ENTRY, 'party-2', 'req-2', T0 + 3)).toEqual({ ok: false, reason: 'CONSUMED' })
    })
  })
}

conformance('memory', createMemoryUseLimitStore, true)
conformance('native-DB', dbStore, Boolean(Database))

// ── Through the pipeline: enforcement at the gates ────────────────────────────

const FX = buildPublisherFixture()
const P_REF = 'PWR7X4K9B2M3C'
const NOW = 1_754_650_100

function pipelineDeps(store: WrcUseLimitStore, nowS: () => number) {
  const client = new WrcResolutionClient({
    transport: createFixtureTransport(FX),
    store: new WrcResolvedRecordStore(createMemoryPersistence()),
    ingestPublicKey: FX.ingest.pub,
    now: nowS,
  })
  return createWrcGateDeps(client, { useLimits: store, now: nowS })
}

describe('one-time-use through the six gates [XVI.7.6 + XVI.8.4]', () => {
  it('a use-limited entry admits once; the second submission resolves to CONSUMED', async () => {
    const store = createMemoryUseLimitStore()
    store.declare(FX.publisherPart, FX.entryId, defaultUseLimitProfile(1))
    const deps = pipelineDeps(store, () => NOW)

    const first = await runWrCodeGatePipeline(
      { raw: P_REF, receiver: { party_id: 'party-1' }, requestInstanceId: 'req-1' },
      deps,
    )
    expect(first.ok, first.ok ? '' : first.reason).toBe(true)

    // Gate 5 claimed it; the party's explicit acceptance consumes it.
    const consumed = store.consume(FX.publisherPart, FX.entryId, 'party-1', 'req-1', NOW + 5)
    expect(consumed.ok).toBe(true)

    const second = await runWrCodeGatePipeline(
      { raw: P_REF, receiver: { party_id: 'party-2' }, requestInstanceId: 'req-2' },
      deps,
    )
    expect(second.ok).toBe(false)
    if (second.ok) return
    expect(second.gate).toBe(3)
    expect(second.reason).toBe('CONSUMED')
    expect(second.unsuppressibleWarning).toBe(true)
  })

  it('two racing submissions: one admission, the loser gets CLAIMED_BY_OTHER', async () => {
    const store = createMemoryUseLimitStore()
    store.declare(FX.publisherPart, FX.entryId, defaultUseLimitProfile(1))
    const deps = pipelineDeps(store, () => NOW)

    const [a, b] = await Promise.all([
      runWrCodeGatePipeline(
        { raw: P_REF, receiver: { party_id: 'party-A' }, requestInstanceId: 'req-A' },
        deps,
      ),
      runWrCodeGatePipeline(
        { raw: P_REF, receiver: { party_id: 'party-B' }, requestInstanceId: 'req-B' },
        deps,
      ),
    ])
    const winners = [a, b].filter((r) => r.ok)
    const losers = [a, b].filter((r) => !r.ok)
    expect(winners).toHaveLength(1)
    expect(losers).toHaveLength(1)
    const loser = losers[0]!
    if (!loser.ok) expect(loser.reason).toBe('CLAIMED_BY_OTHER')
  })

  it('a post-claim gate failure reverts the claim — a failed verification never consumes a use', async () => {
    const store = createMemoryUseLimitStore()
    store.declare(FX.publisherPart, FX.entryId, defaultUseLimitProfile(1))
    const base = pipelineDeps(store, () => NOW)
    // Same adapter deps, with the Gate-6 seam refusing — as a forged capsule
    // would after the claim was already taken at Gate 5.
    const deps = {
      ...base,
      admitCapsule: async () => ({ ok: false as const, reason: 'admission_refused' as const }),
    }

    const r = await runWrCodeGatePipeline(
      { raw: P_REF, receiver: { party_id: 'party-1' }, requestInstanceId: 'req-1' },
      deps,
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.gate).toBe(6)

    // The reservation reverted: the entry is ACTIVE and claimable by others.
    expect(store.posture(FX.publisherPart, FX.entryId, NOW + 1)).toEqual({
      state: 'active',
      claimed_by: null,
    })
    const next = store.claim(FX.publisherPart, FX.entryId, 'party-2', 'req-2', NOW + 2)
    expect(next.ok).toBe(true)
  })

  it('an unidentified party cannot claim a use-limited entry (fail closed at Gate 5)', async () => {
    const store = createMemoryUseLimitStore()
    store.declare(FX.publisherPart, FX.entryId, defaultUseLimitProfile(1))
    const deps = pipelineDeps(store, () => NOW)

    const r = await runWrCodeGatePipeline({ raw: P_REF, receiver: {} }, deps)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.gate).toBe(5)
    expect(r.reason).toBe('claim_failed')
    // Nothing was reserved for the anonymous attempt.
    expect(store.posture(FX.publisherPart, FX.entryId, NOW + 1)?.state).toBe('active')
  })
})

// ── Run 3 — canonical designator keys in the NATIVE table, non-destructively ──
//
// The persistence contract of the Run-3 order: the existing
// `wrc_entry_use_state` schema carries expanded designations without any
// migration — the canonical key is TEXT in the existing `entry_id` column —
// and every row Run 2 wrote (bare P local ids) stays attached to exactly the
// designator that owns it. Identifiers are never reissued or rewritten.

describe.skipIf(!Database)('designator-keyed persistence [Run 3 §5]', () => {
  const SP_DESIGNATOR = (() => {
    const built = buildWrCodeReference('SP', [PUB, 'SPC4MB'])
    if (!built.ok) throw new Error(built.reason)
    const d = deriveEntryDesignator(
      built,
      {
        cls: 'SP',
        combination: 'SPC4MB',
        receiving_party: { kind: 'principal', id: 'party-1' },
        parent: { cls: 'P', publisher_part: PUB, entry_id: ENTRY },
      },
      'SPENT1',
    )
    if (!d.ok) throw new Error(d.reason)
    return d.designator
  })()

  it('a canonical designator key rides the existing schema end to end', () => {
    const s = dbStore()
    const key = useLimitEntryKey(SP_DESIGNATOR)
    expect(key.startsWith('wrd1|')).toBe(true)

    s.declare(PUB, key, defaultUseLimitProfile(1))
    const claim = s.claim(PUB, key, 'party-1', 'req-1', T0)
    expect(claim.ok).toBe(true)

    // The stored identity IS the canonical key, verbatim — versioned,
    // positional, never a display string.
    const row = s.read(PUB, key)
    expect(row?.state).toBe('claimed')
    expect(row?.claimed_by).toBe('party-1')

    const consumed = s.consume(PUB, key, 'party-1', 'req-1', T0 + 3)
    expect(consumed.ok).toBe(true)
    expect(s.posture(PUB, key, T0 + 4)?.state).toBe('consumed')
  })

  it('rows written by Run 2 (bare P local id) attach to the P designator unchanged', () => {
    const s = dbStore()
    // Exactly what Run 2 persisted for a use-limited P entry.
    s.declare(PUB, ENTRY, defaultUseLimitProfile(1))

    // Run 3 reads the same row through the canonical model: the P designator's
    // use-limit key IS the bare local id — no migration, no reissue.
    const built = buildWrCodeReference('P', [PUB, ENTRY])
    if (!built.ok) throw new Error(built.reason)
    const derived = deriveEntryDesignator(built, null, ENTRY)
    expect(derived.ok).toBe(true)
    if (!derived.ok) return
    expect(useLimitEntryKey(derived.designator)).toBe(ENTRY)

    const claim = s.claim(PUB, useLimitEntryKey(derived.designator), 'party-1', 'req-1', T0)
    expect(claim.ok).toBe(true)
    expect(s.read(PUB, ENTRY)?.state).toBe('claimed')
  })

  it('the same child-local id under two parents is two distinct rows', () => {
    const s = dbStore()
    const otherParent = {
      ...SP_DESIGNATOR,
      cls: 'SE' as const,
      parent: { cls: 'C' as const, publisher_part: PUB, counterparty_part: 'RCVPBX' },
    }
    const keyA = useLimitEntryKey(SP_DESIGNATOR)
    const keyB = useLimitEntryKey(otherParent)
    expect(keyA).not.toBe(keyB)

    s.declare(PUB, keyA, defaultUseLimitProfile(1))
    s.declare(PUB, keyB, defaultUseLimitProfile(1))
    expect(s.claim(PUB, keyA, 'party-1', 'req-1', T0).ok).toBe(true)
    // Consuming A's use leaves B untouched.
    expect(s.consume(PUB, keyA, 'party-1', 'req-1', T0 + 1).ok).toBe(true)
    expect(s.posture(PUB, keyB, T0 + 2)).toEqual({ state: 'active', claimed_by: null })
  })
})
