/**
 * Run 5 Slice 11 — the MANDATORY restart / crash / concurrency matrix.
 *
 * One dedicated suite, against the real native security DB, walking every
 * scenario the Run-5 order names. Restart is always modeled the same way:
 * close the handle, reopen the same file, rebuild every store/client —
 * nothing in-process survives between the halves except the file. The
 * per-slice suites prove each subsystem in depth; THIS suite pins the
 * cross-cutting durability contract in one place.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { buildWrCodeReference, captureWrCodeReference } from '@repo/ingestion-core'
import { runWrCodeGatePipeline, type WrCodeGateDeps } from '../gatePipeline'
import { createWrcGateDeps } from '../gatePipelineAdapter'
import { WrcDirectoryClient } from '../namespaceDirectory'
import { createDbDeviceRegistry, type WrcDeviceRegistry } from '../deviceRegistry'
import { deriveEntryDesignator, useLimitEntryKey } from '../entryDesignator'
import {
  createDbRelay,
  principalKeyFingerprint,
  type WrcRelayClient,
  type WrcRelayEnvelope,
  type WrcReleaseClaim,
} from '../relayRelease'
import { createDbAdmissionReplayStore, verifyCapsuleAdmission } from '../capsuleAdmission'
import { acceptDevicePairing, type WrcPairingDeps, type WrcPairingPresentation } from '../pairingSlots'
import { WrcResolutionClient } from '../resolutionClient'
import { WrcResolvedRecordStore, createMemoryPersistence } from '../resolvedRecordStore'
import { createDbUseLimitStore, defaultUseLimitProfile, type WrcUseLimitStore } from '../useLimitStore'
import {
  createDbDirectoryGenerationFloorStore,
  openWrcSecurityDb,
  type WrcSecurityDb,
} from '../wrcSecurityDb'
import {
  buildPendingCapsule,
  buildPublisherFixture,
  createFixtureTransport,
  createMultiFixtureTransport,
  makeClaimKey,
  makeKeyPair,
  signDirectoryRecord,
  signObject,
  signPrincipalDelegation,
  type WrcPublisherFixture,
} from './wrcFixtures'
import type { WrcDeviceRecord } from '../deviceRegistry'

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

const NOW = 1_754_650_100
const TENANT = 'WR7X4K'
const RESPONDER = 'RCVPBX'
const PRINCIPAL = 'party-1'
const SLOT_COMB = 'PRSA01'
const SI_COMB = 'DEVSE1'
const DSPI = `${PRINCIPAL}:new-workstation`

const INGEST = makeKeyPair('wrc-ingest-shared')
const OPERATOR = makeKeyPair('dir-op-shared')

const tenantFx = buildPublisherFixture({
  publisherPart: TENANT,
  domain: 'tenant.test',
  ingestKey: INGEST,
  operatorKey: OPERATOR,
  extraEntries: [
    {
      lookupKey: SLOT_COMB,
      entryId: 'SLOTE1',
      designation: {
        cls: 'I',
        combination: SLOT_COMB,
        receiving_party: { kind: 'principal', id: PRINCIPAL },
        pairing: { slot: true, expected_device_class: 'workstation', expires_at: NOW + 3600 },
      },
    },
    {
      lookupKey: SI_COMB,
      entryId: 'RES001',
      designation: {
        cls: 'SI',
        combination: SI_COMB,
        receiving_party: { kind: 'device', id: DSPI },
        parent: { cls: 'I', publisher_part: TENANT },
      },
    },
    {
      lookupKey: RESPONDER,
      entryId: 'CREL01',
      designation: { cls: 'C', initiator_part: TENANT, counterparty_part: RESPONDER },
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

const claimKey = makeClaimKey('responder-principal-key')
const DELEGATION = signPrincipalDelegation(responderFx, {
  principalPartyId: 'party-9',
  ssoEmail: 'ceo@responder.test',
  principalPub: claimKey.principal_pub,
})
const initiatorPrincipal = makeKeyPair('initiator-principal-key')

function refOf(cls: 'I' | 'C' | 'SI', blocks: string[]): string {
  const r = buildWrCodeReference(cls, blocks)
  if (!r.ok) throw new Error(r.reason)
  return r.canonical
}
const SLOT_REF = refOf('I', [TENANT, SLOT_COMB])
const SI_REF = refOf('SI', [TENANT, SI_COMB])
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

const SLOT_DESIGNATOR = (() => {
  const captured = captureWrCodeReference(SLOT_REF)
  if (!captured.ok) throw new Error(captured.reason)
  const derived = deriveEntryDesignator(
    captured,
    { cls: 'I', combination: SLOT_COMB, receiving_party: { kind: 'principal', id: PRINCIPAL } },
    'SLOTE1',
  )
  if (!derived.ok) throw new Error(derived.reason)
  return derived.designator
})()

let dir: string
let dbPath: string
let db: WrcSecurityDb

beforeEach(() => {
  if (!Database) return
  dir = mkdtempSync(join(tmpdir(), 'wrc-matrix-'))
  dbPath = join(dir, 'wrc-security.db')
  db = openWrcSecurityDb(dbPath)
})

afterEach(() => {
  if (!Database) return
  try {
    db.close()
  } catch {
    /* closed by restart */
  }
  rmSync(dir, { recursive: true, force: true })
})

function restart(): WrcSecurityDb {
  db.close()
  db = openWrcSecurityDb(dbPath)
  return db
}

interface Rig {
  gateDeps: WrCodeGateDeps
  pairingDeps: WrcPairingDeps
  devices: WrcDeviceRegistry
  useLimits: WrcUseLimitStore
  relay: WrcRelayClient
}

function rigOver(handle: WrcSecurityDb): Rig {
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
  const devices = createDbDeviceRegistry(handle)
  const useLimits = createDbUseLimitStore(handle)
  const relay = createDbRelay(handle, {
    directoryKeys: async (part) => {
      const r = await directory.getVerifiedRecord(part)
      return r.ok ? r.record.keys : null
    },
    now: () => NOW,
  })
  const gateDeps = createWrcGateDeps(client, { useLimits, now: () => NOW, directory, devices, relay })
  const pairingDeps: WrcPairingDeps = {
    gateDeps,
    devices,
    useLimits,
    directory,
    signDeviceRecord: (payload) =>
      signObject(
        { ...payload, kid: tenantFx.root.kid, sig: '' } as unknown as Record<string, unknown>,
        tenantFx.root,
      ) as unknown as WrcDeviceRecord,
    now: () => NOW,
    atomically: (fn) => handle.transaction(fn)(),
  }
  return { gateDeps, pairingDeps, devices, useLimits, relay }
}

function pairingPresentation(overrides: Partial<WrcPairingPresentation> = {}): WrcPairingPresentation {
  return {
    raw: SLOT_REF,
    receiver: { party_id: PRINCIPAL },
    device: {
      key_fingerprint: 'sha256:aa11bb22',
      device_class: 'workstation',
      device_name: 'new-workstation',
    },
    requestInstanceId: 'pair-req-1',
    ...overrides,
  }
}

// ── 1. Directory ──────────────────────────────────────────────────────────────

describe.skipIf(!Database)('matrix / directory: accept N → restart → N-1 refused', () => {
  it('holds the generation floor across restart', async () => {
    const fx: WrcPublisherFixture = buildPublisherFixture() // generation 3
    const clientA = new WrcDirectoryClient({
      transport: createFixtureTransport(fx),
      operator: { kid: fx.operator.kid, pub: fx.operator.pub },
      now: () => NOW,
      generationFloors: createDbDirectoryGenerationFloorStore(db),
    })
    expect((await clientA.getVerifiedRecord(TENANT)).ok).toBe(true)

    const reopened = restart()
    const { operator_sig: _o, publisher_countersig: _p, ...base } =
      fx.directoryRecord as unknown as Record<string, unknown>
    const stale = signDirectoryRecord({ ...base, generation: 2 }, fx.operator, fx.root)
    const clientB = new WrcDirectoryClient({
      transport: createFixtureTransport(fx, { directoryRecord: { ok: true, value: stale } }),
      operator: { kid: fx.operator.kid, pub: fx.operator.pub },
      now: () => NOW,
      generationFloors: createDbDirectoryGenerationFloorStore(reopened),
    })
    const refused = await clientB.getVerifiedRecord(TENANT)
    expect(refused.ok).toBe(false)
    if (refused.ok) return
    expect(refused.leg).toBe('generation_stale')
  })
})

// ── 2. Device ─────────────────────────────────────────────────────────────────

describe.skipIf(!Database)('matrix / device: pairing and revocation across restart', () => {
  it('successful pairing → restart → the registered device resolves', async () => {
    const rig = rigOver(db)
    rig.useLimits.declare(TENANT, useLimitEntryKey(SLOT_DESIGNATOR), defaultUseLimitProfile(1))
    const paired = await acceptDevicePairing(pairingPresentation(), rig.pairingDeps)
    expect(paired.ok, paired.ok ? '' : JSON.stringify(paired)).toBe(true)

    const fresh = rigOver(restart())
    const r = await runWrCodeGatePipeline(
      { raw: SI_REF, receiver: { party_id: PRINCIPAL, device_party_id: DSPI } },
      fresh.gateDeps,
    )
    expect(r.ok, r.ok ? '' : JSON.stringify(r)).toBe(true)
  })

  it('revoke device → restart → the same device refuses', async () => {
    const rig = rigOver(db)
    rig.useLimits.declare(TENANT, useLimitEntryKey(SLOT_DESIGNATOR), defaultUseLimitProfile(1))
    expect((await acceptDevicePairing(pairingPresentation(), rig.pairingDeps)).ok).toBe(true)
    rig.devices.revokeTenantDevice(TENANT, DSPI)

    const fresh = rigOver(restart())
    const r = await runWrCodeGatePipeline(
      { raw: SI_REF, receiver: { party_id: PRINCIPAL, device_party_id: DSPI } },
      fresh.gateDeps,
    )
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.gate).toBe(4)
    expect(r.reason).toBe('device_binding_unverified')
  })
})

// ── 3. Relay replay ───────────────────────────────────────────────────────────

function relayEnvelope(): WrcRelayEnvelope {
  const { capsule } = buildPendingCapsule({
    initiator: tenantFx,
    initiatorPrincipal: { partyId: PRINCIPAL, email: 'sales@tenant.test', key: initiatorPrincipal },
    recipient: { partyId: 'party-9', email: 'ceo@responder.test', encryptionPub: responderFx.encryption.pub },
    capsuleId: 'cap-mx',
    requestInstanceId: 'req-mx',
    expiresAt: NOW + 3600,
  })
  return {
    type: 'wrc/relay-envelope',
    capsule_id: 'cap-mx',
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
  }
}

function matrixClaim(): WrcReleaseClaim {
  return signObject(
    {
      type: 'wrc/release-claim',
      capsule_id: 'cap-mx',
      party_id: 'party-9',
      publisher_part: RESPONDER,
      request_instance_id: 'req-mx',
      issued_at: NOW,
      principal_pub: claimKey.principal_pub,
      sig: '',
    },
    claimKey.key,
  ) as unknown as WrcReleaseClaim
}

describe.skipIf(!Database)('matrix / relay: a used claim across restart', () => {
  it('valid first release → restart → deterministic replay behavior', async () => {
    const rig = rigOver(db)
    rig.relay.deposit(relayEnvelope())
    const first = await rig.relay.release({
      publisherPart: TENANT,
      entryKey: C_ENTRY_KEY,
      claim: matrixClaim(),
      delegation: DELEGATION,
    })
    expect(first.ok, first.ok ? '' : JSON.stringify(first)).toBe(true)

    const fresh = rigOver(restart())
    // The named party re-presenting the same claim: the DEFINED idempotent
    // re-release (§XVI.7.5.9) — not a new grant, the same one.
    const again = await fresh.relay.release({
      publisherPart: TENANT,
      entryKey: C_ENTRY_KEY,
      claim: matrixClaim(),
      delegation: DELEGATION,
    })
    expect(again.ok).toBe(true)

    // And the durable ledger still holds the FIRST claimant: a foreign party
    // cannot re-bind the used request id after restart.
    db.prepare(
      `INSERT INTO wrc_relay_request_ledger (capsule_id, request_instance_id, party_id, created_at)
       VALUES ('cap-mx', 'req-mx', 'party-8', ?)
       ON CONFLICT(capsule_id, request_instance_id) DO NOTHING`,
    ).run(new Date().toISOString())
    const settled = db
      .prepare(
        `SELECT party_id FROM wrc_relay_request_ledger WHERE capsule_id = 'cap-mx' AND request_instance_id = 'req-mx'`,
      )
      .get() as { party_id: string }
    expect(settled.party_id).toBe('party-9')
  })
})

// ── 4. Capsule idempotency ────────────────────────────────────────────────────

describe.skipIf(!Database)('matrix / capsule: admission idempotency across restart', () => {
  it('successful admission → restart → retry preserves exact idempotent semantics', () => {
    const capsule = buildPendingCapsule({
      initiator: tenantFx,
      initiatorPrincipal: { partyId: PRINCIPAL, email: 'sales@tenant.test', key: initiatorPrincipal },
      recipient: { partyId: 'party-9', email: 'ceo@responder.test', encryptionPub: responderFx.encryption.pub },
      capsuleId: 'cap-idem',
      requestInstanceId: 'req-idem',
      expiresAt: NOW + 3600,
    }).capsule as unknown as Record<string, unknown>
    const admit = (replayDb: WrcSecurityDb) =>
      verifyCapsuleAdmission({
        capsule,
        expectedInitiatorPart: TENANT,
        initiatorRecord: tenantFx.directoryRecord,
        initiatorDnsVerifiedDomains: [tenantFx.domain],
        receiver: { party_id: 'party-9', email: 'ceo@responder.test' },
        decryptKey: responderFx.encryption.privateKey,
        replay: createDbAdmissionReplayStore(replayDb),
        nowS: NOW,
      })

    const first = admit(db)
    expect(first.ok, first.ok ? '' : JSON.stringify(first)).toBe(true)
    if (!first.ok) return
    expect(first.idempotentReplay).toBe(false)

    const retry = admit(restart())
    expect(retry.ok).toBe(true)
    if (!retry.ok) return
    expect(retry.idempotentReplay).toBe(true)
    expect(retry.admitted.capsule_id).toBe('cap-idem')
  })
})

// ── 5. One-time-use ───────────────────────────────────────────────────────────

describe.skipIf(!Database)('matrix / one-time-use: consumption survives restart', () => {
  it('claim → consume → restart → second use refused', () => {
    const store = createDbUseLimitStore(db)
    store.declare(TENANT, 'ENTRY1', defaultUseLimitProfile(1))
    expect(store.claim(TENANT, 'ENTRY1', 'party-1', 'req-1', NOW).ok).toBe(true)
    expect(store.consume(TENANT, 'ENTRY1', 'party-1', 'req-1', NOW).ok).toBe(true)

    const after = createDbUseLimitStore(restart())
    const second = after.claim(TENANT, 'ENTRY1', 'party-1', 'req-2', NOW + 10)
    expect(second.ok).toBe(false)
    if (second.ok) return
    expect(second.reason).toBe('CONSUMED')
  })
})

// ── 6. Failed downstream verification ─────────────────────────────────────────

describe.skipIf(!Database)('matrix / failed downstream: the claim reverts, the use survives', () => {
  it('claim → downstream gate fails (release) → restart → not consumed, next attempt possible', () => {
    const store = createDbUseLimitStore(db)
    store.declare(TENANT, 'ENTRY2', defaultUseLimitProfile(1))
    expect(store.claim(TENANT, 'ENTRY2', 'party-1', 'req-1', NOW).ok).toBe(true)
    // Gate 5/6 failed: the pipeline's revertClaim path calls release().
    store.release(TENANT, 'ENTRY2', 'party-1')

    const after = createDbUseLimitStore(restart())
    const row = after.read(TENANT, 'ENTRY2')
    expect(row?.state).toBe('active')
    expect(row?.uses_taken).toBe(0)
    expect(after.claim(TENANT, 'ENTRY2', 'party-2', 'req-2', NOW + 5).ok).toBe(true)
  })

  it('crash WHILE claimed (no release ran): the claim itself is durable, and times out lazily', () => {
    const store = createDbUseLimitStore(db)
    store.declare(TENANT, 'ENTRY3', defaultUseLimitProfile(1))
    expect(store.claim(TENANT, 'ENTRY3', 'party-1', 'req-1', NOW).ok).toBe(true)

    const after = createDbUseLimitStore(restart())
    // Inside the timeout window another party is still held out…
    const contested = after.claim(TENANT, 'ENTRY3', 'party-2', 'req-2', NOW + 5)
    expect(contested.ok).toBe(false)
    if (contested.ok) return
    expect(contested.reason).toBe('CLAIMED_BY_OTHER')
    // …and after the window the entry recovers — the crash consumed nothing.
    const profile = defaultUseLimitProfile(1)
    const recovered = after.claim(TENANT, 'ENTRY3', 'party-2', 'req-3', NOW + profile.claim_timeout_s + 1)
    expect(recovered.ok).toBe(true)
  })
})

// ── 7. Pairing race ───────────────────────────────────────────────────────────

describe.skipIf(!Database)('matrix / pairing race: one winner, durable exactly once', () => {
  it('two concurrent pairings against one slot: one winner, restart preserves it', async () => {
    const rig = rigOver(db)
    rig.useLimits.declare(TENANT, useLimitEntryKey(SLOT_DESIGNATOR), defaultUseLimitProfile(1))
    const [a, b] = await Promise.all([
      acceptDevicePairing(
        pairingPresentation({
          requestInstanceId: 'race-a',
          device: { key_fingerprint: 'sha256:aaaa', device_class: 'workstation', device_name: 'racer-a' },
        }),
        rig.pairingDeps,
      ),
      acceptDevicePairing(
        pairingPresentation({
          requestInstanceId: 'race-b',
          device: { key_fingerprint: 'sha256:bbbb', device_class: 'workstation', device_name: 'racer-b' },
        }),
        rig.pairingDeps,
      ),
    ])
    const winners = [a, b].filter((r) => r.ok)
    expect(winners.length).toBe(1)
    // The loser's refusal is deterministic (claim/consume vocabulary).
    const loser = [a, b].find((r) => !r.ok)!
    expect(loser.ok).toBe(false)

    const reopened = restart()
    const rows = reopened
      .prepare('SELECT device_party_id FROM wrc_device_record WHERE tenant_part = ?')
      .all(TENANT) as Array<{ device_party_id: string }>
    expect(rows.length).toBe(1)
    const winner = winners[0]!
    if (winner.ok) expect(rows[0]!.device_party_id).toBe(winner.devicePartyId)
  })
})

// ── 8. Admission race ─────────────────────────────────────────────────────────

describe.skipIf(!Database)('matrix / admission race: no double consumption of a single use', () => {
  it('two acceptances against a single-use entry: durable state agrees with the outcomes', () => {
    const store = createDbUseLimitStore(db)
    store.declare(TENANT, 'ENTRY4', defaultUseLimitProfile(1))
    expect(store.claim(TENANT, 'ENTRY4', 'party-1', 'req-a', NOW).ok).toBe(true)

    // Two acceptance attempts race the CAS with distinct request ids: the
    // statement admits exactly one — the second sees the consumed state.
    const first = store.consume(TENANT, 'ENTRY4', 'party-1', 'req-a', NOW)
    const second = store.consume(TENANT, 'ENTRY4', 'party-1', 'req-b', NOW)
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(false)
    if (second.ok) return
    expect(second.reason).toBe('CONSUMED')

    const row = store.read(TENANT, 'ENTRY4')
    expect(row?.state).toBe('consumed')
    expect(row?.uses_taken).toBe(1)

    // And the durable outcome survives restart.
    const after = createDbUseLimitStore(restart())
    expect(after.read(TENANT, 'ENTRY4')?.uses_taken).toBe(1)
  })
})
