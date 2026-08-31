/**
 * Run 4 — full-chain conformance matrix (Slice 8).
 *
 * capture → Run-1 grammar → Gate 1 Syntax → Gate 2 Namespace/Directory →
 * Gate 3 canonical Entry (+ lifecycle / use-limit) → Gate 4 Self-Match
 * (+ device/principal/receiving-party) → Gate 5 Relay-Release → Gate 6
 * Capsule-Admission → final result.
 *
 * One full successful vector per class (P, I, C, SP, SI, SC, SE) against the
 * COMPLETE Run-4 dependency set (directory, device registry, relay, sealed
 * capsule, use limits), plus a targeted failure at every security boundary
 * and the structural observability proofs:
 *
 *   - Gate N+1 never executes after Gate N fails;
 *   - Gate-5 protected material is unavailable before Gate 5 passes;
 *   - Gate-6 admission data is unavailable before Gate 6 passes;
 *   - no caller can bypass canonical designation, Directory verification,
 *     the device substrate, or mark Gate 5/6 successful from outside.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildWrCodeReference, captureWrCodeReference } from '@repo/ingestion-core'
import {
  runWrCodeGatePipeline,
  WR_CODE_GATE_ORDER,
  type WrCodeGateDeps,
  type WrCodeGateInput,
  type WrCodeReceiverIdentity,
} from '../gatePipeline'
import { createWrcGateDeps } from '../gatePipelineAdapter'
import { WrcDirectoryClient } from '../namespaceDirectory'
import { createMemoryDeviceRegistry, type WrcDeviceRegistry } from '../deviceRegistry'
import { deriveEntryDesignator, useLimitEntryKey } from '../entryDesignator'
import { createMemoryRelay, principalKeyFingerprint, type WrcRelayClient } from '../relayRelease'
import { WrcResolutionClient } from '../resolutionClient'
import { WrcResolvedRecordStore, createMemoryPersistence } from '../resolvedRecordStore'
import { createMemoryUseLimitStore, type WrcUseLimitStore } from '../useLimitStore'
import {
  buildPendingCapsule,
  buildPublisherFixture,
  createMultiFixtureTransport,
  makeClaimKey,
  makeKeyPair,
  signDeviceRecord,
  signPrincipalDelegation,
} from './wrcFixtures'

const NOW = 1_754_650_100
const TENANT = 'WR7X4K' // publisher / tenant / C initiator
const RESPONDER = 'RCVPBX' // C responder organization
const P_LOCAL = '9B2M3' // the tenant's primary P entry (fixture default id)

// Combination blocks (Crockford-safe).
const I_COMB = 'PA1RS7'
const SP_COMB = 'SPC4MB'
const SI_COMB = 'DEVSE1'
const SC_COMB = 'M3K9B2'
const SE_COMB = 'SEDP01'

const INGEST = makeKeyPair('wrc-ingest-shared')
const OPERATOR = makeKeyPair('dir-op-shared')

const tenantFx = buildPublisherFixture({
  publisherPart: TENANT,
  domain: 'publisher.test',
  ingestKey: INGEST,
  operatorKey: OPERATOR,
  extraEntries: [
    {
      lookupKey: RESPONDER,
      entryId: 'CREL01',
      designation: { cls: 'C', initiator_part: TENANT, counterparty_part: RESPONDER },
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
      lookupKey: SP_COMB,
      entryId: 'SPENT1',
      designation: {
        cls: 'SP',
        combination: SP_COMB,
        receiving_party: { kind: 'principal', id: 'party-1' },
        parent: { cls: 'P', publisher_part: TENANT, entry_id: P_LOCAL },
      },
    },
    {
      lookupKey: SI_COMB,
      entryId: 'RES001',
      designation: {
        cls: 'SI',
        combination: SI_COMB,
        receiving_party: { kind: 'device', id: 'party-1:device-A' },
        parent: { cls: 'I', publisher_part: TENANT },
      },
    },
    {
      lookupKey: SC_COMB,
      entryId: 'SCENT1',
      designation: {
        cls: 'SC',
        combination: SC_COMB,
        receiving_party: { kind: 'publisher', id: RESPONDER },
        parent: { cls: 'C', publisher_part: TENANT, counterparty_part: RESPONDER },
      },
    },
    {
      lookupKey: SE_COMB,
      entryId: 'SEENT1',
      designation: {
        cls: 'SE',
        combination: SE_COMB,
        receiving_party: { kind: 'principal', id: 'party-1' },
        parent: { cls: 'P', publisher_part: TENANT, entry_id: P_LOCAL },
        session: { id: 'sess-full', not_before: null, expires_at: NOW + 3600 },
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

function refOf(cls: 'P' | 'I' | 'C' | 'SP' | 'SI' | 'SC' | 'SE', blocks: string[]): string {
  const r = buildWrCodeReference(cls, blocks)
  if (!r.ok) throw new Error(`vector build failed: ${r.reason}`)
  return r.canonical
}

const P_REF = refOf('P', [TENANT, P_LOCAL])
const I_REF = refOf('I', [TENANT, I_COMB])
const C_REF = refOf('C', [TENANT, RESPONDER])
const SP_REF = refOf('SP', [TENANT, SP_COMB])
const SI_REF = refOf('SI', [TENANT, SI_COMB])
const SC_REF = refOf('SC', [TENANT, SC_COMB])
const SE_REF = refOf('SE', [TENANT, SE_COMB])

const C_ENTRY_KEY = (() => {
  const captured = captureWrCodeReference(C_REF)
  if (!captured.ok) throw new Error(captured.reason)
  const derived = deriveEntryDesignator(
    captured,
    { cls: 'C', initiator_part: TENANT, counterparty_part: RESPONDER },
    'CREL01',
  )
  if (!derived.ok) throw new Error(derived.reason)
  return useLimitEntryKey(derived.designator)
})()

// Receivers per class row: the party the issuer bound.
const TENANT_PRINCIPAL: WrCodeReceiverIdentity = {
  party_id: 'party-1',
  device_party_id: 'party-1:device-A',
}
const RESPONDER_ORG: WrCodeReceiverIdentity = {
  publisher_part: RESPONDER,
  party_id: 'party-9',
  sso_email: 'ceo@responder.test',
}

const initiatorPrincipal = makeKeyPair('initiator-principal-key')
const claimKey = makeClaimKey('responder-principal-key')
const DELEGATION = signPrincipalDelegation(responderFx, {
  principalPartyId: 'party-9',
  ssoEmail: 'ceo@responder.test',
  principalPub: claimKey.principal_pub,
})

let relay: WrcRelayClient
let devices: WrcDeviceRegistry
let useLimits: WrcUseLimitStore
let deps: WrCodeGateDeps

beforeEach(() => {
  const transport = createMultiFixtureTransport([tenantFx, responderFx])
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
  relay = createMemoryRelay({
    directoryKeys: async (part) => {
      const r = await directory.getVerifiedRecord(part)
      return r.ok ? r.record.keys : null
    },
    now: () => NOW,
  })
  devices = createMemoryDeviceRegistry()
  devices.registerTenantDevice(
    signDeviceRecord(tenantFx, {
      principalPartyId: 'party-1',
      devicePartyId: 'party-1:device-A',
      deviceName: 'device-A',
      deviceClass: 'workstation',
    }),
  )
  useLimits = createMemoryUseLimitStore()
  deps = createWrcGateDeps(client, {
    now: () => NOW,
    directory,
    devices,
    relay,
    useLimits,
    claimIdentity: {
      principal_pub: claimKey.principal_pub,
      delegation: DELEGATION,
      sign: claimKey.sign,
    },
    admission: { decryptKey: responderFx.encryption.privateKey },
  })
})

function depositCapsule() {
  const { capsule } = buildPendingCapsule({
    initiator: tenantFx,
    initiatorPrincipal: { partyId: 'party-1', email: 'sales@publisher.test', key: initiatorPrincipal },
    recipient: { partyId: 'party-9', email: 'ceo@responder.test', encryptionPub: responderFx.encryption.pub },
    capsuleId: 'cap-full',
    requestInstanceId: 'req-full',
    expiresAt: NOW + 3600,
  })
  relay.deposit({
    type: 'wrc/relay-envelope',
    capsule_id: 'cap-full',
    publisher_part: TENANT,
    entry_key: C_ENTRY_KEY,
    recipient: {
      party_id: 'party-9',
      publisher_part: RESPONDER,
      principal_key_fingerprint: principalKeyFingerprint(claimKey.principal_pub),
    },
    expires_at: NOW + 3600,
    status: 'available',
    capsule: capsule as unknown as Record<string, unknown>,
  })
}

// ── One full successful vector per class ──────────────────────────────────────

describe('full-chain success matrix: every class through all six gates', () => {
  const rows: Array<{ cls: string; raw: string; receiver: WrCodeReceiverIdentity }> = [
    { cls: 'P', raw: P_REF, receiver: TENANT_PRINCIPAL },
    { cls: 'I', raw: I_REF, receiver: TENANT_PRINCIPAL },
    { cls: 'C', raw: C_REF, receiver: RESPONDER_ORG },
    { cls: 'SP', raw: SP_REF, receiver: TENANT_PRINCIPAL },
    { cls: 'SI', raw: SI_REF, receiver: TENANT_PRINCIPAL },
    { cls: 'SC', raw: SC_REF, receiver: RESPONDER_ORG },
    { cls: 'SE', raw: SE_REF, receiver: TENANT_PRINCIPAL },
  ]

  for (const row of rows) {
    it(`${row.cls}: admits with all six gates passed in normative order`, async () => {
      if (row.cls === 'C') depositCapsule()
      const r = await runWrCodeGatePipeline({ raw: row.raw, receiver: row.receiver }, deps)
      expect(r.ok, r.ok ? '' : `${r.reason}: ${r.detail}`).toBe(true)
      if (!r.ok) return
      expect(r.gatesPassed).toEqual([...WR_CODE_GATE_ORDER])
      expect(r.reference.cls).toBe(row.cls)
      // The C row additionally proves the recipient-bound relay material.
      if (row.cls === 'C') expect(r.released.capsule).not.toBeNull()
    })
  }
})

// ── Targeted failure at every boundary ────────────────────────────────────────

describe('one deterministic failure per security boundary', () => {
  it('Gate 1 — a corrupted check character refuses locally, on the capture-error path', async () => {
    const bad = P_REF.slice(0, -1) + (P_REF.endsWith('A') ? 'B' : 'A')
    const r = await runWrCodeGatePipeline({ raw: bad, receiver: TENANT_PRINCIPAL }, deps)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.gate).toBe(1)
    expect(r.captureError).toBe(true)
    expect(r.gatesPassed).toEqual([])
  })

  it('Gate 2 — an unknown Publisher Identifier refuses uniformly', async () => {
    const r = await runWrCodeGatePipeline(
      { raw: refOf('P', ['ZZPQB7', P_LOCAL]), receiver: TENANT_PRINCIPAL },
      deps,
    )
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.gate).toBe(2)
    expect(r.reason).toBe('namespace_unknown_identifier')
    expect(r.captureError).toBe(true)
  })

  it('Gate 3 — an unknown entry refuses after the namespace verified', async () => {
    const r = await runWrCodeGatePipeline(
      { raw: refOf('P', [TENANT, 'NP993']), receiver: TENANT_PRINCIPAL },
      deps,
    )
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.gate).toBe(3)
    expect(r.gatesPassed).toEqual(['syntax', 'namespace'])
  })

  it('Gate 4 — a reference addressed to someone else refuses NOT_FOR_YOU', async () => {
    const r = await runWrCodeGatePipeline(
      { raw: I_REF, receiver: { party_id: 'party-2' } },
      deps,
    )
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.gate).toBe(4)
    expect(r.reason).toBe('NOT_FOR_YOU')
  })

  it('Gate 5 — a withdrawn capsule refuses at release', async () => {
    depositCapsule()
    relay.setStatus('cap-full', 'withdrawn')
    const r = await runWrCodeGatePipeline({ raw: C_REF, receiver: RESPONDER_ORG }, deps)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.gate).toBe(5)
    expect(r.detail).toContain('capsule_withdrawn')
  })

  it('Gate 6 — an expired capsule refuses at admission after a successful release', async () => {
    const { capsule } = buildPendingCapsule({
      initiator: tenantFx,
      initiatorPrincipal: { partyId: 'party-1', email: 'sales@publisher.test', key: initiatorPrincipal },
      recipient: { partyId: 'party-9', email: 'ceo@responder.test', encryptionPub: responderFx.encryption.pub },
      capsuleId: 'cap-full',
      requestInstanceId: 'req-full',
      expiresAt: NOW - 1, // capsule itself expired; the relay envelope is not
    })
    relay.deposit({
      type: 'wrc/relay-envelope',
      capsule_id: 'cap-full',
      publisher_part: TENANT,
      entry_key: C_ENTRY_KEY,
      recipient: {
        party_id: 'party-9',
        publisher_part: RESPONDER,
        principal_key_fingerprint: principalKeyFingerprint(claimKey.principal_pub),
      },
      expires_at: NOW + 3600,
      status: 'available',
      capsule: capsule as unknown as Record<string, unknown>,
    })
    const r = await runWrCodeGatePipeline({ raw: C_REF, receiver: RESPONDER_ORG }, deps)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.gate).toBe(6)
    expect(r.gatesPassed).toEqual(['syntax', 'namespace', 'entry', 'self_match', 'relay_release'])
  })
})

// ── Boundary observability ────────────────────────────────────────────────────

describe('boundary observability: no gate is reachable past a failed one', () => {
  function spiedDeps() {
    const spies = {
      verifyNamespace: vi.fn(deps.verifyNamespace.bind(deps)),
      verifyEntry: vi.fn(deps.verifyEntry.bind(deps)),
      releaseMaterial: vi.fn(deps.releaseMaterial.bind(deps)),
      admitCapsule: vi.fn(deps.admitCapsule.bind(deps)),
    }
    return { deps: { ...deps, ...spies }, spies }
  }

  it('a Gate-1 failure consults NOTHING networked', async () => {
    const { deps: d, spies } = spiedDeps()
    await runWrCodeGatePipeline({ raw: 'P-NOT-A-CODE', receiver: TENANT_PRINCIPAL }, d)
    expect(spies.verifyNamespace).not.toHaveBeenCalled()
    expect(spies.verifyEntry).not.toHaveBeenCalled()
    expect(spies.releaseMaterial).not.toHaveBeenCalled()
    expect(spies.admitCapsule).not.toHaveBeenCalled()
  })

  it('a Gate-3 failure never reaches release or admission', async () => {
    const { deps: d, spies } = spiedDeps()
    const r = await runWrCodeGatePipeline(
      { raw: refOf('P', [TENANT, 'NP993']), receiver: TENANT_PRINCIPAL },
      d,
    )
    expect(r.ok).toBe(false)
    expect(spies.verifyEntry).toHaveBeenCalled()
    expect(spies.releaseMaterial).not.toHaveBeenCalled()
    expect(spies.admitCapsule).not.toHaveBeenCalled()
  })

  it('a Gate-4 failure never reaches the relay', async () => {
    depositCapsule()
    const releaseSpy = vi.spyOn(relay, 'release')
    const r = await runWrCodeGatePipeline(
      { raw: C_REF, receiver: { publisher_part: 'ZZPQB7', party_id: 'party-9' } },
      deps,
    )
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.gate).toBe(4)
    expect(releaseSpy).not.toHaveBeenCalled()
  })

  it('a refusal carries NO released or admitted material, at any gate', async () => {
    depositCapsule()
    relay.setStatus('cap-full', 'withdrawn')
    const r = await runWrCodeGatePipeline({ raw: C_REF, receiver: RESPONDER_ORG }, deps)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect('released' in r).toBe(false)
    expect('material' in r).toBe(false)
    expect('designator' in r).toBe(false)
  })

  it('the relay exposes no capsule content outside release', () => {
    depositCapsule()
    // The entire observable surface without a passing claim: presence + id.
    expect(relay.hasEnvelope(TENANT, C_ENTRY_KEY)).toBe(true)
    expect(relay.capsuleIdFor(TENANT, C_ENTRY_KEY)).toBe('cap-full')
    expect(Object.keys(relay).sort()).toEqual(
      ['capsuleIdFor', 'deposit', 'hasEnvelope', 'release', 'setStatus'].sort(),
    )
  })
})

describe('boundary observability: callers cannot inject trusted state', () => {
  it('caller-supplied designator/released/material fields on the input are ignored', async () => {
    const forged = {
      raw: I_REF,
      receiver: { party_id: 'party-2' }, // NOT the bound principal
      // A hostile caller smuggles pre-approved objects into the input:
      designator: { cls: 'I', publisher_part: TENANT, receiving_party: { kind: 'principal', id: 'party-2' } },
      released: { evp: {}, capsule: {} },
      material: { entry_id: 'CTX001' },
      gatesPassed: [...WR_CODE_GATE_ORDER],
    } as unknown as WrCodeGateInput
    const r = await runWrCodeGatePipeline(forged, deps)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.gate).toBe(4)
    expect(r.reason).toBe('NOT_FOR_YOU')
  })

  it('without a directory there is NO namespace trust path (no registry fallback)', async () => {
    const transport = createMultiFixtureTransport([tenantFx, responderFx])
    const client = new WrcResolutionClient({
      transport,
      store: new WrcResolvedRecordStore(createMemoryPersistence()),
      ingestPublicKey: INGEST.pub,
      now: () => NOW,
    })
    const undirected = createWrcGateDeps(client, { now: () => NOW })
    const r = await runWrCodeGatePipeline({ raw: P_REF, receiver: TENANT_PRINCIPAL }, undirected)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.gate).toBe(2)
    expect(r.detail).toContain('directory_not_configured')
  })

  it('a device-bound reference with no registration substrate refuses — nothing to inject', async () => {
    const transport = createMultiFixtureTransport([tenantFx, responderFx])
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
    // Same deps, but NO device registry: the SI device row must fail closed.
    const deviceless = createWrcGateDeps(client, { now: () => NOW, directory })
    const r = await runWrCodeGatePipeline({ raw: SI_REF, receiver: TENANT_PRINCIPAL }, deviceless)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.gate).toBe(4)
    expect(r.reason).toBe('device_binding_unverified')
  })

  it('a lying resolver expansion cannot substitute canonical designation', async () => {
    // The tenant serves the SC entry under a WRONG combination claim: the
    // pipeline derives designation from the parsed reference and refuses.
    const lyingFx = buildPublisherFixture({
      publisherPart: TENANT,
      domain: 'publisher.test',
      ingestKey: INGEST,
      operatorKey: OPERATOR,
      extraEntries: [
        {
          lookupKey: SC_COMB,
          entryId: 'SCENT1',
          designation: {
            cls: 'SC',
            combination: 'XXXXXX',
            receiving_party: { kind: 'publisher', id: RESPONDER },
            parent: { cls: 'C', publisher_part: TENANT, counterparty_part: RESPONDER },
          },
        },
      ],
    })
    const transport = createMultiFixtureTransport([lyingFx, responderFx])
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
    const lyingDeps = createWrcGateDeps(client, { now: () => NOW, directory })
    const r = await runWrCodeGatePipeline({ raw: SC_REF, receiver: RESPONDER_ORG }, lyingDeps)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.gate).toBe(3)
    expect(r.reason).toBe('designation_mismatch')
  })
})
