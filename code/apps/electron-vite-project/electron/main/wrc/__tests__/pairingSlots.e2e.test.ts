/**
 * Run 4 — §XVI.5.10 Pairing Slots, end to end.
 *
 * "A device joins a principal's context through an I code whose context
 * constituent is a Pairing Slot … the receiving party is the principal …
 * The slot is single-use by construction (§XVI.8.4, consume_at = acceptance)
 * and is superseded by the resulting Device Record."
 *
 * These fixtures prove the pairing boundary maps onto the EXISTING
 * architecture (six gates, Gate-4 principal match, §XVI.8.4 CAS, §XVI.13.7
 * device registry) with no second identity path: wrong principal dies at
 * Gate 4, replay dies at the use state, acceptance-stage failures release
 * the claim, and the resulting Device-Scoped Principal Identifier exists
 * only after a fully successful acceptance.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { buildWrCodeReference, captureWrCodeReference } from '@repo/ingestion-core'
import { createWrcGateDeps } from '../gatePipelineAdapter'
import { WrcDirectoryClient } from '../namespaceDirectory'
import { createMemoryDeviceRegistry, type WrcDeviceRecord, type WrcDeviceRegistry } from '../deviceRegistry'
import { deriveEntryDesignator, useLimitEntryKey } from '../entryDesignator'
import { acceptDevicePairing, type WrcPairingDeps, type WrcPairingPresentation } from '../pairingSlots'
import { WrcResolutionClient } from '../resolutionClient'
import { WrcResolvedRecordStore, createMemoryPersistence } from '../resolvedRecordStore'
import {
  createMemoryUseLimitStore,
  defaultUseLimitProfile,
  type WrcUseLimitStore,
} from '../useLimitStore'
import {
  buildPublisherFixture,
  createMultiFixtureTransport,
  makeKeyPair,
  signObject,
} from './wrcFixtures'

const NOW = 1_754_650_100
const TENANT = 'WR7X4K'
const OTHER_TENANT = 'ZZPQB7'
const PRINCIPAL = 'party-1'

// Combination blocks (Crockford-safe: no I, L, O, U).
const SLOT_COMB = 'PRSA01' // pairing slot, expects Device Class "workstation"
const SLOT_ANY = 'PRSB02' // pairing slot with NO class expectation, NO expiry
const SLOT_EXP = 'PRSX03' // pairing slot whose own expiry has passed
const PLAIN_COMB = 'NPRC04' // valid I entry that is NOT a pairing slot

const INGEST = makeKeyPair('wrc-ingest-shared')
const OPERATOR = makeKeyPair('dir-op-shared')

function slotDesignation(combination: string, pairing: Record<string, unknown>) {
  return {
    cls: 'I',
    combination,
    receiving_party: { kind: 'principal', id: PRINCIPAL },
    pairing,
  }
}

const tenantFx = buildPublisherFixture({
  publisherPart: TENANT,
  domain: 'tenant.test',
  ingestKey: INGEST,
  operatorKey: OPERATOR,
  extraEntries: [
    {
      lookupKey: SLOT_COMB,
      entryId: 'SLOTE1',
      designation: slotDesignation(SLOT_COMB, {
        slot: true,
        expected_device_class: 'workstation',
        expires_at: NOW + 3600,
      }),
    },
    {
      lookupKey: SLOT_ANY,
      entryId: 'SLOTE2',
      designation: slotDesignation(SLOT_ANY, {
        slot: true,
        expected_device_class: null,
        expires_at: null,
      }),
    },
    {
      lookupKey: SLOT_EXP,
      entryId: 'SLOTE3',
      designation: slotDesignation(SLOT_EXP, {
        slot: true,
        expected_device_class: null,
        expires_at: NOW - 10,
      }),
    },
    {
      lookupKey: PLAIN_COMB,
      entryId: 'NPENT1',
      designation: {
        cls: 'I',
        combination: PLAIN_COMB,
        receiving_party: { kind: 'principal', id: PRINCIPAL },
      },
    },
  ],
})

const otherTenantFx = buildPublisherFixture({
  publisherPart: OTHER_TENANT,
  domain: 'other.test',
  ingestKey: INGEST,
  operatorKey: OPERATOR,
  extraEntries: [
    {
      lookupKey: SLOT_ANY,
      entryId: 'SLOTE9',
      designation: slotDesignation(SLOT_ANY, {
        slot: true,
        expected_device_class: null,
        expires_at: null,
      }),
    },
  ],
})

function refOf(tenant: string, combination: string): string {
  const r = buildWrCodeReference('I', [tenant, combination])
  if (!r.ok) throw new Error(r.reason)
  return r.canonical
}

/** Declare the §XVI.8.4 single-use profile on a slot, keyed canonically. */
function declareSlot(useLimits: WrcUseLimitStore, tenant: string, combination: string, entryId: string) {
  const parsed = buildWrCodeReference('I', [tenant, combination])
  if (!parsed.ok) throw new Error(parsed.reason)
  const captured = captureWrCodeReference(parsed.canonical)
  if (!captured.ok) throw new Error(captured.reason)
  // Derive through the SAME module the pipeline uses — the test never invents a key.
  const derived = deriveEntryDesignator(
    captured,
    { cls: 'I', combination, receiving_party: { kind: 'principal', id: PRINCIPAL } },
    entryId,
  )
  if (!derived.ok) throw new Error(`fixture designator: ${derived.reason}`)
  useLimits.declare(tenant, useLimitEntryKey(derived.designator), defaultUseLimitProfile(1))
  return derived.designator
}

let devices: WrcDeviceRegistry
let useLimits: WrcUseLimitStore
let deps: WrcPairingDeps

beforeEach(() => {
  const transport = createMultiFixtureTransport([tenantFx, otherTenantFx])
  const client = new WrcResolutionClient({
    transport,
    store: new WrcResolvedRecordStore(createMemoryPersistence()),
    ingestPublicKey: INGEST.pub,
    now: () => NOW,
  })
  const directory = new WrcDirectoryClient({
    transport,
    operator: { kid: OPERATOR.kid, pub: OPERATOR.pub },
    now: () => NOW,
  })
  devices = createMemoryDeviceRegistry()
  useLimits = createMemoryUseLimitStore()
  deps = {
    gateDeps: createWrcGateDeps(client, { useLimits, now: () => NOW, directory, devices }),
    devices,
    useLimits,
    directory,
    // The tenant signs with its directory-registered root key.
    signDeviceRecord: (payload) =>
      signObject(
        { ...payload, kid: tenantFx.root.kid, sig: '' } as unknown as Record<string, unknown>,
        tenantFx.root,
      ) as unknown as WrcDeviceRecord,
    now: () => NOW,
  }
})

function presentation(overrides: Partial<WrcPairingPresentation> = {}): WrcPairingPresentation {
  return {
    raw: refOf(TENANT, SLOT_COMB),
    receiver: { party_id: PRINCIPAL },
    device: {
      key_fingerprint: 'sha256:aa11bb22',
      device_class: 'workstation',
      device_name: 'new-workstation',
    },
    requestInstanceId: 'req-1',
    ...overrides,
  }
}

describe('pairing acceptance [XVI.5.10]', () => {
  it('a valid slot pairs the device: record registered, slot consumed, DSPI created', async () => {
    const designator = declareSlot(useLimits, TENANT, SLOT_COMB, 'SLOTE1')
    const r = await acceptDevicePairing(presentation(), deps)
    expect(r.ok, r.ok ? '' : JSON.stringify(r)).toBe(true)
    if (!r.ok) return

    // §XVI.2 — the Device-Scoped Principal Identifier exists from acceptance.
    expect(r.devicePartyId).toBe(`${PRINCIPAL}:new-workstation`)
    const registered = devices.tenantDevice(TENANT, r.devicePartyId)
    expect(registered?.key_fingerprint).toBe('sha256:aa11bb22')
    expect(registered?.status).toBe('active')

    // §XVI.8.4 consume_at = acceptance: the slot is terminally consumed (P11).
    const row = useLimits.read(TENANT, useLimitEntryKey(designator))
    expect(row?.state).toBe('consumed')

    // Isolation: nothing appeared under any other establishment.
    expect(devices.tenantDevice(OTHER_TENANT, r.devicePartyId)).toBeNull()
  })

  it('a consumed slot refuses reuse — replay dies in the pipeline', async () => {
    declareSlot(useLimits, TENANT, SLOT_COMB, 'SLOTE1')
    const first = await acceptDevicePairing(presentation(), deps)
    expect(first.ok).toBe(true)

    const replay = await acceptDevicePairing(
      presentation({
        requestInstanceId: 'req-2',
        device: { key_fingerprint: 'sha256:cc33', device_class: 'workstation', device_name: 'second' },
      }),
      deps,
    )
    expect(replay.ok).toBe(false)
    if (replay.ok) return
    expect(replay.stage).toBe('pipeline')
    if (replay.stage !== 'pipeline') return
    expect(replay.refusal.reason).toBe('CONSUMED')
    // The second device never came into existence.
    expect(devices.tenantDevice(TENANT, `${PRINCIPAL}:second`)).toBeNull()
  })

  it('another principal cannot use the slot: Gate 4 NOT_FOR_YOU, slot untouched', async () => {
    const designator = declareSlot(useLimits, TENANT, SLOT_COMB, 'SLOTE1')
    const r = await acceptDevicePairing(
      presentation({ receiver: { party_id: 'party-2' } }),
      deps,
    )
    expect(r.ok).toBe(false)
    if (r.ok || r.stage !== 'pipeline') throw new Error('expected pipeline refusal')
    expect(r.refusal.gate).toBe(4)
    expect(r.refusal.reason).toBe('NOT_FOR_YOU')
    // Gate 4 precedes the claim: the slot is still ACTIVE for its principal.
    expect(useLimits.read(TENANT, useLimitEntryKey(designator))?.state).toBe('active')
  })

  it('a Device Class the slot does not expect refuses AND releases the claim', async () => {
    const designator = declareSlot(useLimits, TENANT, SLOT_COMB, 'SLOTE1')
    const r = await acceptDevicePairing(
      presentation({
        device: { key_fingerprint: 'sha256:dd44', device_class: 'phone', device_name: 'my-phone' },
      }),
      deps,
    )
    expect(r.ok).toBe(false)
    if (r.ok || r.stage !== 'acceptance') throw new Error('expected acceptance refusal')
    expect(r.reason).toBe('device_class_mismatch')

    // Failed pairing never consumes the slot: the claim reverted to ACTIVE …
    expect(useLimits.read(TENANT, useLimitEntryKey(designator))?.state).toBe('active')
    // … and the right device can still pair.
    const retry = await acceptDevicePairing(presentation({ requestInstanceId: 'req-3' }), deps)
    expect(retry.ok).toBe(true)
  })

  it('a slot past its own expiry refuses slot_expired and releases the claim', async () => {
    const designator = declareSlot(useLimits, TENANT, SLOT_EXP, 'SLOTE3')
    const r = await acceptDevicePairing(presentation({ raw: refOf(TENANT, SLOT_EXP) }), deps)
    expect(r.ok).toBe(false)
    if (r.ok || r.stage !== 'acceptance') throw new Error('expected acceptance refusal')
    expect(r.reason).toBe('slot_expired')
    expect(useLimits.read(TENANT, useLimitEntryKey(designator))?.state).toBe('active')
  })

  it('a valid I entry that is NOT a pairing slot refuses not_a_pairing_slot', async () => {
    const r = await acceptDevicePairing(presentation({ raw: refOf(TENANT, PLAIN_COMB) }), deps)
    expect(r.ok).toBe(false)
    if (r.ok || r.stage !== 'acceptance') throw new Error('expected acceptance refusal')
    expect(r.reason).toBe('not_a_pairing_slot')
    expect(devices.tenantDevice(TENANT, `${PRINCIPAL}:new-workstation`)).toBeNull()
  })

  it('a signer using a key the directory does not register fails the registration, not the trust', async () => {
    const designator = declareSlot(useLimits, TENANT, SLOT_COMB, 'SLOTE1')
    const rogue = makeKeyPair('rogue-signer')
    const r = await acceptDevicePairing(presentation(), {
      ...deps,
      signDeviceRecord: (payload) =>
        signObject(
          { ...payload, kid: rogue.kid, sig: '' } as unknown as Record<string, unknown>,
          rogue,
        ) as unknown as WrcDeviceRecord,
    })
    expect(r.ok).toBe(false)
    if (r.ok || r.stage !== 'acceptance') throw new Error('expected acceptance refusal')
    expect(r.reason).toBe('record_registration_failed')
    // Nothing consumed, nothing registered.
    expect(useLimits.read(TENANT, useLimitEntryKey(designator))?.state).toBe('active')
    expect(devices.tenantDevice(TENANT, `${PRINCIPAL}:new-workstation`)).toBeNull()
  })

  it('two racing acceptances: exactly one device pairs (§XVI.8.4 single consumer)', async () => {
    declareSlot(useLimits, TENANT, SLOT_ANY, 'SLOTE2')
    const [a, b] = await Promise.all([
      acceptDevicePairing(
        presentation({
          raw: refOf(TENANT, SLOT_ANY),
          requestInstanceId: 'race-a',
          device: { key_fingerprint: 'sha256:0a', device_class: 'laptop', device_name: 'racer-a' },
        }),
        deps,
      ),
      acceptDevicePairing(
        presentation({
          raw: refOf(TENANT, SLOT_ANY),
          requestInstanceId: 'race-b',
          device: { key_fingerprint: 'sha256:0b', device_class: 'laptop', device_name: 'racer-b' },
        }),
        deps,
      ),
    ])
    const winners = [a, b].filter((r) => r.ok)
    expect(winners).toHaveLength(1)
    // Exactly one Device Record came into existence.
    const paired = [
      devices.tenantDevice(TENANT, `${PRINCIPAL}:racer-a`),
      devices.tenantDevice(TENANT, `${PRINCIPAL}:racer-b`),
    ].filter(Boolean)
    expect(paired).toHaveLength(1)
  })

  it('the same slot code under another establishment is that establishment\'s slot alone', async () => {
    // OTHER_TENANT publishes a slot under the SAME combination block: the
    // designator keys on the namespace, so consuming one never touches the
    // other, and the record lands under the tenant in the code — only.
    declareSlot(useLimits, TENANT, SLOT_ANY, 'SLOTE2')
    declareSlot(useLimits, OTHER_TENANT, SLOT_ANY, 'SLOTE9')

    const r = await acceptDevicePairing(
      presentation({
        raw: refOf(OTHER_TENANT, SLOT_ANY),
        device: { key_fingerprint: 'sha256:ee55', device_class: 'laptop', device_name: 'other-dev' },
      }),
      {
        ...deps,
        // The OTHER tenant signs its own records.
        signDeviceRecord: (payload) =>
          signObject(
            { ...payload, kid: otherTenantFx.root.kid, sig: '' } as unknown as Record<string, unknown>,
            otherTenantFx.root,
          ) as unknown as WrcDeviceRecord,
      },
    )
    expect(r.ok, r.ok ? '' : JSON.stringify(r)).toBe(true)
    if (!r.ok) return
    expect(r.record.tenant_part).toBe(OTHER_TENANT)
    expect(devices.tenantDevice(OTHER_TENANT, r.devicePartyId)).not.toBeNull()
    expect(devices.tenantDevice(TENANT, r.devicePartyId)).toBeNull()

    // TENANT's own slot is still active and still its own.
    const tenantSlot = buildWrCodeReference('I', [TENANT, SLOT_ANY])
    if (!tenantSlot.ok) throw new Error(tenantSlot.reason)
    const still = await acceptDevicePairing(
      presentation({
        raw: tenantSlot.canonical,
        requestInstanceId: 'req-t',
        device: { key_fingerprint: 'sha256:ff66', device_class: 'laptop', device_name: 'tenant-dev' },
      }),
      deps,
    )
    expect(still.ok).toBe(true)
  })

  it('a receiver without a principal identity refuses before anything is claimed', async () => {
    const r = await acceptDevicePairing(presentation({ receiver: {} }), deps)
    expect(r.ok).toBe(false)
    if (r.ok || r.stage !== 'acceptance') throw new Error('expected acceptance refusal')
    expect(r.reason).toBe('pairing_identity_incomplete')
  })
})
