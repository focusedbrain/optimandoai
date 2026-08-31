/**
 * Run 5 Slice 12 — production full-path and anti-bypass suite.
 *
 * Every vector here enters at the REAL production-facing surface: the
 * loopback-RPC dispatcher (`handleHandshakeRPC`) that the extension calls —
 * `wrc.captureReference`, `wrc.submitReference`, `wrc.acceptReference`,
 * `wrc.resolvePublisher` — never `gatePipeline.ts` directly. The runtime
 * composition underneath is the PRODUCTION durable stack over a real
 * security-DB file; the only substitutions are controlled external fixtures
 * (registry transport, directory operator anchor, runtime identity).
 *
 * Part 1 — full path per Annex class (P, I, C, SP, SI, SC, SE):
 *   capture surface → wrc.submitReference → composition → six gates → relay
 *   → capsule admission → explicit acceptance where a use profile exists.
 *   The e-mail detection surface is proven as a capture origin too.
 *
 * Part 2 — anti-bypass: production callers cannot
 *   - resolve protected material through the old resolver;
 *   - reach Gate 5 / Gate 6 with caller-trusted state (no such RPC exists);
 *   - supply a canonical Entry Designator, Device-Pass status, Directory
 *     approval, or replay/idempotency approval (the params are dead weight);
 *   - consume a use without a valid runtime-minted acceptance.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { buildWrCodeReference, captureWrCodeReference } from '@repo/ingestion-core'
import { handleHandshakeRPC } from '../../handshake/ipc'
import { WR_CODE_GATE_ORDER } from '../gatePipeline'
import { detectWrCodeReferencesInEmailBody } from '../../email/wrCodeEmailDetection'
import { WrcDirectoryClient } from '../namespaceDirectory'
import { createDbDeviceRegistry, type WrcDeviceRegistry } from '../deviceRegistry'
import { deriveEntryDesignator, useLimitEntryKey } from '../entryDesignator'
import { createDbRelay, principalKeyFingerprint, type WrcRelayClient } from '../relayRelease'
import { createDbAdmissionReplayStore } from '../capsuleAdmission'
import { WrcResolutionClient } from '../resolutionClient'
import { WrcResolvedRecordStore, createMemoryPersistence } from '../resolvedRecordStore'
import { createDbUseLimitStore, defaultUseLimitProfile, type WrcUseLimitStore } from '../useLimitStore'
import { openWrcSecurityDb, type WrcSecurityDb } from '../wrcSecurityDb'
import {
  clearWrcPendingAcceptancesForTests,
  setWrcAdmissionReplayForTests,
  setWrcClientForTests,
  setWrcDevicesForTests,
  setWrcDirectoryForTests,
  setWrcIdentityForTests,
  setWrcRelayForTests,
  setWrcUseLimitStoreForTests,
} from '../wrcRuntime'
import type { WrcRuntimeIdentity } from '../wrcIdentity'
import type { WrCodeGateOutcome } from '../gatePipeline'
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
const P_LOCAL = '9B2M3'
const I_COMB = 'PA1RS7'
const SP_COMB = 'SPC4MB'
const SI_COMB = 'DEVSE1'
const SC_COMB = 'M3K9B2'
const SE_COMB = 'SEDP01'

const INGEST = makeKeyPair('wrc-ingest-shared')
const OPERATOR = makeKeyPair('dir-op-shared')

// SE session windows are wall-clock: give the fixture a live window around
// the real `Date.now()` the production runtime uses.
const REAL_NOW = Math.floor(Date.now() / 1000)

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
        session: { id: 'sess-prod', not_before: null, expires_at: REAL_NOW + 3600 },
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

const claimKey = makeClaimKey('responder-principal-key')
const DELEGATION = signPrincipalDelegation(responderFx, {
  principalPartyId: 'party-9',
  ssoEmail: 'ceo@responder.test',
  principalPub: claimKey.principal_pub,
})
const initiatorPrincipal = makeKeyPair('initiator-principal-key')

const TENANT_PRINCIPAL: WrcRuntimeIdentity = {
  receiver: { party_id: 'party-1', device_party_id: 'party-1:device-A' },
  claimIdentity: null,
  decryptKey: null,
}
const RESPONDER_ORG: WrcRuntimeIdentity = {
  receiver: { publisher_part: RESPONDER, party_id: 'party-9', sso_email: 'ceo@responder.test' },
  claimIdentity: {
    principal_pub: claimKey.principal_pub,
    delegation: DELEGATION,
    sign: claimKey.sign,
  },
  decryptKey: responderFx.encryption.privateKey,
}

let dir: string
let db: WrcSecurityDb
let relay: WrcRelayClient
let devices: WrcDeviceRegistry
let useLimits: WrcUseLimitStore

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
  relay = createDbRelay(handle, {
    directoryKeys: async (part) => {
      const r = await directory.getVerifiedRecord(part)
      return r.ok ? r.record.keys : null
    },
  })
  devices = createDbDeviceRegistry(handle)
  devices.registerTenantDevice(
    signDeviceRecord(tenantFx, {
      principalPartyId: 'party-1',
      devicePartyId: 'party-1:device-A',
      deviceName: 'device-A',
      deviceClass: 'workstation',
    }),
  )
  useLimits = createDbUseLimitStore(handle)
  setWrcClientForTests(client)
  setWrcDirectoryForTests(directory)
  setWrcDevicesForTests(devices)
  setWrcRelayForTests(relay)
  setWrcUseLimitStoreForTests(useLimits)
  setWrcAdmissionReplayForTests(createDbAdmissionReplayStore(handle))
}

beforeEach(() => {
  if (!Database) return
  dir = mkdtempSync(join(tmpdir(), 'wrc-fullpath-'))
  db = openWrcSecurityDb(join(dir, 'wrc-security.db'))
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
  clearWrcPendingAcceptancesForTests()
  try {
    db.close()
  } catch {
    /* already closed */
  }
  rmSync(dir, { recursive: true, force: true })
})

function depositCapsule(capsuleId: string, requestInstanceId: string) {
  const nowS = Math.floor(Date.now() / 1000)
  const { capsule } = buildPendingCapsule({
    initiator: tenantFx,
    initiatorPrincipal: { partyId: 'party-1', email: 'sales@publisher.test', key: initiatorPrincipal },
    recipient: { partyId: 'party-9', email: 'ceo@responder.test', encryptionPub: responderFx.encryption.pub },
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

/** The production RPC surface — the same dispatcher the extension reaches. */
async function rpc(method: string, params: Record<string, unknown>): Promise<any> {
  return handleHandshakeRPC(method, params, null)
}

// ── Part 1: full path per class, from the RPC surface ─────────────────────────

describe.skipIf(!Database)('production full path: every Annex class via the RPC surface', () => {
  const rows: Array<{ cls: string; raw: string; identity: WrcRuntimeIdentity }> = [
    { cls: 'P', raw: P_REF, identity: TENANT_PRINCIPAL },
    { cls: 'I', raw: I_REF, identity: TENANT_PRINCIPAL },
    { cls: 'C', raw: C_REF, identity: RESPONDER_ORG },
    { cls: 'SP', raw: SP_REF, identity: TENANT_PRINCIPAL },
    { cls: 'SI', raw: SI_REF, identity: TENANT_PRINCIPAL },
    { cls: 'SC', raw: SC_REF, identity: RESPONDER_ORG },
    { cls: 'SE', raw: SE_REF, identity: TENANT_PRINCIPAL },
  ]

  for (const row of rows) {
    it(`${row.cls}: capture → submit → six gates → acceptance token`, async () => {
      setWrcIdentityForTests(row.identity)
      if (row.cls === 'C') depositCapsule('cap-fp', 'req-fp')

      // 1. The capture surface (manual entry): local, no network effect.
      const captured = await rpc('wrc.captureReference', { raw: row.raw })
      expect(captured.success).toBe(true)
      expect(captured.result.ok).toBe(true)
      expect(captured.result.cls).toBe(row.cls)

      // 2. Submission: THE resolution path, all six gates in normative order.
      const submitted = await rpc('wrc.submitReference', {
        raw: row.raw,
        requestInstanceId: `req-fp-${row.cls}`,
      })
      expect(submitted.success, JSON.stringify(submitted)).toBe(true)
      const outcome = submitted.result as WrCodeGateOutcome
      expect(outcome.ok, outcome.ok ? '' : JSON.stringify(outcome)).toBe(true)
      if (!outcome.ok) return
      expect(outcome.gatesPassed).toEqual([...WR_CODE_GATE_ORDER])
      expect(outcome.reference.cls).toBe(row.cls)
      if (row.cls === 'C') expect(outcome.released.capsule).not.toBeNull()

      // 3. Explicit acceptance: the token the runtime minted is accepted.
      expect(typeof submitted.acceptanceToken).toBe('string')
      const accepted = await rpc('wrc.acceptReference', {
        acceptanceToken: submitted.acceptanceToken,
      })
      expect(accepted.success, JSON.stringify(accepted)).toBe(true)
      expect(accepted.result.accepted).toBe(true)
    })
  }

  it('C with a declared single-use profile: acceptance consumes durably, exactly once', async () => {
    setWrcIdentityForTests(RESPONDER_ORG)
    useLimits.declare(TENANT, C_ENTRY_KEY, defaultUseLimitProfile(1))
    depositCapsule('cap-use', 'req-use')

    const submitted = await rpc('wrc.submitReference', { raw: C_REF, requestInstanceId: 'req-use' })
    expect(submitted.success && submitted.result.ok, JSON.stringify(submitted)).toBe(true)

    const accepted = await rpc('wrc.acceptReference', {
      acceptanceToken: submitted.acceptanceToken,
    })
    expect(accepted.success, JSON.stringify(accepted)).toBe(true)
    expect(accepted.result.consumed).toBe(true)
    expect(useLimits.read(TENANT, C_ENTRY_KEY)?.state).toBe('consumed')

    // The spent token is dead; the durable use stays taken.
    const replayed = await rpc('wrc.acceptReference', {
      acceptanceToken: submitted.acceptanceToken,
    })
    expect(replayed.success).toBe(false)
    expect(replayed.error).toBe('acceptance_unknown')
    expect(useLimits.read(TENANT, C_ENTRY_KEY)?.uses_taken).toBe(1)
  })

  it('e-mail detection is a capture origin: the detected canonical submits and admits', async () => {
    setWrcIdentityForTests(TENANT_PRINCIPAL)
    const body = `Hi — your context reference is ${I_REF}, please open it in WRDesk.`
    const detections = detectWrCodeReferencesInEmailBody(body)
    expect(detections.length).toBe(1)
    expect(detections[0]!.cls).toBe('I')

    const submitted = await rpc('wrc.submitReference', {
      raw: detections[0]!.canonical,
      requestInstanceId: 'req-email',
    })
    expect(submitted.success && submitted.result.ok, JSON.stringify(submitted)).toBe(true)
  })
})

// ── Part 2: anti-bypass ───────────────────────────────────────────────────────

describe.skipIf(!Database)('anti-bypass: no production caller can skip or pre-satisfy a gate', () => {
  it('the old resolver (status/audit surface) never yields protected relay material', async () => {
    depositCapsule('cap-secret', 'req-secret')
    const r = await rpc('wrc.resolvePublisher', { publisherPart: TENANT, entryId: 'CREL01' })
    expect(r.success).toBe(true)
    // Directory/entry status only — no capsule bytes, no relay envelope, no
    // sealed nonce, anywhere in the surface it returns.
    const flat = JSON.stringify(r)
    expect(flat).not.toContain('cap-secret')
    expect(flat).not.toContain('sealed_nonce')
    expect(flat).not.toContain('relay-envelope')
  })

  it('no RPC exists to call Gate 5 or Gate 6 with caller-trusted state', async () => {
    for (const method of [
      'wrc.releaseRelay',
      'wrc.relayRelease',
      'wrc.admitCapsule',
      'wrc.capsuleAdmission',
      'wrc.markReplayApproved',
    ]) {
      const r = await rpc(method, { trusted: true })
      expect(r).toEqual({ error: 'unknown_method', reason: expect.anything() })
    }
  })

  it('caller-supplied trusted state on submit is dead weight (receiver, designator, pass, directory, replay)', async () => {
    // The runtime identity has NO registered device; the caller tries to
    // assert every trusted fact the gates are supposed to derive.
    setWrcIdentityForTests({
      receiver: { party_id: 'party-1', device_party_id: 'party-1:device-B' },
      claimIdentity: null,
      decryptKey: null,
    })
    const r = await rpc('wrc.submitReference', {
      raw: SI_REF,
      requestInstanceId: 'req-forge',
      receiver: { party_id: 'party-1', device_party_id: 'party-1:device-A' },
      designator: { cls: 'SI', publisher_part: TENANT, entry_id: 'RES001' },
      devicePass: { status: 'active', trusted: true },
      directoryApproved: true,
      replayApproved: true,
      relayReleased: { capsule: { capsule_id: 'cap-fake' } },
    })
    expect(r.success).toBe(true)
    // Gate 4 still refuses, and the reason names the RUNTIME's device-B —
    // proof the decision used the runtime identity, not the caller-asserted
    // device-A, and that none of the "trusted" params moved any gate.
    expect(r.result.ok).toBe(false)
    expect(r.result.gate).toBe(4)
    expect(r.result.reason).toBe('NOT_FOR_THIS_DEVICE')
  })

  it('replay/idempotency state cannot be caller-marked: rebinding a used request id refuses', async () => {
    setWrcIdentityForTests(RESPONDER_ORG)
    depositCapsule('cap-a', 'req-shared')
    const first = await rpc('wrc.submitReference', { raw: C_REF, requestInstanceId: 'req-shared' })
    expect(first.success && first.result.ok, JSON.stringify(first)).toBe(true)

    depositCapsule('cap-b', 'req-shared')
    const rebound = await rpc('wrc.submitReference', {
      raw: C_REF,
      requestInstanceId: 'req-shared',
      replayApproved: true,
      idempotent: true,
    })
    expect(rebound.success).toBe(true)
    expect(rebound.result.ok).toBe(false)
    expect(rebound.result.gate).toBe(6)
    expect(rebound.result.detail).toContain('request_replayed')
  })

  it('a use cannot be consumed without a valid acceptance: forged tokens die, state untouched', async () => {
    setWrcIdentityForTests(RESPONDER_ORG)
    useLimits.declare(TENANT, C_ENTRY_KEY, defaultUseLimitProfile(1))
    depositCapsule('cap-guard', 'req-guard')
    const submitted = await rpc('wrc.submitReference', { raw: C_REF, requestInstanceId: 'req-guard' })
    expect(submitted.success && submitted.result.ok, JSON.stringify(submitted)).toBe(true)

    // Forged / guessed tokens (including near-misses) are one indistinct no.
    for (const forged of ['deadbeef', submitted.acceptanceToken.slice(0, -2) + 'xx', '']) {
      const r = await rpc('wrc.acceptReference', { acceptanceToken: forged })
      expect(r.success).toBe(false)
    }
    // Nothing was consumed by any of it: the claim is still merely held.
    const row = useLimits.read(TENANT, C_ENTRY_KEY)
    expect(row?.state).toBe('claimed')
    expect(row?.uses_taken).toBe(0)

    // And the REAL token still works exactly once afterwards.
    const real = await rpc('wrc.acceptReference', { acceptanceToken: submitted.acceptanceToken })
    expect(real.success, JSON.stringify(real)).toBe(true)
    expect(real.result.consumed).toBe(true)
  })
})
