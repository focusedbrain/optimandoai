/**
 * Run 4 — §XVI.13.7 Device Pass / Registered Counterpart Device, end to end.
 *
 * The Run-3 Gate-4 decision (device-granularity match, NOT_FOR_THIS_DEVICE
 * for siblings) gets its authoritative substrate here: an SC bound to a
 * device admits ONLY when the initiator holds a valid pass for exactly that
 * device under exactly this C relationship, chained to the responder
 * tenant's directory-registered signature, current in generation, unexpired,
 * and not withdrawn. Every leg has a refusing vector.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { buildWrCodeReference } from '@repo/ingestion-core'
import { runWrCodeGatePipeline, type WrCodeReceiverIdentity } from '../gatePipeline'
import { createWrcGateDeps } from '../gatePipelineAdapter'
import { WrcDirectoryClient } from '../namespaceDirectory'
import {
  createMemoryDeviceRegistry,
  verifyDevicePass,
  type WrcDeviceRegistry,
} from '../deviceRegistry'
import { WrcResolutionClient } from '../resolutionClient'
import { WrcResolvedRecordStore, createMemoryPersistence } from '../resolvedRecordStore'
import {
  buildDevicePass,
  buildPublisherFixture,
  createMultiFixtureTransport,
  makeKeyPair,
  signDeviceRecord,
} from './wrcFixtures'

const NOW = 1_754_650_100
const INITIATOR = 'WR7X4K'
const RESPONDER = 'RCVPBX'
const OTHER_ORG = 'ZZPQB7'
const DEVICE = 'party-9:device-X'
const SIBLING = 'party-9:device-Y'

const SC_DEV = 'SCDEV1' // SC bound to the responder's registered device

const INGEST = makeKeyPair('wrc-ingest-shared')
const OPERATOR = makeKeyPair('dir-op-shared')

const initiatorFx = buildPublisherFixture({
  publisherPart: INITIATOR,
  domain: 'publisher.test',
  ingestKey: INGEST,
  operatorKey: OPERATOR,
  extraEntries: [
    {
      lookupKey: RESPONDER,
      entryId: 'CREL01',
      designation: { cls: 'C', initiator_part: INITIATOR, counterparty_part: RESPONDER },
    },
    {
      lookupKey: SC_DEV,
      entryId: 'SCDEVE',
      designation: {
        cls: 'SC',
        combination: SC_DEV,
        receiving_party: { kind: 'device', id: DEVICE },
        parent: { cls: 'C', publisher_part: INITIATOR, counterparty_part: RESPONDER },
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
})

const otherOrgFx = buildPublisherFixture({
  publisherPart: OTHER_ORG,
  domain: 'other.test',
  entryId: 'ZZZENT',
  ingestKey: INGEST,
  operatorKey: OPERATOR,
})

const SC_REF = (() => {
  const r = buildWrCodeReference('SC', [INITIATOR, SC_DEV])
  if (!r.ok) throw new Error(r.reason)
  return r.canonical
})()

/** The receiver IS the responder's registered device. */
const RECEIVER: WrCodeReceiverIdentity = {
  publisher_part: RESPONDER,
  party_id: 'party-9',
  device_party_id: DEVICE,
}

/** The responder tenant's signed record for the device — the pass's payload. */
function deviceRecord(overrides: Parameters<typeof signDeviceRecord>[1] = {
  principalPartyId: 'party-9',
  devicePartyId: DEVICE,
  deviceName: 'ceo-laptop',
  deviceClass: 'laptop',
}) {
  return signDeviceRecord(responderFx, overrides)
}

let devices: WrcDeviceRegistry
let deps: ReturnType<typeof createWrcGateDeps>

beforeEach(() => {
  const transport = createMultiFixtureTransport([initiatorFx, responderFx, otherOrgFx])
  const client = new WrcResolutionClient({
    transport,
    store: new WrcResolvedRecordStore(createMemoryPersistence()),
    ingestPublicKey: INGEST.pub,
    now: () => NOW,
  })
  devices = createMemoryDeviceRegistry()
  deps = createWrcGateDeps(client, {
    now: () => NOW,
    directory: new WrcDirectoryClient({
      transport,
      operator: { kid: OPERATOR.kid, pub: OPERATOR.pub },
      now: () => NOW,
    }),
    devices,
  })
})

function registerValidPass() {
  const record = deviceRecord()
  devices.registerTenantDevice(record)
  devices.registerCounterpartPass(
    buildDevicePass(record, {
      cInitiatorPart: INITIATOR,
      cResponderPart: RESPONDER,
      expiresAt: NOW + 86_400,
    }),
  )
}

async function refusalDetail() {
  const r = await runWrCodeGatePipeline({ raw: SC_REF, receiver: RECEIVER }, deps)
  expect(r.ok).toBe(false)
  if (r.ok) throw new Error('expected refusal')
  return r
}

describe('device-bound SC through the pipeline [XVI.13.7]', () => {
  it('a valid Registered Counterpart Device admits end to end', async () => {
    registerValidPass()
    const r = await runWrCodeGatePipeline({ raw: SC_REF, receiver: RECEIVER }, deps)
    expect(r.ok, r.ok ? '' : `${r.reason}: ${r.detail}`).toBe(true)
    if (!r.ok) return
    expect(r.designator.receiving_party).toEqual({ kind: 'device', id: DEVICE })
  })

  it('a sibling device of the same principal stays NOT_FOR_THIS_DEVICE', async () => {
    registerValidPass()
    const r = await runWrCodeGatePipeline(
      { raw: SC_REF, receiver: { ...RECEIVER, device_party_id: SIBLING } },
      deps,
    )
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.gate).toBe(4)
    expect(r.reason).toBe('NOT_FOR_THIS_DEVICE')
  })

  it('an UNREGISTERED device refuses: identifier match alone never authorizes', async () => {
    // No pass at all — the receiver's own identifier equals the constituent,
    // but nothing stands behind the binding.
    const r = await refusalDetail()
    expect(r.gate).toBe(4)
    expect(r.reason).toBe('device_binding_unverified')
    expect(r.detail).toContain('pass_missing')
  })

  it('a pass registered under ANOTHER C relationship confers nothing here', async () => {
    const record = deviceRecord()
    devices.registerTenantDevice(record)
    // Valid pass — but bound to OTHER_ORG↔RESPONDER, not INITIATOR↔RESPONDER.
    devices.registerCounterpartPass(
      buildDevicePass(record, {
        cInitiatorPart: OTHER_ORG,
        cResponderPart: RESPONDER,
        expiresAt: NOW + 86_400,
      }),
    )
    const r = await refusalDetail()
    expect(r.reason).toBe('device_binding_unverified')
    expect(r.detail).toContain('pass_missing')
  })

  it('a record signed by a key the responder directory does not register refuses', async () => {
    const rogue = makeKeyPair('rogue-tenant-key')
    const record = signDeviceRecord(
      responderFx,
      {
        principalPartyId: 'party-9',
        devicePartyId: DEVICE,
        deviceName: 'ceo-laptop',
        deviceClass: 'laptop',
      },
      rogue,
    )
    devices.registerCounterpartPass(
      buildDevicePass(record, {
        cInitiatorPart: INITIATOR,
        cResponderPart: RESPONDER,
        expiresAt: NOW + 86_400,
      }),
    )
    const r = await refusalDetail()
    expect(r.detail).toContain('record_sig_invalid')
  })

  it('an expired pass refuses', async () => {
    const record = deviceRecord()
    devices.registerTenantDevice(record)
    devices.registerCounterpartPass(
      buildDevicePass(record, {
        cInitiatorPart: INITIATOR,
        cResponderPart: RESPONDER,
        expiresAt: NOW - 1,
      }),
    )
    const r = await refusalDetail()
    expect(r.detail).toContain('pass_expired')
  })

  it('a withdrawn pass refuses without revoking the device', async () => {
    registerValidPass()
    devices.withdrawCounterpartPass(INITIATOR, RESPONDER, DEVICE)
    const r = await refusalDetail()
    expect(r.detail).toContain('pass_withdrawn')
    // The tenant record itself is untouched.
    expect(devices.tenantDevice(RESPONDER, DEVICE)?.status).toBe('active')
  })

  it('tenant revocation invalidates the pass through the generation check', async () => {
    registerValidPass()
    devices.revokeTenantDevice(RESPONDER, DEVICE)
    const r = await refusalDetail()
    expect(r.detail).toContain('record_revoked')
  })

  it('a stale-generation pass refuses after the tenant re-issues the record', async () => {
    registerValidPass()
    // Tenant re-issues (e.g. rename): generation bumps, old pass is stale.
    devices.registerTenantDevice(
      deviceRecord({
        principalPartyId: 'party-9',
        devicePartyId: DEVICE,
        deviceName: 'ceo-laptop-renamed',
        deviceClass: 'laptop',
        generation: 2,
      }),
    )
    const r = await refusalDetail()
    expect(r.detail).toContain('record_generation_stale')
  })
})

describe('verifyDevicePass unit legs [XVI.13.7]', () => {
  const record = deviceRecord()
  const keys = [{ kid: responderFx.root.kid, pub: responderFx.root.pub }]
  const base = {
    cInitiatorPart: INITIATOR,
    cResponderPart: RESPONDER,
    expectedDevicePartyId: DEVICE,
    tenantKeys: keys,
    currentTenantRecord: null,
    nowS: NOW,
  }

  it('wrong responder in the pass is a wrong establishment, checked FIRST', () => {
    const pass = buildDevicePass(record, {
      cInitiatorPart: INITIATOR,
      cResponderPart: OTHER_ORG,
      expiresAt: NOW - 1, // ALSO expired — establishment binding must win
    })
    const v = verifyDevicePass({ ...base, pass })
    expect(v.ok).toBe(false)
    if (v.ok) return
    expect(v.leg).toBe('wrong_establishment')
  })

  it('a record from a foreign tenant refuses even under the right pair', () => {
    const foreign = signDeviceRecord(otherOrgFx, {
      principalPartyId: 'party-9',
      devicePartyId: DEVICE,
      deviceName: 'ceo-laptop',
      deviceClass: 'laptop',
    })
    const pass = buildDevicePass(foreign, {
      cInitiatorPart: INITIATOR,
      cResponderPart: RESPONDER,
      expiresAt: NOW + 60,
    })
    const v = verifyDevicePass({ ...base, pass })
    expect(v.ok).toBe(false)
    if (v.ok) return
    expect(v.leg).toBe('wrong_tenant')
  })

  it('a pass never extends to a second device', () => {
    const pass = buildDevicePass(record, {
      cInitiatorPart: INITIATOR,
      cResponderPart: RESPONDER,
      expiresAt: NOW + 60,
    })
    const v = verifyDevicePass({ ...base, pass, expectedDevicePartyId: SIBLING })
    expect(v.ok).toBe(false)
    if (v.ok) return
    expect(v.leg).toBe('device_mismatch')
  })
})
