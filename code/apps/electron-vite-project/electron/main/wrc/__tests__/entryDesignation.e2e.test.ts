/**
 * Run 3 — entry designation END TO END: §XVI.5.10 ordered pairs, combination
 * expansion, and S* parent binding through the REAL six-gate pipeline, the
 * real resolution client, and the contract-faithful signing double.
 *
 * Two publishers (initiator + responder of one C relationship) share a WRC
 * ingest key, so every namespace, entry, expansion, and parent verification
 * in here runs the full chain: DNS-pinned root, dual channel, head signature,
 * envelope countersignature, Merkle inclusion — no stubbed verdicts.
 *
 * Coverage demanded by the Run-3 order:
 *  - valid C designation; reversed ordered pair; SC/SP/SI/SE parent-child;
 *  - invalid parent class; unresolved parent (entry and responder namespace);
 *  - identical child-local identifier beneath two different parents;
 *  - lifecycle lookup, one-time-use claim, and racing claims through an
 *    expanded designation; no aliasing across classes; full-pipeline pass.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { buildWrCodeReference, captureWrCodeReference } from '@repo/ingestion-core'
import { runWrCodeGatePipeline, type WrCodeReceiverIdentity } from '../gatePipeline'
import { createWrcGateDeps } from '../gatePipelineAdapter'
import { WrcDirectoryClient } from '../namespaceDirectory'
import { deriveEntryDesignator, designatorKey, useLimitEntryKey } from '../entryDesignator'
import { WrcResolutionClient } from '../resolutionClient'
import { WrcResolvedRecordStore, createMemoryPersistence } from '../resolvedRecordStore'
import { createMemoryUseLimitStore, defaultUseLimitProfile } from '../useLimitStore'
import { createMemoryDeviceRegistry } from '../deviceRegistry'
import {
  buildPublisherFixture,
  createMultiFixtureTransport,
  makeKeyPair,
  signDeviceRecord,
} from './wrcFixtures'

// ── The relationship: WR7X4K (initiator) ↔ RCVPBX (responder) ─────────────────

const INITIATOR = 'WR7X4K'
const RESPONDER = 'RCVPBX'
const NOW = 1_754_650_100

// Combination blocks (Crockford-safe: no I/L/O/U, survive capture unchanged).
const SC_COMB = 'M3K9B2' // SC beneath the C pair
const SC_BAD = 'SCBAD1' // SC whose responder namespace does not resolve
const I_COMB = 'PA1RS7' // I umbrella context toward a principal
const SI_COMB = 'DEVSE1' // SI bound to one device
const SP_COMB = 'SPC4MB' // SP beneath the P parent entry
const SP_ORPHAN = 'SPBAD1' // SP whose parent entry does not exist
const SP_UNDER_C = 'SPBAD2' // SP claiming a C parent (invalid class)
const SE_UNDER_P = 'SEDP01' // SE beneath P — child-local id DUP001
const SE_UNDER_C = 'SEDP02' // SE beneath C — SAME child-local id DUP001

const INGEST = makeKeyPair('wrc-ingest-shared')
const OPERATOR = makeKeyPair('dir-op-shared')

const initiatorFx = buildPublisherFixture({
  publisherPart: INITIATOR,
  domain: 'publisher.test',
  ingestKey: INGEST,
  operatorKey: OPERATOR,
  extraEntries: [
    {
      // The C umbrella entry, named by the ordered pair: looked up by the
      // responder identifier under the initiator namespace.
      lookupKey: RESPONDER,
      entryId: 'CREL01',
      designation: { cls: 'C', initiator_part: INITIATOR, counterparty_part: RESPONDER },
    },
    {
      lookupKey: SC_COMB,
      entryId: 'SCENT1',
      designation: {
        cls: 'SC',
        combination: SC_COMB,
        receiving_party: { kind: 'publisher', id: RESPONDER },
        parent: { cls: 'C', publisher_part: INITIATOR, counterparty_part: RESPONDER },
      },
    },
    {
      lookupKey: SC_BAD,
      entryId: 'SCENT2',
      designation: {
        cls: 'SC',
        combination: SC_BAD,
        receiving_party: { kind: 'publisher', id: 'ZZPQB7' },
        parent: { cls: 'C', publisher_part: INITIATOR, counterparty_part: 'ZZPQB7' },
      },
    },
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
      lookupKey: SI_COMB,
      entryId: 'RES001',
      designation: {
        cls: 'SI',
        combination: SI_COMB,
        receiving_party: { kind: 'device', id: 'party-1:device-A' },
        parent: { cls: 'I', publisher_part: INITIATOR },
      },
    },
    {
      lookupKey: SP_COMB,
      entryId: 'SPENT1',
      designation: {
        cls: 'SP',
        combination: SP_COMB,
        receiving_party: { kind: 'principal', id: 'party-1' },
        parent: { cls: 'P', publisher_part: INITIATOR, entry_id: '9B2M3' },
      },
    },
    {
      lookupKey: SP_ORPHAN,
      entryId: 'SPENT2',
      designation: {
        cls: 'SP',
        combination: SP_ORPHAN,
        receiving_party: { kind: 'principal', id: 'party-1' },
        parent: { cls: 'P', publisher_part: INITIATOR, entry_id: 'NOPE99' },
      },
    },
    {
      lookupKey: SP_UNDER_C,
      entryId: 'SPENT3',
      designation: {
        cls: 'SP',
        combination: SP_UNDER_C,
        receiving_party: { kind: 'principal', id: 'party-1' },
        parent: { cls: 'C', publisher_part: INITIATOR, counterparty_part: RESPONDER },
      },
    },
    {
      lookupKey: SE_UNDER_P,
      entryId: 'DUP001',
      designation: {
        cls: 'SE',
        combination: SE_UNDER_P,
        receiving_party: { kind: 'principal', id: 'party-1' },
        parent: { cls: 'P', publisher_part: INITIATOR, entry_id: '9B2M3' },
        // §XVI.5.7 (Run 4): SE resolves only inside a live session window.
        session: { id: 'sess-dup-p', not_before: null, expires_at: NOW + 3_600 },
      },
    },
    {
      // SAME child-local identifier, DIFFERENT parent: must be a second entry.
      lookupKey: SE_UNDER_C,
      entryId: 'DUP001',
      designation: {
        cls: 'SE',
        combination: SE_UNDER_C,
        receiving_party: { kind: 'principal', id: 'party-1' },
        parent: { cls: 'C', publisher_part: INITIATOR, counterparty_part: RESPONDER },
        session: { id: 'sess-dup-c', not_before: null, expires_at: NOW + 3_600 },
      },
    },
  ],
})

const responderFx = buildPublisherFixture({
  publisherPart: RESPONDER,
  domain: 'responder.test',
  entryId: 'RSPENT',
  ingestKey: INGEST,
  operatorKey: OPERATOR,
  extraEntries: [
    {
      // The responder's mirror record of the SAME relationship, registered
      // with the true roles — a reversed reference must hit exactly this.
      lookupKey: INITIATOR,
      entryId: 'CRELMR',
      designation: { cls: 'C', initiator_part: INITIATOR, counterparty_part: RESPONDER },
    },
  ],
})

const RECEIVER: WrCodeReceiverIdentity = {
  publisher_part: RESPONDER,
  party_id: 'party-1',
  device_party_id: 'party-1:device-A',
}

function refOf(cls: 'P' | 'I' | 'C' | 'SP' | 'SI' | 'SC' | 'SE', blocks: string[]): string {
  const r = buildWrCodeReference(cls, blocks)
  if (!r.ok) throw new Error(`vector build failed: ${r.reason}`)
  return r.canonical
}

const C_REF = refOf('C', [INITIATOR, RESPONDER])
const C_REVERSED = refOf('C', [RESPONDER, INITIATOR])
const SC_REF = refOf('SC', [INITIATOR, SC_COMB])
const I_REF = refOf('I', [INITIATOR, I_COMB])
const SI_REF = refOf('SI', [INITIATOR, SI_COMB])
const SP_REF = refOf('SP', [INITIATOR, SP_COMB])
const SE_REF_P = refOf('SE', [INITIATOR, SE_UNDER_P])
const SE_REF_C = refOf('SE', [INITIATOR, SE_UNDER_C])

/** Canonical designator a test expects for a captured reference. */
function expectedDesignator(raw: string, claim: Parameters<typeof deriveEntryDesignator>[1], entryId: string) {
  const cap = captureWrCodeReference(raw)
  if (!cap.ok) throw new Error(cap.reason)
  const d = deriveEntryDesignator(cap, claim, entryId)
  if (!d.ok) throw new Error(`${d.reason}: ${d.detail}`)
  return d.designator
}

let client: WrcResolutionClient
let useLimits: ReturnType<typeof createMemoryUseLimitStore>
let deps: ReturnType<typeof createWrcGateDeps>

beforeEach(() => {
  const transport = createMultiFixtureTransport([initiatorFx, responderFx])
  client = new WrcResolutionClient({
    transport,
    store: new WrcResolvedRecordStore(createMemoryPersistence()),
    ingestPublicKey: INGEST.pub,
    now: () => NOW,
  })
  useLimits = createMemoryUseLimitStore()
  // Run 4 (§XVI.13.7): the SI device selection binds a record the tenant
  // holds — Gate 4 verifies the registration chain, so the tenant list
  // carries the device the SI_COMB expansion is bound to.
  const devices = createMemoryDeviceRegistry()
  devices.registerTenantDevice(
    signDeviceRecord(initiatorFx, {
      principalPartyId: 'party-1',
      devicePartyId: 'party-1:device-A',
      deviceName: 'device-A',
      deviceClass: 'workstation',
    }),
  )
  deps = createWrcGateDeps(client, {
    useLimits,
    now: () => NOW,
    directory: new WrcDirectoryClient({
      transport,
      operator: { kid: OPERATOR.kid, pub: OPERATOR.pub },
      now: () => NOW,
    }),
    devices,
  })
})

// ── C — ordered pair ──────────────────────────────────────────────────────────

describe('C ordered pair through all six gates [XVI.5.10, XVI.7.6]', () => {
  it('valid C designation admits: both namespaces verified, pair roles match', async () => {
    const r = await runWrCodeGatePipeline({ raw: C_REF, receiver: RECEIVER }, deps)
    expect(r.ok, r.ok ? '' : `${r.reason}: ${r.detail}`).toBe(true)
    if (!r.ok) return
    expect(r.gatesPassed).toHaveLength(6)
    expect(r.namespaces.map((n) => n.publisher_part)).toEqual([INITIATOR, RESPONDER])
    expect(r.designator).toMatchObject({
      cls: 'C',
      publisher_part: INITIATOR,
      entry_id: null,
      counterparty_part: RESPONDER,
    })
  })

  it('the REVERSED ordered pair refuses at Gate 3 with invalid_role_ordering', async () => {
    const r = await runWrCodeGatePipeline(
      { raw: C_REVERSED, receiver: { publisher_part: INITIATOR } },
      deps,
    )
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.gate).toBe(3)
    expect(r.reason).toBe('invalid_role_ordering')
  })
})

// ── S* parent binding ─────────────────────────────────────────────────────────

describe('S* parent binding [XVI.5.10]', () => {
  it('SC beneath the ESTABLISHED pair admits; responder namespace and parent entry verified', async () => {
    const r = await runWrCodeGatePipeline({ raw: SC_REF, receiver: RECEIVER }, deps)
    expect(r.ok, r.ok ? '' : `${r.reason}: ${r.detail}`).toBe(true)
    if (!r.ok) return
    expect(r.designator).toMatchObject({
      cls: 'SC',
      entry_id: 'SCENT1',
      receiving_party: { kind: 'publisher', id: RESPONDER },
      parent: { cls: 'C', publisher_part: INITIATOR, counterparty_part: RESPONDER },
    })
  })

  it('SC whose responder namespace does not resolve → unresolved_parent', async () => {
    const raw = refOf('SC', [INITIATOR, SC_BAD])
    const r = await runWrCodeGatePipeline({ raw, receiver: RECEIVER }, deps)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.gate).toBe(3)
    expect(r.reason).toBe('unresolved_parent')
  })

  it('SP beneath its P parent entry admits with the parent bound into the designator', async () => {
    const r = await runWrCodeGatePipeline({ raw: SP_REF, receiver: RECEIVER }, deps)
    expect(r.ok, r.ok ? '' : `${r.reason}: ${r.detail}`).toBe(true)
    if (!r.ok) return
    expect(r.designator.parent).toEqual({
      cls: 'P',
      publisher_part: INITIATOR,
      counterparty_part: null,
    })
  })

  it('SP whose named parent entry does not exist → unresolved_parent', async () => {
    const raw = refOf('SP', [INITIATOR, SP_ORPHAN])
    const r = await runWrCodeGatePipeline({ raw, receiver: RECEIVER }, deps)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.gate).toBe(3)
    expect(r.reason).toBe('unresolved_parent')
  })

  it('SP claiming a C parent → invalid_parent_class (class-fixed rule)', async () => {
    const raw = refOf('SP', [INITIATOR, SP_UNDER_C])
    const r = await runWrCodeGatePipeline({ raw, receiver: RECEIVER }, deps)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.gate).toBe(3)
    expect(r.reason).toBe('invalid_parent_class')
  })
})

// ── Receiving-party constituent at Gate 4 ─────────────────────────────────────

describe('receiving-party constituent — Gate 4 [XVI.5.10, XVI.7.6]', () => {
  it('I toward this principal admits; toward another principal → NOT_FOR_YOU', async () => {
    const mine = await runWrCodeGatePipeline({ raw: I_REF, receiver: RECEIVER }, deps)
    expect(mine.ok, mine.ok ? '' : `${mine.reason}`).toBe(true)

    const other = await runWrCodeGatePipeline(
      { raw: I_REF, receiver: { party_id: 'party-9' } },
      deps,
    )
    expect(other.ok).toBe(false)
    if (other.ok) return
    expect(other.gate).toBe(4)
    expect(other.reason).toBe('NOT_FOR_YOU')
  })

  it('device-bound SI: bound device admits; sibling device → NOT_FOR_THIS_DEVICE', async () => {
    const bound = await runWrCodeGatePipeline({ raw: SI_REF, receiver: RECEIVER }, deps)
    expect(bound.ok, bound.ok ? '' : `${bound.reason}: ${bound.detail}`).toBe(true)

    const sibling = await runWrCodeGatePipeline(
      { raw: SI_REF, receiver: { party_id: 'party-1', device_party_id: 'party-1:device-B' } },
      deps,
    )
    expect(sibling.ok).toBe(false)
    if (sibling.ok) return
    expect(sibling.gate).toBe(4)
    expect(sibling.reason).toBe('NOT_FOR_THIS_DEVICE')
  })

  it('SC addressed to the responder organization: a third party → NOT_FOR_YOU', async () => {
    const r = await runWrCodeGatePipeline(
      { raw: SC_REF, receiver: { publisher_part: 'ZZPQB7' } },
      deps,
    )
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.gate).toBe(4)
    expect(r.reason).toBe('NOT_FOR_YOU')
  })
})

// ── Collision resistance: same child-local id, two parents ────────────────────

describe('no cross-parent aliasing [Run 3 §4]', () => {
  it('the same child-local identifier beneath two parents is two distinct entries', async () => {
    const underP = await runWrCodeGatePipeline({ raw: SE_REF_P, receiver: RECEIVER }, deps)
    const underC = await runWrCodeGatePipeline({ raw: SE_REF_C, receiver: RECEIVER }, deps)
    expect(underP.ok, underP.ok ? '' : `${underP.reason}: ${underP.detail}`).toBe(true)
    expect(underC.ok, underC.ok ? '' : `${underC.reason}: ${underC.detail}`).toBe(true)
    if (!underP.ok || !underC.ok) return
    expect(underP.designator.entry_id).toBe('DUP001')
    expect(underC.designator.entry_id).toBe('DUP001')
    expect(designatorKey(underP.designator)).not.toBe(designatorKey(underC.designator))
  })

  it('consuming the entry under one parent leaves the other parent’s entry live', async () => {
    const dP = expectedDesignator(
      SE_REF_P,
      {
        cls: 'SE',
        combination: SE_UNDER_P,
        receiving_party: { kind: 'principal', id: 'party-1' },
        parent: { cls: 'P', publisher_part: INITIATOR, entry_id: '9B2M3' },
      },
      'DUP001',
    )
    // Declare one-time-use for the child under P only; consume it.
    useLimits.declare(INITIATOR, useLimitEntryKey(dP), defaultUseLimitProfile(1))
    const first = await runWrCodeGatePipeline({ raw: SE_REF_P, receiver: RECEIVER }, deps)
    expect(first.ok).toBe(true)
    useLimits.consume(INITIATOR, useLimitEntryKey(dP), 'party-1:device-A', null, NOW)

    const again = await runWrCodeGatePipeline({ raw: SE_REF_P, receiver: RECEIVER }, deps)
    expect(again.ok).toBe(false)
    if (!again.ok) expect(again.reason).toBe('CONSUMED')

    // The SAME child-local id under the C parent is untouched.
    const underC = await runWrCodeGatePipeline({ raw: SE_REF_C, receiver: RECEIVER }, deps)
    expect(underC.ok, underC.ok ? '' : `${underC.reason}`).toBe(true)
  })

  it('an SP claim never bleeds into the P parent entry it is bound under', async () => {
    const dSP = expectedDesignator(
      SP_REF,
      {
        cls: 'SP',
        combination: SP_COMB,
        receiving_party: { kind: 'principal', id: 'party-1' },
        parent: { cls: 'P', publisher_part: INITIATOR, entry_id: '9B2M3' },
      },
      'SPENT1',
    )
    useLimits.declare(INITIATOR, useLimitEntryKey(dSP), defaultUseLimitProfile(1))
    const r = await runWrCodeGatePipeline({ raw: SP_REF, receiver: RECEIVER }, deps)
    expect(r.ok).toBe(true)
    // Claimed for the SP designator; the bare P key (Run-2 format) is clean.
    expect(useLimits.read(INITIATOR, useLimitEntryKey(dSP))?.state).toBe('claimed')
    expect(useLimits.read(INITIATOR, '9B2M3')).toBeNull()

    // And the P entry still admits end to end.
    const p = await runWrCodeGatePipeline({ raw: 'PWR7X4K9B2M3C', receiver: RECEIVER }, deps)
    expect(p.ok, p.ok ? '' : `${p.reason}`).toBe(true)
  })
})

// ── §XVI.8.4 through expanded designation ─────────────────────────────────────

describe('one-time-use keyed by the canonical designator [XVI.8.4]', () => {
  const scClaim = {
    cls: 'SC',
    combination: SC_COMB,
    receiving_party: { kind: 'publisher', id: RESPONDER },
    parent: { cls: 'C', publisher_part: INITIATOR, counterparty_part: RESPONDER },
  }

  it('lifecycle lookup through the expanded designation: CONSUMED refuses at Gate 3', async () => {
    const d = expectedDesignator(SC_REF, scClaim, 'SCENT1')
    const key = useLimitEntryKey(d)
    useLimits.declare(INITIATOR, key, defaultUseLimitProfile(1))
    const winner = await runWrCodeGatePipeline({ raw: SC_REF, receiver: RECEIVER }, deps)
    expect(winner.ok).toBe(true)
    useLimits.consume(INITIATOR, key, 'party-1:device-A', null, NOW)

    const late = await runWrCodeGatePipeline({ raw: SC_REF, receiver: RECEIVER }, deps)
    expect(late.ok).toBe(false)
    if (late.ok) return
    expect(late.gate).toBe(3)
    expect(late.reason).toBe('CONSUMED')
  })

  it('two racing claims against the expanded-designation entry: one winner, loser gets CLAIMED_BY_OTHER', async () => {
    const d = expectedDesignator(SC_REF, scClaim, 'SCENT1')
    useLimits.declare(INITIATOR, useLimitEntryKey(d), defaultUseLimitProfile(1))

    // The responder organization resolving from two identified devices.
    const deviceA: WrCodeReceiverIdentity = { ...RECEIVER, device_party_id: 'party-1:device-A' }
    const deviceB: WrCodeReceiverIdentity = { ...RECEIVER, device_party_id: 'party-1:device-B' }
    const [a, b] = await Promise.all([
      runWrCodeGatePipeline({ raw: SC_REF, receiver: deviceA }, deps),
      runWrCodeGatePipeline({ raw: SC_REF, receiver: deviceB }, deps),
    ])
    const admitted = [a, b].filter((r) => r.ok)
    const refused = [a, b].filter((r) => !r.ok)
    expect(admitted).toHaveLength(1)
    expect(refused).toHaveLength(1)
    if (refused[0]!.ok) return
    expect(refused[0]!.reason).toBe('CLAIMED_BY_OTHER')
    // The reservation is held by exactly the winner.
    const row = useLimits.read(INITIATOR, useLimitEntryKey(d))
    expect(row?.state).toBe('claimed')
  })
})
