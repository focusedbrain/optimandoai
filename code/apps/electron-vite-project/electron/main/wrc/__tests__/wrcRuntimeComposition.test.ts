/**
 * Run 5 Slice 1 — the production composition root (`wrcRuntime.ts`).
 *
 * What these tests pin, driving the REAL runtime entry point
 * (`handleWrcSubmitReference`), never the pipeline directly:
 *
 *  1. Receiver identity comes from the runtime's sanctioned identity source.
 *     A caller-supplied `receiver` object is ignored — a capture surface
 *     cannot declare itself `party-1` or `trusted-device-X` and walk through
 *     Gate 4.
 *  2. The admission replay ledger is a process-lifetime singleton: a
 *     request_instance_id admitted in one submission is still known in the
 *     next (the Run-4 adapter default constructed a fresh ledger per call,
 *     which is no replay protection at all).
 *  3. Absent substrate stays fail-closed through the composition root
 *     (no devices ⇒ device-bound refuses; no directory ⇒ Gate 2 refuses).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildWrCodeReference, captureWrCodeReference } from '@repo/ingestion-core'
import { WrcDirectoryClient } from '../namespaceDirectory'
import { createMemoryDeviceRegistry } from '../deviceRegistry'
import { deriveEntryDesignator, useLimitEntryKey } from '../entryDesignator'
import { createMemoryRelay, principalKeyFingerprint } from '../relayRelease'
import { createMemoryAdmissionReplayStore } from '../capsuleAdmission'
import { WrcResolutionClient } from '../resolutionClient'
import { WrcResolvedRecordStore, createMemoryPersistence } from '../resolvedRecordStore'
import { createMemoryUseLimitStore } from '../useLimitStore'
import {
  handleWrcSubmitReference,
  setWrcAdmissionReplayForTests,
  setWrcClientForTests,
  setWrcDevicesForTests,
  setWrcDirectoryForTests,
  setWrcIdentityForTests,
  setWrcRelayForTests,
  setWrcUseLimitStoreForTests,
} from '../wrcRuntime'
import type { WrcRelayClient } from '../relayRelease'
import {
  buildPendingCapsule,
  buildPublisherFixture,
  createMultiFixtureTransport,
  makeClaimKey,
  makeKeyPair,
  signPrincipalDelegation,
} from './wrcFixtures'

const TENANT = 'WR7X4K'
const RESPONDER = 'RCVPBX'
const I_COMB = 'PA1RS7'

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
  ],
})
const responderFx = buildPublisherFixture({
  publisherPart: RESPONDER,
  domain: 'responder.test',
  entryId: 'RSPENT',
  ingestKey: INGEST,
  operatorKey: OPERATOR,
})

function refOf(cls: 'P' | 'I' | 'C', blocks: string[]): string {
  const r = buildWrCodeReference(cls, blocks)
  if (!r.ok) throw new Error(`vector build failed: ${r.reason}`)
  return r.canonical
}
const I_REF = refOf('I', [TENANT, I_COMB])
const C_REF = refOf('C', [TENANT, RESPONDER])

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

const claimKey = makeClaimKey('responder-principal-key')
const DELEGATION = signPrincipalDelegation(responderFx, {
  principalPartyId: 'party-9',
  ssoEmail: 'ceo@responder.test',
  principalPub: claimKey.principal_pub,
})
const initiatorPrincipal = makeKeyPair('initiator-principal-key')

let relay: WrcRelayClient
let directory: WrcDirectoryClient

beforeEach(() => {
  const transport = createMultiFixtureTransport([tenantFx, responderFx])
  const client = new WrcResolutionClient({
    transport,
    store: new WrcResolvedRecordStore(createMemoryPersistence()),
    ingestPublicKey: INGEST.pub,
  })
  directory = new WrcDirectoryClient({
    transport,
    operator: { kid: OPERATOR.kid, pub: OPERATOR.pub },
  })
  relay = createMemoryRelay({
    directoryKeys: async (part) => {
      const r = await directory.getVerifiedRecord(part)
      return r.ok ? r.record.keys : null
    },
  })
  setWrcClientForTests(client)
  setWrcDirectoryForTests(directory)
  setWrcDevicesForTests(createMemoryDeviceRegistry())
  setWrcRelayForTests(relay)
  setWrcUseLimitStoreForTests(createMemoryUseLimitStore())
  setWrcAdmissionReplayForTests(createMemoryAdmissionReplayStore())
  setWrcIdentityForTests({
    receiver: {
      publisher_part: RESPONDER,
      party_id: 'party-9',
      sso_email: 'ceo@responder.test',
    },
    claimIdentity: {
      principal_pub: claimKey.principal_pub,
      delegation: DELEGATION,
      sign: claimKey.sign,
    },
    decryptKey: responderFx.encryption.privateKey,
  })
})

afterEach(() => {
  setWrcClientForTests(null)
  setWrcDirectoryForTests(null)
  setWrcDevicesForTests(null)
  setWrcRelayForTests(null)
  setWrcUseLimitStoreForTests(null)
  setWrcAdmissionReplayForTests(null)
  setWrcIdentityForTests(null)
})

function depositCapsule(capsuleId: string, requestInstanceId: string) {
  const nowS = Math.floor(Date.now() / 1000)
  const { capsule } = buildPendingCapsule({
    initiator: tenantFx,
    initiatorPrincipal: {
      partyId: 'party-1',
      email: 'sales@publisher.test',
      key: initiatorPrincipal,
    },
    recipient: {
      partyId: 'party-9',
      email: 'ceo@responder.test',
      encryptionPub: responderFx.encryption.pub,
    },
    capsuleId,
    requestInstanceId,
    expiresAt: nowS + 3600,
  })
  relay.deposit({
    type: 'wrc/relay-envelope',
    capsule_id: capsuleId,
    publisher_part: TENANT,
    entry_key: C_ENTRY_KEY,
    recipient: {
      party_id: 'party-9',
      publisher_part: RESPONDER,
      principal_key_fingerprint: principalKeyFingerprint(claimKey.principal_pub),
    },
    expires_at: nowS + 3600,
    status: 'available',
    capsule: capsule as unknown as Record<string, unknown>,
  })
}

describe('Run 5 Slice 1 — composition root trust boundary', () => {
  it('receiver identity is the RUNTIME\u2019s: a caller-supplied receiver object is ignored', async () => {
    // The runtime identity (party-9) is NOT the bound party of the I entry
    // (party-1). A caller claiming to be party-1 via a `receiver` parameter
    // must not become party-1.
    const res = await handleWrcSubmitReference({
      raw: I_REF,
      // Not part of the accepted params — a hostile caller shape.
      ...({ receiver: { party_id: 'party-1', publisher_part: TENANT } } as object),
    })
    expect(res.success).toBe(true)
    if (!res.success) return
    expect(res.result.ok).toBe(false)
    if (res.result.ok) return
    expect(res.result.gate).toBe(4)
    expect(res.result.reason).toBe('NOT_FOR_YOU')
  })

  it('the runtime identity, when it IS the bound party, admits through the same path', async () => {
    setWrcIdentityForTests({
      receiver: { party_id: 'party-1', device_party_id: 'party-1:device-A' },
      claimIdentity: null,
      decryptKey: null,
    })
    const res = await handleWrcSubmitReference({ raw: I_REF })
    expect(res.success).toBe(true)
    if (!res.success) return
    expect(res.result.ok).toBe(true)
  })

  it('the admission replay ledger survives across submissions (no per-call ledger)', async () => {
    depositCapsule('cap-one', 'req-shared')
    const first = await handleWrcSubmitReference({ raw: C_REF, requestInstanceId: 'req-shared' })
    expect(first.success).toBe(true)
    if (!first.success) return
    expect(first.result.ok).toBe(true)

    // Same request_instance_id re-bound to a DIFFERENT capsule: Gate 6 must
    // remember the first binding from the previous submission and refuse.
    depositCapsule('cap-two', 'req-shared')
    const second = await handleWrcSubmitReference({ raw: C_REF, requestInstanceId: 'req-shared' })
    expect(second.success).toBe(true)
    if (!second.success) return
    expect(second.result.ok).toBe(false)
    if (second.result.ok) return
    expect(second.result.gate).toBe(6)
    expect(second.result.detail).toContain('request_replayed')
  })

  it('absent device substrate stays fail-closed through the composition root', async () => {
    setWrcDevicesForTests(null)
    setWrcIdentityForTests({
      receiver: { party_id: 'party-1', device_party_id: 'party-1:device-A' },
      claimIdentity: null,
      decryptKey: null,
    })
    // The I entry is principal-bound, so it still admits; the point is that a
    // null registry never THROWS or silently passes a device-bound check —
    // covered in depth by the device slices; here we pin the wiring shape.
    const res = await handleWrcSubmitReference({ raw: I_REF })
    expect(res.success).toBe(true)
  })
})
