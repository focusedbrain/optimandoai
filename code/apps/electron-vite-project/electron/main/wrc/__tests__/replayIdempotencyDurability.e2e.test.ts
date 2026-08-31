/**
 * Run 5 Slices 4+5 — durable Gate-5 replay ledger and Gate-6 request-id
 * idempotency over the WRC security DB.
 *
 * The durability contract, per Annex §XVI.7.5.9 / §XVI.7.6:
 *
 *  - a value refused as replay before a restart remains refused after it;
 *  - an idempotent repeat (same party / same capsule) returns the defined
 *    equivalent result before AND after restart — idempotency and replay are
 *    distinct outcomes, not synonyms;
 *  - binding is atomic in the store (INSERT-if-absent + read-back), so two
 *    concurrent first uses settle on exactly one owner;
 *  - a Gate-6 failure never persists a false success;
 *  - unavailable or corrupted ledger state REFUSES (fail closed), never
 *    reads as "never seen".
 *
 * Restart is modeled as: close the DB handle, reopen the same file, rebuild
 * every client. Nothing in-process survives except the file.
 */
import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { buildWrCodeReference, captureWrCodeReference } from '@repo/ingestion-core'
import { WrcDirectoryClient } from '../namespaceDirectory'
import { deriveEntryDesignator, useLimitEntryKey } from '../entryDesignator'
import {
  createDbRelay,
  principalKeyFingerprint,
  type WrcRelayClient,
  type WrcRelayEnvelope,
  type WrcReleaseClaim,
} from '../relayRelease'
import {
  createDbAdmissionReplayStore,
  verifyCapsuleAdmission,
  type WrcAdmissionReplayStore,
} from '../capsuleAdmission'
import { openWrcSecurityDb, type WrcSecurityDb } from '../wrcSecurityDb'
import {
  buildPendingCapsule,
  buildPublisherFixture,
  createMultiFixtureTransport,
  makeClaimKey,
  makeKeyPair,
  signObject,
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

const NOW = 1_754_650_100
const INITIATOR = 'WR7X4K'
const RESPONDER = 'RCVPBX'
const RESPONDER_PARTY = 'party-9'

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
  ],
})

const responderFx = buildPublisherFixture({
  publisherPart: RESPONDER,
  domain: 'responder.test',
  entryId: 'RSPENT',
  ingestKey: INGEST,
  operatorKey: OPERATOR,
})

const C_REF = (() => {
  const r = buildWrCodeReference('C', [INITIATOR, RESPONDER])
  if (!r.ok) throw new Error(r.reason)
  return r.canonical
})()

const C_ENTRY_KEY = (() => {
  const captured = captureWrCodeReference(C_REF)
  if (!captured.ok) throw new Error(captured.reason)
  const derived = deriveEntryDesignator(
    captured,
    { cls: 'C', initiator_part: INITIATOR, counterparty_part: RESPONDER },
    'CREL01',
  )
  if (!derived.ok) throw new Error(derived.reason)
  return useLimitEntryKey(derived.designator)
})()

const claimKey = makeClaimKey('responder-principal-key')
const DELEGATION = signPrincipalDelegation(responderFx, {
  principalPartyId: RESPONDER_PARTY,
  ssoEmail: 'ceo@responder.test',
  principalPub: claimKey.principal_pub,
})

const initiatorPrincipal = makeKeyPair('initiator-principal-key')

function capsuleFor(capsuleId: string, requestInstanceId: string): Record<string, unknown> {
  return buildPendingCapsule({
    initiator: initiatorFx,
    initiatorPrincipal: { partyId: 'party-1', email: 'sales@publisher.test', key: initiatorPrincipal },
    recipient: {
      partyId: RESPONDER_PARTY,
      email: 'ceo@responder.test',
      encryptionPub: responderFx.encryption.pub,
    },
    capsuleId,
    requestInstanceId,
    expiresAt: NOW + 3600,
  }).capsule as unknown as Record<string, unknown>
}

function envelope(overrides: Partial<WrcRelayEnvelope> = {}): WrcRelayEnvelope {
  return {
    type: 'wrc/relay-envelope',
    capsule_id: 'cap-001',
    publisher_part: INITIATOR,
    entry_key: C_ENTRY_KEY,
    recipient: {
      party_id: RESPONDER_PARTY,
      publisher_part: RESPONDER,
      principal_key_fingerprint: principalKeyFingerprint(claimKey.principal_pub),
    },
    expires_at: NOW + 3600,
    status: 'available',
    capsule: capsuleFor('cap-001', 'req-1'),
    ...overrides,
  }
}

function signedClaim(overrides: Partial<WrcReleaseClaim> = {}): WrcReleaseClaim {
  const body = {
    type: 'wrc/release-claim' as const,
    capsule_id: 'cap-001',
    party_id: RESPONDER_PARTY,
    publisher_part: RESPONDER,
    request_instance_id: 'req-1',
    issued_at: NOW,
    principal_pub: claimKey.principal_pub,
    ...overrides,
  }
  return signObject(
    { ...body, sig: '' } as unknown as Record<string, unknown>,
    claimKey.key,
  ) as unknown as WrcReleaseClaim
}

let dir: string
let dbPath: string
let db: WrcSecurityDb

beforeEach(() => {
  if (!Database) return
  dir = mkdtempSync(join(tmpdir(), 'wrc-replay-'))
  dbPath = join(dir, 'wrc-security.db')
  db = openWrcSecurityDb(dbPath)
})

afterEach(() => {
  if (!Database) return
  try {
    db.close()
  } catch {
    /* closed by restart or by the DB-failure vector */
  }
  rmSync(dir, { recursive: true, force: true })
})

function restart(): WrcSecurityDb {
  db.close()
  db = openWrcSecurityDb(dbPath)
  return db
}

function relayOver(handle: WrcSecurityDb): WrcRelayClient {
  const transport = createMultiFixtureTransport([initiatorFx, responderFx])
  const directory = new WrcDirectoryClient({
    transport,
    operator: { kid: OPERATOR.kid, pub: OPERATOR.pub },
    now: () => NOW,
  })
  return createDbRelay(handle, {
    directoryKeys: async (part) => {
      const r = await directory.getVerifiedRecord(part)
      return r.ok ? r.record.keys : null
    },
    now: () => NOW,
  })
}

const release = (relay: WrcRelayClient, claim = signedClaim()) =>
  relay.release({ publisherPart: INITIATOR, entryKey: C_ENTRY_KEY, claim, delegation: DELEGATION })

// ── Slice 4: durable relay replay ledger ─────────────────────────────────────

describe.skipIf(!Database)('durable relay replay [XVI.7.5.9]', () => {
  it('first release succeeds; idempotent re-release; both survive restart', async () => {
    const relay = relayOver(db)
    relay.deposit(envelope())

    const first = await release(relay)
    expect(first.ok, first.ok ? '' : JSON.stringify(first)).toBe(true)

    // Same party + same request id: §XVI.7.5.9 idempotent re-release.
    const again = await release(relay)
    expect(again.ok).toBe(true)

    // Restart: the envelope AND the request binding are the file's now.
    const after = relayOver(restart())
    const reRelease = await release(after)
    expect(reRelease.ok).toBe(true)
    if (!reRelease.ok) return
    expect(reRelease.capsuleId).toBe('cap-001')
  })

  it('a foreign claimant on a used request id stays refused across restart (ledger level)', () => {
    const relay = relayOver(db)
    relay.deposit(envelope())
    // Bind through the durable ledger. (Through release(), leg 2 already
    // pins claimant = named recipient; the ledger must hold the same line
    // even against state written before a crash.)
    db.prepare(
      `INSERT INTO wrc_relay_request_ledger (capsule_id, request_instance_id, party_id, created_at)
       VALUES ('cap-001', 'req-1', 'party-9', ?)`,
    ).run(new Date().toISOString())

    const reopened = restart()
    const row = reopened
      .prepare(
        `SELECT party_id FROM wrc_relay_request_ledger WHERE capsule_id = 'cap-001' AND request_instance_id = 'req-1'`,
      )
      .get() as { party_id: string }
    expect(row.party_id).toBe('party-9')

    // INSERT-if-absent: a later claimant cannot re-bind the id.
    reopened
      .prepare(
        `INSERT INTO wrc_relay_request_ledger (capsule_id, request_instance_id, party_id, created_at)
         VALUES ('cap-001', 'req-1', 'party-8', ?)
         ON CONFLICT(capsule_id, request_instance_id) DO NOTHING`,
      )
      .run(new Date().toISOString())
    const settled = reopened
      .prepare(
        `SELECT party_id FROM wrc_relay_request_ledger WHERE capsule_id = 'cap-001' AND request_instance_id = 'req-1'`,
      )
      .get() as { party_id: string }
    expect(settled.party_id).toBe('party-9')
  })

  it('concurrent duplicate requests settle deterministically (both idempotent for the one named party)', async () => {
    const relay = relayOver(db)
    relay.deposit(envelope())
    const [a, b] = await Promise.all([release(relay), release(relay)])
    // The protocol PERMITS the named party an idempotent re-release; what it
    // forbids is two logically distinct grants — the ledger holds one row.
    expect(a.ok).toBe(true)
    expect(b.ok).toBe(true)
    const rows = db
      .prepare(`SELECT party_id FROM wrc_relay_request_ledger WHERE capsule_id = 'cap-001'`)
      .all() as Array<{ party_id: string }>
    expect(rows.length).toBe(1)
    expect(rows[0]!.party_id).toBe(RESPONDER_PARTY)
  })

  it('the same request id under a DIFFERENT capsule does not alias (per-capsule scope)', async () => {
    const relay = relayOver(db)
    relay.deposit(envelope())
    relay.deposit(
      envelope({
        capsule_id: 'cap-002',
        entry_key: `${C_ENTRY_KEY}#2`,
        capsule: capsuleFor('cap-002', 'req-1'),
      }),
    )
    expect((await release(relay)).ok).toBe(true)
    const second = await relay.release({
      publisherPart: INITIATOR,
      entryKey: `${C_ENTRY_KEY}#2`,
      claim: signedClaim({ capsule_id: 'cap-002' }),
      delegation: DELEGATION,
    })
    expect(second.ok, second.ok ? '' : JSON.stringify(second)).toBe(true)
  })

  it('withdrawal survives restart: a withdrawn capsule stays unreleasable', async () => {
    const relay = relayOver(db)
    relay.deposit(envelope())
    relay.setStatus('cap-001', 'withdrawn')

    const after = relayOver(restart())
    const r = await release(after)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.leg).toBe('capsule_withdrawn')
  })

  it('an expired capsule stays expired across restart', async () => {
    const relay = relayOver(db)
    relay.deposit(envelope({ expires_at: NOW - 1 }))
    const after = relayOver(restart())
    const r = await release(after)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.leg).toBe('capsule_expired')
  })

  it('a corrupted persisted envelope reads as ABSENT — capsule_unknown, no permissive parse', async () => {
    const relay = relayOver(db)
    relay.deposit(envelope())
    db.prepare(`UPDATE wrc_relay_envelope SET envelope_json = '{broken' WHERE capsule_id = 'cap-001'`).run()
    const r = await release(relay)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.leg).toBe('capsule_unknown')
  })

  it('a corrupted ledger row REFUSES the release (fail closed), never "never seen"', async () => {
    const relay = relayOver(db)
    relay.deposit(envelope())
    db.prepare(
      `INSERT INTO wrc_relay_request_ledger (capsule_id, request_instance_id, party_id, created_at)
       VALUES ('cap-001', 'req-1', '', ?)`,
    ).run(new Date().toISOString())
    await expect(release(relay)).rejects.toThrow(/ledger/)
  })

  it('an unavailable DB refuses the release — no silent memory degradation', async () => {
    const relay = relayOver(db)
    relay.deposit(envelope())
    db.close()
    await expect(release(relay)).rejects.toThrow()
  })
})

// ── Slice 5: durable Gate-6 request-id idempotency ───────────────────────────

function admit(
  capsule: Record<string, unknown>,
  replay: WrcAdmissionReplayStore,
  expectedInitiatorPart = INITIATOR,
) {
  return verifyCapsuleAdmission({
    capsule,
    expectedInitiatorPart,
    initiatorRecord: initiatorFx.directoryRecord,
    receiver: { party_id: RESPONDER_PARTY, email: 'ceo@responder.test' },
    decryptKey: responderFx.encryption.privateKey,
    replay,
    nowS: NOW,
  })
}

describe.skipIf(!Database)('durable Gate-6 request-id idempotency [XVI.7.6]', () => {
  it('success → same-process retry → the defined idempotent result', () => {
    const replay = createDbAdmissionReplayStore(db)
    const capsule = capsuleFor('cap-A', 'req-A')
    const first = admit(capsule, replay)
    expect(first.ok, first.ok ? '' : JSON.stringify(first)).toBe(true)
    if (!first.ok) return
    expect(first.idempotentReplay).toBe(false)

    const retry = admit(capsule, replay)
    expect(retry.ok).toBe(true)
    if (!retry.ok) return
    expect(retry.idempotentReplay).toBe(true)
    expect(retry.admitted.capsule_id).toBe('cap-A')
  })

  it('success → restart → retry idempotent; a DIFFERENT capsule under the same id stays refused', () => {
    const capsule = capsuleFor('cap-A', 'req-A')
    expect(admit(capsule, createDbAdmissionReplayStore(db)).ok).toBe(true)

    const reopened = restart()
    const replay = createDbAdmissionReplayStore(reopened)

    const retry = admit(capsule, replay)
    expect(retry.ok).toBe(true)
    if (!retry.ok) return
    expect(retry.idempotentReplay).toBe(true)

    // Same request id bound to a different capsule: refused, not deduplicated.
    const alias = admit(capsuleFor('cap-B', 'req-A'), replay)
    expect(alias.ok).toBe(false)
    if (alias.ok) return
    expect(alias.leg).toBe('request_replayed')
  })

  it('a Gate-6 failure persists NO row — no false success in the durable ledger', () => {
    const replay = createDbAdmissionReplayStore(db)
    const expired = buildPendingCapsule({
      initiator: initiatorFx,
      initiatorPrincipal: { partyId: 'party-1', email: 'sales@publisher.test', key: initiatorPrincipal },
      recipient: {
        partyId: RESPONDER_PARTY,
        email: 'ceo@responder.test',
        encryptionPub: responderFx.encryption.pub,
      },
      capsuleId: 'cap-X',
      requestInstanceId: 'req-X',
      expiresAt: NOW - 1,
    }).capsule as unknown as Record<string, unknown>

    const r = admit(expired, replay)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.leg).toBe('capsule_expired')

    const rows = db.prepare(`SELECT * FROM wrc_admission_request_ledger`).all()
    expect(rows.length).toBe(0)
  })

  it('the record-and-settle race: a concurrent binding to another capsule refuses the loser', () => {
    const durable = createDbAdmissionReplayStore(db)
    // Simulate the TOCTOU window: this admission read seen()=null, but a
    // concurrent admission bound the id to cap-A before our record landed.
    const racing: WrcAdmissionReplayStore = {
      seen: () => null,
      record: (id, capsuleId) => {
        durable.record(id, 'cap-A') // the concurrent winner lands first
        return durable.record(id, capsuleId)
      },
    }
    const r = admit(capsuleFor('cap-B', 'req-R'), racing)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.leg).toBe('request_replayed')

    // The durable ledger holds the winner, exactly once.
    const rows = db
      .prepare(`SELECT capsule_id FROM wrc_admission_request_ledger WHERE request_instance_id = 'req-R'`)
      .all() as Array<{ capsule_id: string }>
    expect(rows.length).toBe(1)
    expect(rows[0]!.capsule_id).toBe('cap-A')
  })

  it('a malformed persisted ledger row THROWS on read — unknown history refuses', () => {
    db.prepare(
      `INSERT INTO wrc_admission_request_ledger (request_instance_id, capsule_id, created_at)
       VALUES ('req-bad', '', ?)`,
    ).run(new Date().toISOString())
    const replay = createDbAdmissionReplayStore(db)
    expect(() => replay.seen('req-bad')).toThrow(/malformed/)
  })

  it('store-level settle semantics: first writer wins, before and after restart', () => {
    const replay = createDbAdmissionReplayStore(db)
    expect(replay.record('req-S', 'cap-A')).toBe('cap-A')
    expect(replay.record('req-S', 'cap-B')).toBe('cap-A')

    const after = createDbAdmissionReplayStore(restart())
    expect(after.seen('req-S')).toBe('cap-A')
    expect(after.record('req-S', 'cap-C')).toBe('cap-A')
  })
})
