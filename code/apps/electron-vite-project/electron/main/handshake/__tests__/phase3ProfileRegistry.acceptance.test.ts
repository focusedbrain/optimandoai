/**
 * Phase 3 — Profile registry & fail-closed dispatch: acceptance tests.
 *
 * 1. Unknown-profile refusal [VII.4.2] — unknown profile id and unsupported
 *    profile version each produce a visible refusal NAMING the profile; no
 *    fallback path exists.
 * 2. Schema-level attestation rejection [VII.4.5] — a `private_personal`
 *    core carrying a publisher_attestation block is rejected by schema, not
 *    by UI; `pbeap_publisher` without one is likewise rejected.
 * 3. Countersignature gate [VII.3.2] — for `org_internal`/`org_cross`, only
 *    a DOUBLY signed byte-identical core counts as established; a
 *    countersignature over differing bytes is rejected; the same key twice
 *    does not satisfy cardinality 2.
 *
 * Pipeline-level cases run through the REAL ingestion pipeline on an
 * in-memory sqlite DB (same harness as phase2CanonicalCore.acceptance).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { createPrivateKey, createPublicKey, randomBytes } from 'node:crypto'

import { migrateHandshakeTables } from '../db'
import { migrateIngestionTables } from '../../ingestion/persistenceDb'
import { handleIngestionRPC } from '../../ingestion/ipc'
import { setEmailSendFn, _resetEmailSendFn } from '../emailTransport'
import { buildInitiateCapsuleWithKeypair } from '../capsuleBuilder'
import { buildTestSession } from '../sessionFactory'
import { ReasonCode } from '../types'
import {
  buildCoreForCapsule,
  signCore,
  verifyCanonicalEnvelope,
} from '../canonicalCore'
import {
  resolveProfile,
  listProfileRecords,
  PUBLISHER_ATTESTATION_NS,
  WR_CANONICAL_SCHEMA_VERSION,
} from '@repo/ingestion-core'
import type { CorePartyId, CoreSignature, WrHandshakeCore } from '@repo/ingestion-core'
import type { SSOSession } from '../types'

function session(user: string): SSOSession {
  return buildTestSession({ wrdesk_user_id: user, sub: user, email: `${user}@dev.test` })
}

function makeDb(): any {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  migrateHandshakeTables(db)
  migrateIngestionTables(db)
  return db
}

function ingest(capsuleJson: string, db: any, asSession: SSOSession) {
  return handleIngestionRPC(
    'ingestion.ingest',
    {
      rawInput: { body: capsuleJson, mime_type: 'application/vnd.beap+json' },
      sourceType: 'email',
      transportMeta: { channel_id: 'relay:test', mime_type: 'application/vnd.beap+json' },
    },
    db,
    asSession,
  )
}

function auditDenial(db: any, handshakeId: string) {
  const row = db
    .prepare(
      "SELECT reason_code, metadata FROM audit_log WHERE handshake_id = ? AND action = 'handshake_pipeline_denial' ORDER BY rowid DESC LIMIT 1",
    )
    .get(handshakeId) as { reason_code: string; metadata: string | null } | undefined
  return row ? { reason_code: row.reason_code, metadata: row.metadata ? JSON.parse(row.metadata) : {} } : null
}

function party(s: SSOSession): CorePartyId {
  return { sub: s.sub, iss: s.iss, email: s.email, wrdesk_user_id: s.wrdesk_user_id }
}

/** Fresh Ed25519 keypair as (seed hex, raw public key hex) — pub derived FROM the seed. */
function mkKeys(): { privateKey: string; publicKey: string } {
  const seed = randomBytes(32)
  const pkcs8 = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed])
  const privateKey = createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' })
  const spki = createPublicKey(privateKey).export({ format: 'der', type: 'spki' }) as Buffer
  return { privateKey: seed.toString('hex'), publicKey: spki.subarray(spki.length - 32).toString('hex') }
}

const alice = session('p3alice')
const bob = session('p3bob')

function buildInitiate() {
  return buildInitiateCapsuleWithKeypair(alice, {
    receiverUserId: bob.wrdesk_user_id,
    receiverEmail: bob.email,
    reciprocal_allowed: true,
  })
}

/**
 * Build a capsule whose v3 envelope carries an ARBITRARY profile + signature
 * list (the production builder always emits legacy_v0 — these fixtures
 * exercise the dispatcher).
 */
function capsuleWithProfile(args: {
  profile: { id: string; version: number }
  extensions?: Array<Record<string, unknown>>
  extraSigners?: Array<{ keys: { privateKey: string; publicKey: string }; mode: CoreSignature['mode'] }>
  mutateCoreForCountersig?: (core: WrHandshakeCore) => WrHandshakeCore
}) {
  const { capsule, keypair } = buildInitiate()
  const { wr_canonical_v3: _drop, ...v2 } = capsule as unknown as Record<string, unknown>
  const core = buildCoreForCapsule(v2, {
    initiator: party(alice),
    responder: null,
    createdAt: capsule.timestamp,
    nonce: capsule.nonce,
    extensions: (args.extensions ?? []) as any,
  })
  ;(core as any).profile = { ...args.profile }
  const signatures: CoreSignature[] = [
    signCore(core, keypair.privateKey, keypair.publicKey, 'initiator', 'canonical_bytes'),
  ]
  for (const extra of args.extraSigners ?? []) {
    const target = args.mutateCoreForCountersig ? args.mutateCoreForCountersig(core) : core
    signatures.push(signCore(target, extra.keys.privateKey, extra.keys.publicKey, 'responder', extra.mode))
  }
  const wire = { ...v2, wr_canonical_v3: { v: WR_CANONICAL_SCHEMA_VERSION, core, signatures } }
  return { wire, keypair, handshakeId: capsule.handshake_id as string }
}

describe('Phase 3 — acceptance 1: unknown-profile refusal [VII.4.2]', () => {
  beforeEach(() => {
    _resetEmailSendFn()
    setEmailSendFn(vi.fn().mockResolvedValue({ success: true, messageId: 'm1' }))
  })

  it('registry dispatch is fail-closed: unknown id and unsupported version both refuse, naming the profile', () => {
    const unknown = resolveProfile('conjured_profile', 1)
    expect(unknown.ok).toBe(false)
    if (!unknown.ok) {
      expect(unknown.reason).toBe('unknown_profile')
      expect(unknown.profileId).toBe('conjured_profile')
    }
    const badVersion = resolveProfile('legacy_v0', 99)
    expect(badVersion.ok).toBe(false)
    if (!badVersion.ok) expect(badVersion.reason).toBe('unsupported_profile_version')

    // The five briefed records plus the Phase-4 (Q9) `internal_device`
    // profile (same-principal Cross-Device pairing).
    expect(listProfileRecords().map((r) => r.id).sort()).toEqual([
      'internal_device',
      'legacy_v0',
      'org_cross',
      'org_internal',
      'pbeap_publisher',
      'private_personal',
    ])
  })

  it('envelope with an unknown profile id is refused with the profile named', () => {
    const { wire, keypair } = capsuleWithProfile({ profile: { id: 'conjured_profile', version: 1 } })
    const verdict = verifyCanonicalEnvelope(wire, keypair.publicKey)
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) {
      expect(verdict.reason).toBe('unknown_profile:conjured_profile@1')
      expect(verdict.refusedProfile).toEqual({ id: 'conjured_profile', version: 1 })
    }
  })

  it('envelope with an unsupported profile version is refused with the profile named', () => {
    const { wire, keypair } = capsuleWithProfile({ profile: { id: 'private_personal', version: 42 } })
    const verdict = verifyCanonicalEnvelope(wire, keypair.publicKey)
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) {
      expect(verdict.reason).toBe('unsupported_profile_version:private_personal@42')
      expect(verdict.refusedProfile).toEqual({ id: 'private_personal', version: 42 })
    }
  })

  it('pipeline: unknown profile dies pre-visibility with UNKNOWN_PROFILE and the profile in evidence', async () => {
    const db = makeDb()
    const { wire, handshakeId } = capsuleWithProfile({ profile: { id: 'conjured_profile', version: 1 } })

    const result = await ingest(JSON.stringify(wire), db, bob)
    expect(result.success).toBe(false)

    const denial = auditDenial(db, handshakeId)
    expect(denial).toBeTruthy()
    expect(denial!.reason_code).toBe(ReasonCode.UNKNOWN_PROFILE)
    expect(denial!.metadata.refused_profile).toBe('conjured_profile@1')

    // No fallback path: the relationship never materialized.
    expect(db.prepare('SELECT 1 FROM handshakes WHERE handshake_id = ?').get(handshakeId)).toBeUndefined()
  })
})

describe('Phase 3 — acceptance 2: schema-level attestation rejection [VII.4.5]', () => {
  beforeEach(() => {
    _resetEmailSendFn()
    setEmailSendFn(vi.fn().mockResolvedValue({ success: true, messageId: 'm1' }))
  })

  const attestationEntry = {
    ns: PUBLISHER_ATTESTATION_NS,
    version: 1,
    critical: false,
    payload: { stamp: 'publisher-stamp' },
  }

  it('private_personal core carrying a publisher_attestation block is rejected by schema', () => {
    const { wire, keypair } = capsuleWithProfile({
      profile: { id: 'private_personal', version: 1 },
      extensions: [attestationEntry],
    })
    const verdict = verifyCanonicalEnvelope(wire, keypair.publicKey)
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) {
      expect(verdict.reason).toBe('attestation_forbidden_for_profile:private_personal')
      expect(verdict.refusedProfile).toEqual({ id: 'private_personal', version: 1 })
    }
  })

  it('pbeap_publisher core WITHOUT an attestation block is rejected (mandatory)', () => {
    const { wire, keypair } = capsuleWithProfile({ profile: { id: 'pbeap_publisher', version: 1 } })
    const verdict = verifyCanonicalEnvelope(wire, keypair.publicKey)
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.reason).toBe('attestation_missing_for_profile:pbeap_publisher')
  })

  it('pipeline: forbidden attestation maps to PROFILE_SCHEMA_VIOLATION pre-visibility', async () => {
    const db = makeDb()
    const { wire, handshakeId } = capsuleWithProfile({
      profile: { id: 'private_personal', version: 1 },
      extensions: [attestationEntry],
    })
    const result = await ingest(JSON.stringify(wire), db, bob)
    expect(result.success).toBe(false)

    const denial = auditDenial(db, handshakeId)
    expect(denial).toBeTruthy()
    expect(denial!.reason_code).toBe(ReasonCode.PROFILE_SCHEMA_VIOLATION)
    expect(db.prepare('SELECT 1 FROM handshakes WHERE handshake_id = ?').get(handshakeId)).toBeUndefined()
  })
})

describe('Phase 3 — acceptance 3: countersignature gate [VII.3.2]', () => {
  it('org_internal with a single signature does not count as established (cardinality 2)', () => {
    const { wire, keypair } = capsuleWithProfile({ profile: { id: 'org_internal', version: 1 } })
    const verdict = verifyCanonicalEnvelope(wire, keypair.publicKey)
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) {
      expect(verdict.reason).toBe('signature_cardinality_unmet:1<2')
      expect(verdict.refusedProfile).toEqual({ id: 'org_internal', version: 1 })
    }
  })

  it('org_internal doubly signed over the byte-identical core verifies', () => {
    const responderKeys = mkKeys()
    const { wire, keypair } = capsuleWithProfile({
      profile: { id: 'org_internal', version: 1 },
      extraSigners: [{ keys: responderKeys, mode: 'canonical_hash' }],
    })
    const verdict = verifyCanonicalEnvelope(wire, keypair.publicKey)
    if (!verdict.ok) throw new Error(`refused: ${verdict.reason}`)
    expect(verdict.ok).toBe(true)
  })

  it('org_cross doubly signed over the byte-identical core verifies', () => {
    const responderKeys = mkKeys()
    const { wire, keypair } = capsuleWithProfile({
      profile: { id: 'org_cross', version: 1 },
      extraSigners: [{ keys: responderKeys, mode: 'canonical_hash' }],
    })
    const verdict = verifyCanonicalEnvelope(wire, keypair.publicKey)
    if (!verdict.ok) throw new Error(`refused: ${verdict.reason}`)
    expect(verdict.ok).toBe(true)
  })

  it('a countersignature over DIFFERING bytes is rejected', () => {
    const responderKeys = mkKeys()
    const { wire, keypair } = capsuleWithProfile({
      profile: { id: 'org_internal', version: 1 },
      extraSigners: [{ keys: responderKeys, mode: 'canonical_hash' }],
      // Responder signs a core whose created_at differs by 1ms — NOT the
      // byte-identical core the initiator signed.
      mutateCoreForCountersig: (core) => ({
        ...core,
        created_at: new Date(Date.parse(core.created_at) + 1).toISOString(),
      }),
    })
    const verdict = verifyCanonicalEnvelope(wire, keypair.publicKey)
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.reason).toBe('signature_invalid:responder:canonical_hash')
  })

  it('the same key twice does not satisfy cardinality 2 (distinct signers required)', () => {
    const { wire, keypair } = capsuleWithProfile({ profile: { id: 'org_internal', version: 1 } })
    // Duplicate the initiator signature as a fake "responder" countersig.
    const env = (wire as any).wr_canonical_v3
    env.signatures = [
      env.signatures[0],
      { ...env.signatures[0], signer: 'responder' },
    ]
    const verdict = verifyCanonicalEnvelope(wire, keypair.publicKey)
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.reason).toBe('signature_cardinality_unmet:1<2')
  })
})
