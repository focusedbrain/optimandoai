/**
 * Run 5 Slices 6–8 — relay, device trust, and capsule admission wired into
 * the PRODUCTION runtime.
 *
 * Every vector drives `handleWrcSubmitReference` — the production RPC
 * surface — against the production implementations over a real security DB
 * file: `createDbRelay`, `createDbDeviceRegistry`,
 * `createDbAdmissionReplayStore`, `createDbUseLimitStore`. The only test
 * substitutions are controlled EXTERNAL fixtures (registry transport,
 * directory operator anchor, runtime identity) — never gate results.
 *
 * Proven here:
 *  - Gate 4 failure ⇒ the relay never receives a release request;
 *  - Gate 5 failure ⇒ no relay-controlled material escapes;
 *  - only Gate-5 success yields bytes for Gate 6, bound to the canonical
 *    designator (a capsule parked under a non-canonical key is unreachable);
 *  - restart does not reopen a used claim / admitted request id;
 *  - Gate 4 device decisions come from the durable registry: correct device,
 *    sibling, unregistered, revoked, stale-generation, wrong C establishment;
 *  - no alternate capsule ingress exists on the runtime surface;
 *  - a Gate-6 failure reverts the §XVI.8.4 use-limit claim (Run-2 semantics).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { buildWrCodeReference, captureWrCodeReference } from '@repo/ingestion-core'
import { WrcDirectoryClient } from '../namespaceDirectory'
import { createDbDeviceRegistry, type WrcDevicePass, type WrcDeviceRegistry } from '../deviceRegistry'
import { deriveEntryDesignator, useLimitEntryKey } from '../entryDesignator'
import { createDbRelay, principalKeyFingerprint, type WrcRelayClient } from '../relayRelease'
import { createDbAdmissionReplayStore } from '../capsuleAdmission'
import { WrcResolutionClient } from '../resolutionClient'
import { WrcResolvedRecordStore, createMemoryPersistence } from '../resolvedRecordStore'
import { createDbUseLimitStore, defaultUseLimitProfile, type WrcUseLimitStore } from '../useLimitStore'
import { openWrcSecurityDb, type WrcSecurityDb } from '../wrcSecurityDb'
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
import type { WrcRuntimeIdentity } from '../wrcIdentity'
import {
  buildPendingCapsule,
  buildPublisherFixture,
  createMultiFixtureTransport,
  makeClaimKey,
  makeKeyPair,
  signDeviceRecord,
  signPrincipalDelegation,
} from './wrcFixtures'

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
const RESPONDER = 'RCVPBX'
const OTHER = 'ZZPQB7'
const I_COMB = 'CTXA01'
const SI_COMB = 'DEVSE1'
const SC_COMB = 'SCDEV1'
const RESP_DEVICE = 'party-9:resp-dev'

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
        receiving_party: { kind: 'device', id: RESP_DEVICE },
        parent: { cls: 'C', publisher_part: TENANT, counterparty_part: RESPONDER },
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

function refOf(cls: 'P' | 'I' | 'C' | 'SI' | 'SC', blocks: string[]): string {
  const r = buildWrCodeReference(cls, blocks)
  if (!r.ok) throw new Error(`vector build failed: ${r.reason}`)
  return r.canonical
}
const I_REF = refOf('I', [TENANT, I_COMB])
const C_REF = refOf('C', [TENANT, RESPONDER])
const SI_REF = refOf('SI', [TENANT, SI_COMB])
const SC_REF = refOf('SC', [TENANT, SC_COMB])

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

/** The responder-org runtime identity (the C recipient). */
const RESPONDER_IDENTITY: WrcRuntimeIdentity = {
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
}

let dir: string
let dbPath: string
let db: WrcSecurityDb
let relay: WrcRelayClient
let devices: WrcDeviceRegistry
let useLimits: WrcUseLimitStore
let releaseCalls: number

/** Wire the PRODUCTION stores over `handle` into the runtime seams. */
function compose(handle: WrcSecurityDb) {
  const transport = createMultiFixtureTransport([tenantFx, responderFx])
  const client = new WrcResolutionClient({
    transport,
    store: new WrcResolvedRecordStore(createMemoryPersistence()),
    ingestPublicKey: INGEST.pub,
  })
  const directory = new WrcDirectoryClient({
    transport,
    operator: { kid: OPERATOR.kid, pub: OPERATOR.pub },
  })
  const production = createDbRelay(handle, {
    directoryKeys: async (part) => {
      const r = await directory.getVerifiedRecord(part)
      return r.ok ? r.record.keys : null
    },
  })
  // Observation wrapper ONLY (call counting) — every decision is production's.
  relay = {
    deposit: (e) => production.deposit(e),
    hasEnvelope: (p, k) => production.hasEnvelope(p, k),
    capsuleIdFor: (p, k) => production.capsuleIdFor(p, k),
    setStatus: (id, s) => production.setStatus(id, s),
    release: (input) => {
      releaseCalls += 1
      return production.release(input)
    },
  }
  devices = createDbDeviceRegistry(handle)
  useLimits = createDbUseLimitStore(handle)
  setWrcClientForTests(client)
  setWrcDirectoryForTests(directory)
  setWrcDevicesForTests(devices)
  setWrcRelayForTests(relay)
  setWrcUseLimitStoreForTests(useLimits)
  setWrcAdmissionReplayForTests(createDbAdmissionReplayStore(handle))
  setWrcIdentityForTests(RESPONDER_IDENTITY)
}

beforeEach(() => {
  if (!Database) return
  releaseCalls = 0
  dir = mkdtempSync(join(tmpdir(), 'wrc-prod-'))
  dbPath = join(dir, 'wrc-security.db')
  db = openWrcSecurityDb(dbPath)
  compose(db)
})

afterEach(() => {
  if (!Database) return
  setWrcClientForTests(null)
  setWrcDirectoryForTests(null)
  setWrcDevicesForTests(null)
  setWrcRelayForTests(null)
  setWrcUseLimitStoreForTests(null)
  setWrcAdmissionReplayForTests(null)
  setWrcIdentityForTests(null)
  try {
    db.close()
  } catch {
    /* closed by restart */
  }
  rmSync(dir, { recursive: true, force: true })
})

/** Restart: close the handle, reopen the file, recompose everything. */
function restartAndRecompose() {
  db.close()
  db = openWrcSecurityDb(dbPath)
  compose(db)
}

function depositCapsule(capsuleId: string, requestInstanceId: string, opts: { recipientEmail?: string; entryKey?: string } = {}) {
  const nowS = Math.floor(Date.now() / 1000)
  const { capsule } = buildPendingCapsule({
    initiator: tenantFx,
    initiatorPrincipal: { partyId: 'party-1', email: 'sales@publisher.test', key: initiatorPrincipal },
    recipient: {
      partyId: 'party-9',
      email: opts.recipientEmail ?? 'ceo@responder.test',
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
    entry_key: opts.entryKey ?? C_ENTRY_KEY,
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

// ── Slice 6: relay release in the production runtime ─────────────────────────

describe.skipIf(!Database)('production relay wiring [XVI.7.6 gate 5]', () => {
  it('Gate 4 failure ⇒ the relay never receives a release request', async () => {
    depositCapsule('cap-g4', 'req-g4')
    // A runtime with no publisher identity at all: the C counterparty
    // self-match (Gate 4) refuses with NOT_FOR_YOU.
    setWrcIdentityForTests({
      ...RESPONDER_IDENTITY,
      receiver: { party_id: 'party-8' },
    })
    const r = await handleWrcSubmitReference({ raw: C_REF, requestInstanceId: 'req-g4' })
    expect(r.success).toBe(true)
    if (!r.success) return
    expect(r.result.ok).toBe(false)
    if (r.result.ok) return
    expect(r.result.gate).toBe(4)
    expect(releaseCalls).toBe(0)
  })

  it('Gate 5 failure ⇒ no relay-controlled material escapes the refusal', async () => {
    depositCapsule('cap-wd', 'req-wd')
    relay.setStatus('cap-wd', 'withdrawn')
    const r = await handleWrcSubmitReference({ raw: C_REF, requestInstanceId: 'req-wd' })
    expect(r.success).toBe(true)
    if (!r.success) return
    expect(r.result.ok).toBe(false)
    if (r.result.ok) return
    expect(r.result.gate).toBe(5)
    expect(r.result.detail).toContain('capsule_withdrawn')
    // The refusal carries reasons only — no capsule bytes anywhere on it.
    expect(JSON.stringify(r.result)).not.toContain('cap-wd')
  })

  it('Gate 5 success ⇒ the released bytes flow into Gate 6 and admit', async () => {
    depositCapsule('cap-ok', 'req-ok')
    const r = await handleWrcSubmitReference({ raw: C_REF, requestInstanceId: 'req-ok' })
    expect(r.success).toBe(true)
    if (!r.success) return
    expect(r.result.ok, r.result.ok ? '' : JSON.stringify(r.result)).toBe(true)
    if (!r.result.ok) return
    expect(r.result.gatesPassed).toContain('relay_release')
    expect(r.result.gatesPassed).toContain('capsule_admission')
    expect((r.result.released.capsule as { capsule_id?: string } | null)?.capsule_id).toBe('cap-ok')
    expect(releaseCalls).toBe(1)
  })

  it('release is bound to the canonical designator: a capsule under a foreign key is unreachable', async () => {
    depositCapsule('cap-foreign', 'req-f', { entryKey: 'not-the-canonical-key' })
    const r = await handleWrcSubmitReference({ raw: C_REF, requestInstanceId: 'req-f' })
    expect(r.success).toBe(true)
    if (!r.success) return
    expect(r.result.ok).toBe(true)
    if (!r.result.ok) return
    // Public-offering path only: the mis-keyed capsule was never released.
    expect(r.result.released.capsule).toBeNull()
    expect(releaseCalls).toBe(0)
  })

  it('a used claim does not reopen across restart (relay ledger + Gate-6 ledger durable)', async () => {
    depositCapsule('cap-r1', 'req-r1')
    const first = await handleWrcSubmitReference({ raw: C_REF, requestInstanceId: 'req-r1' })
    expect(first.success && first.result.ok).toBe(true)

    restartAndRecompose()

    // Same request id, same capsule: the defined idempotent result (custody
    // and ledger both came back from the file — no re-deposit happened).
    const retry = await handleWrcSubmitReference({ raw: C_REF, requestInstanceId: 'req-r1' })
    expect(retry.success).toBe(true)
    if (!retry.success) return
    expect(retry.result.ok, retry.result.ok ? '' : JSON.stringify(retry.result)).toBe(true)

    // Same request id re-bound to a DIFFERENT capsule after restart: refused.
    depositCapsule('cap-r2', 'req-r1')
    const alias = await handleWrcSubmitReference({ raw: C_REF, requestInstanceId: 'req-r1' })
    expect(alias.success).toBe(true)
    if (!alias.success) return
    expect(alias.result.ok).toBe(false)
    if (alias.result.ok) return
    expect(alias.result.gate).toBe(6)
    expect(alias.result.detail).toContain('request_replayed')
  })
})

// ── Slice 7: device trust in the production runtime ──────────────────────────

const DEVICE_IDENTITY: WrcRuntimeIdentity = {
  receiver: { party_id: 'party-1', device_party_id: 'party-1:device-A' },
  claimIdentity: null,
  decryptKey: null,
}

function registerDeviceA(overrides: { generation?: number; status?: 'active' | 'revoked' } = {}) {
  devices.registerTenantDevice(
    signDeviceRecord(tenantFx, {
      principalPartyId: 'party-1',
      devicePartyId: 'party-1:device-A',
      deviceName: 'device-A',
      deviceClass: 'workstation',
      generation: overrides.generation ?? 1,
      status: overrides.status ?? 'active',
    }),
  )
}

describe.skipIf(!Database)('production device trust [XVI.13.7 gate 4]', () => {
  it('the correct registered device admits', async () => {
    registerDeviceA()
    setWrcIdentityForTests(DEVICE_IDENTITY)
    const r = await handleWrcSubmitReference({ raw: SI_REF })
    expect(r.success).toBe(true)
    if (!r.success) return
    expect(r.result.ok, r.result.ok ? '' : JSON.stringify(r.result)).toBe(true)
  })

  it('a sibling device of the same principal refuses', async () => {
    registerDeviceA()
    setWrcIdentityForTests({
      ...DEVICE_IDENTITY,
      receiver: { party_id: 'party-1', device_party_id: 'party-1:device-B' },
    })
    const r = await handleWrcSubmitReference({ raw: SI_REF })
    expect(r.success).toBe(true)
    if (!r.success) return
    expect(r.result.ok).toBe(false)
    if (r.result.ok) return
    expect(r.result.gate).toBe(4)
  })

  it('an unregistered device refuses (record_missing)', async () => {
    setWrcIdentityForTests(DEVICE_IDENTITY)
    const r = await handleWrcSubmitReference({ raw: SI_REF })
    expect(r.success).toBe(true)
    if (!r.success) return
    expect(r.result.ok).toBe(false)
    if (r.result.ok) return
    expect(r.result.gate).toBe(4)
    expect(r.result.reason).toBe('device_binding_unverified')
    expect(r.result.detail).toContain('record_missing')
  })

  it('a revoked device refuses', async () => {
    registerDeviceA()
    devices.revokeTenantDevice(TENANT, 'party-1:device-A')
    setWrcIdentityForTests(DEVICE_IDENTITY)
    const r = await handleWrcSubmitReference({ raw: SI_REF })
    expect(r.success).toBe(true)
    if (!r.success) return
    expect(r.result.ok).toBe(false)
    if (r.result.ok) return
    expect(r.result.gate).toBe(4)
    expect(r.result.reason).toBe('device_binding_unverified')
  })

  it('a stale-generation record cannot displace the current one (rollback refused)', async () => {
    registerDeviceA({ generation: 2, status: 'revoked' })
    // The attacker replays the OLD gen-1 active record: the generation-gated
    // upsert ignores it, so the device stays revoked.
    registerDeviceA({ generation: 1, status: 'active' })
    setWrcIdentityForTests(DEVICE_IDENTITY)
    const r = await handleWrcSubmitReference({ raw: SI_REF })
    expect(r.success).toBe(true)
    if (!r.success) return
    expect(r.result.ok).toBe(false)
    if (r.result.ok) return
    expect(r.result.gate).toBe(4)
  })

  it('a valid Device Record under the WRONG C establishment confers nothing', async () => {
    const record = signDeviceRecord(
      responderFx,
      {
        principalPartyId: 'party-9',
        devicePartyId: RESP_DEVICE,
        deviceName: 'resp-dev',
        deviceClass: 'workstation',
      },
    )
    const nowS = Math.floor(Date.now() / 1000)
    const passUnder = (initiator: string): WrcDevicePass => ({
      type: 'wrc/device-pass',
      c_initiator_part: initiator,
      c_responder_part: RESPONDER,
      record,
      registered_at: nowS,
      expires_at: nowS + 3600,
      status: 'active',
    })
    setWrcIdentityForTests({
      receiver: {
        publisher_part: RESPONDER,
        party_id: 'party-9',
        device_party_id: RESP_DEVICE,
        sso_email: 'ceo@responder.test',
      },
      claimIdentity: RESPONDER_IDENTITY.claimIdentity,
      decryptKey: RESPONDER_IDENTITY.decryptKey,
    })

    // Registered beneath OTHER↔RESPONDER only: the SC parent names
    // TENANT↔RESPONDER, so the lookup by the SC establishment finds nothing.
    devices.registerCounterpartPass(passUnder(OTHER))
    const wrong = await handleWrcSubmitReference({ raw: SC_REF })
    expect(wrong.success).toBe(true)
    if (!wrong.success) return
    expect(wrong.result.ok).toBe(false)
    if (wrong.result.ok) return
    expect(wrong.result.gate).toBe(4)
    expect(wrong.result.detail).toContain('pass_missing')

    // The SAME record beneath the RIGHT establishment admits.
    devices.registerCounterpartPass(passUnder(TENANT))
    const right = await handleWrcSubmitReference({ raw: SC_REF })
    expect(right.success).toBe(true)
    if (!right.success) return
    expect(right.result.ok, right.result.ok ? '' : JSON.stringify(right.result)).toBe(true)
  })
})

// ── Slice 8: capsule admission in the production runtime ─────────────────────

describe.skipIf(!Database)('production capsule admission [XVI.7.6 gate 6]', () => {
  it('no alternate capsule ingress: a hostile `capsule` parameter is dead weight', async () => {
    // Nothing deposited. A caller trying to hand the runtime "trusted"
    // capsule bytes gets the public-offering result — the parameter does not
    // exist on the surface and nothing reads it.
    const r = await handleWrcSubmitReference({
      raw: C_REF,
      requestInstanceId: 'req-hostile',
      ...({ capsule: { capsule_id: 'cap-fake', trusted: true } } as object),
    })
    expect(r.success).toBe(true)
    if (!r.success) return
    expect(r.result.ok).toBe(true)
    if (!r.result.ok) return
    expect(r.result.released.capsule).toBeNull()
  })

  it('a Gate-6 failure reverts the use-limit claim: the entry is not falsely consumed', async () => {
    useLimits.declare(TENANT, C_ENTRY_KEY, defaultUseLimitProfile(1))
    // Recipient binding names the WRONG email ⇒ Gate 6 refuses after Gate 5
    // released (and after the §XVI.8.4 claim was taken).
    depositCapsule('cap-bad', 'req-bad', { recipientEmail: 'impostor@responder.test' })
    const bad = await handleWrcSubmitReference({ raw: C_REF, requestInstanceId: 'req-bad' })
    expect(bad.success).toBe(true)
    if (!bad.success) return
    expect(bad.result.ok).toBe(false)
    if (bad.result.ok) return
    expect(bad.result.gate).toBe(6)

    // Run-2 semantics: the failed downstream gate released the claim — the
    // entry is not consumed, and a valid subsequent attempt succeeds.
    const row = useLimits.read(TENANT, C_ENTRY_KEY)
    expect(row?.state).toBe('active')

    depositCapsule('cap-good', 'req-good')
    const good = await handleWrcSubmitReference({ raw: C_REF, requestInstanceId: 'req-good' })
    expect(good.success).toBe(true)
    if (!good.success) return
    expect(good.result.ok, good.result.ok ? '' : JSON.stringify(good.result)).toBe(true)
  })
})
