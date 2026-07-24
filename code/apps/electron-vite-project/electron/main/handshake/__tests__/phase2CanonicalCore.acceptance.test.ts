/**
 * Phase 2 — Canonical Core: pipeline-level acceptance tests.
 *
 * Covers (per the Phase-2 brief):
 *  1. Replay compatibility — v2 capsules (no envelope) verify under legacy
 *     rules and are marked `legacy_v2`; new-format capsules that under-sign
 *     ANY consumed field are rejected [VII.6.1.3].
 *  2. Container semantics [VII.3.5] — unknown non-critical extension
 *     establishes; unknown critical extension refuses NAMING the namespace;
 *     container order + unknown entries survive a full round-trip
 *     byte-identically.
 *  4. Nonce/replay [VII.3.1] — a replayed core with a seen nonce is rejected.
 *
 * (3. canonical determinism lives in packages/ingestion-core/__tests__/
 *  canonical.test.ts; 5. key extraction in keyExtraction.test.ts;
 *  6. anti-rollback in antiRollback.test.ts.)
 *
 * Everything below flows through the REAL ingestion pipeline
 * (handleIngestionRPC → Gate-2 canonical rebuild → validator → enforcement),
 * on a real in-memory sqlite DB — no pipeline internals are mocked.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'

import { migrateHandshakeTables } from '../db'
import { migrateIngestionTables } from '../../ingestion/persistenceDb'
import { handleIngestionRPC } from '../../ingestion/ipc'
import { setEmailSendFn, _resetEmailSendFn } from '../emailTransport'
import { buildInitiateCapsuleWithKeypair } from '../capsuleBuilder'
import { buildTestSession } from '../sessionFactory'
import { HandshakeState, ReasonCode } from '../types'
import {
  attachCanonicalEnvelope,
  hasCanonicalEnvelope,
  verifyCanonicalEnvelope,
  CAPSULE_DECLARATION_NS,
} from '../canonicalCore'
import { canonicalJsonString } from '@repo/ingestion-core'
import type { CanonicalJsonValue, CorePartyId } from '@repo/ingestion-core'
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

interface AuditRow {
  action: string
  reason_code: string
  failed_step: string | null
  metadata: Record<string, unknown>
}

function auditRows(db: any, handshakeId: string): AuditRow[] {
  const rows = db
    .prepare(
      'SELECT action, reason_code, failed_step, metadata FROM audit_log WHERE handshake_id = ? ORDER BY rowid ASC',
    )
    .all(handshakeId) as Array<{ action: string; reason_code: string; failed_step: string | null; metadata: string | null }>
  return rows.map((r) => ({ ...r, metadata: r.metadata ? JSON.parse(r.metadata) : {} }))
}

function party(s: SSOSession): CorePartyId {
  return { sub: s.sub, iss: s.iss, email: s.email, wrdesk_user_id: s.wrdesk_user_id }
}

/** Strip the auto-attached envelope, returning the pure v2 capsule surface. */
function withoutEnvelope(capsule: Record<string, unknown>): Record<string, unknown> {
  const { wr_canonical_v3: _drop, ...rest } = capsule
  return rest
}

describe('Phase 2 — canonical core acceptance (real pipeline)', () => {
  const alice = session('p2alice')
  const bob = session('p2bob')

  beforeEach(() => {
    _resetEmailSendFn()
    setEmailSendFn(vi.fn().mockResolvedValue({ success: true, messageId: 'm1' }))
  })

  function buildInitiate(overrides?: { nonce?: string }) {
    return buildInitiateCapsuleWithKeypair(alice, {
      receiverUserId: bob.wrdesk_user_id,
      receiverEmail: bob.email,
      reciprocal_allowed: true,
      ...(overrides?.nonce ? { nonce: overrides.nonce } : {}),
    })
  }

  // ── Dual-format emission ────────────────────────────────────────────────────

  it('builder emits dual-format: v2 surface + signed canonical v3 envelope', () => {
    const { capsule, keypair } = buildInitiate()
    expect(hasCanonicalEnvelope(capsule as unknown as Record<string, unknown>)).toBe(true)

    const env = (capsule as unknown as Record<string, any>).wr_canonical_v3
    expect(env.v).toBe(3)
    expect(env.core.profile).toEqual({ id: 'legacy_v0', version: 1 })
    expect(env.core.ingress_path).toBeNull() // log-only, null on Phase-2 emissions
    expect(env.core.initiator_id).toEqual(party(alice))
    expect(env.core.responder_id).toBeNull()
    expect(env.core.nonce).toBe(capsule.nonce)
    expect(env.core.declarations[0].ns).toBe(CAPSULE_DECLARATION_NS)
    expect(env.core.declarations[0].critical).toBe(true)
    expect(env.signatures).toHaveLength(1)
    expect(env.signatures[0].mode).toBe('canonical_bytes')

    const verdict = verifyCanonicalEnvelope(capsule as unknown as Record<string, unknown>, keypair.publicKey)
    expect(verdict.ok).toBe(true)
  })

  it('v3 capsule establishes through the real pipeline, marked canonical_v3 in evidence', async () => {
    const db = makeDb()
    const { capsule } = buildInitiate()

    const result = await ingest(JSON.stringify(capsule), db, bob)
    expect(result.success).toBe(true)
    expect(result.handshake_result?.handshakeRecord?.state).toBe(HandshakeState.PENDING_REVIEW)

    const success = auditRows(db, capsule.handshake_id).find((r) => r.action === 'handshake_pipeline_success')
    expect(success).toBeTruthy()
    expect(success!.metadata.wire_format).toBe('canonical_v3')
  })

  // ── Acceptance 1: replay compatibility ──────────────────────────────────────

  it('stored v2 capsules (no envelope) verify under legacy rules, marked legacy_v2', async () => {
    const db = makeDb()
    const { capsule } = buildInitiate()
    const legacyOnly = withoutEnvelope(capsule as unknown as Record<string, unknown>)

    const result = await ingest(JSON.stringify(legacyOnly), db, bob)
    expect(result.success).toBe(true)
    expect(result.handshake_result?.handshakeRecord?.state).toBe(HandshakeState.PENDING_REVIEW)

    const success = auditRows(db, capsule.handshake_id).find((r) => r.action === 'handshake_pipeline_success')
    expect(success).toBeTruthy()
    expect(success!.metadata.wire_format).toBe('legacy_v2')
  })

  it('rejects a v3 capsule whose signed core omits a field present on the wire (under-signing)', async () => {
    const db = makeDb()
    const { capsule, keypair } = buildInitiate()
    const v2 = withoutEnvelope(capsule as unknown as Record<string, unknown>)

    // Sign a REDUCED capsule view (tierSignals dropped) but send the full wire:
    // the declaration then under-covers the wire — structurally what a partial
    // signature would produce. Must be rejected fail-closed.
    const { tierSignals: _omit, ...reduced } = v2
    const reducedSigned = attachCanonicalEnvelope(reduced, {
      initiator: party(alice),
      responder: null,
      createdAt: capsule.timestamp,
      nonce: capsule.nonce,
      privateKeyHex: keypair.privateKey,
      publicKeyHex: keypair.publicKey,
      signer: 'initiator',
    })
    const underSigned = { ...v2, wr_canonical_v3: reducedSigned.wr_canonical_v3 }

    const result = await ingest(JSON.stringify(underSigned), db, bob)
    expect(result.success).toBe(false)

    const denial = auditRows(db, capsule.handshake_id).find((r) => r.action === 'handshake_pipeline_denial')
    expect(denial).toBeTruthy()
    expect(denial!.reason_code).toBe(ReasonCode.CANONICAL_ENVELOPE_INVALID)
    expect(denial!.metadata.envelope_reason).toBe('under_signed_field:tierSignals')
  })

  it('rejects tampering of a field the LEGACY subset hash never covered (full coverage, A8)', async () => {
    const db = makeDb()
    const { capsule } = buildInitiate()

    // tierSignals is OUTSIDE the legacy capsule_hash subset — under v2 rules
    // this tampering is invisible. The canonical envelope must catch it.
    const tampered = JSON.parse(JSON.stringify(capsule))
    tampered.tierSignals.plan = 'pro'

    const result = await ingest(JSON.stringify(tampered), db, bob)
    expect(result.success).toBe(false)

    const denial = auditRows(db, capsule.handshake_id).find((r) => r.action === 'handshake_pipeline_denial')
    expect(denial).toBeTruthy()
    expect(denial!.reason_code).toBe(ReasonCode.CANONICAL_ENVELOPE_INVALID)
    expect(denial!.metadata.envelope_reason).toBe('binding_mismatch:tierSignals')

    // Control: the SAME tampering on the legacy-only surface sails through v2
    // verification — proving the envelope is what closed the gap.
    const db2 = makeDb()
    const legacyTampered = withoutEnvelope(tampered)
    const legacyResult = await ingest(JSON.stringify(legacyTampered), db2, bob)
    expect(legacyResult.success).toBe(true)
  })

  it('rejects a v3 capsule whose core bytes were altered after signing', async () => {
    const db = makeDb()
    const { capsule } = buildInitiate()
    const tampered = JSON.parse(JSON.stringify(capsule))
    tampered.wr_canonical_v3.core.created_at = new Date(Date.now() + 1000).toISOString()

    const result = await ingest(JSON.stringify(tampered), db, bob)
    expect(result.success).toBe(false)

    const denial = auditRows(db, capsule.handshake_id).find((r) => r.action === 'handshake_pipeline_denial')
    expect(denial).toBeTruthy()
    expect(denial!.reason_code).toBe(ReasonCode.CANONICAL_ENVELOPE_INVALID)
    expect(String(denial!.metadata.envelope_reason)).toMatch(/^signature_invalid:/)
  })

  it('rejects a v3 envelope signed by a key other than the pinned sender key', () => {
    const { capsule } = buildInitiate()
    const otherKey = 'a'.repeat(64)
    const verdict = verifyCanonicalEnvelope(capsule as unknown as Record<string, unknown>, otherKey)
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.reason).toBe('no_full_coverage_signature_from_sender_key')
  })

  // ── Acceptance 2: container semantics [VII.3.5] ─────────────────────────────

  function rebuildWithExtensions(extensions: Array<Record<string, unknown>>) {
    const { capsule, keypair } = buildInitiate()
    const v2 = withoutEnvelope(capsule as unknown as Record<string, unknown>)
    const withExt = attachCanonicalEnvelope(v2, {
      initiator: party(alice),
      responder: null,
      createdAt: capsule.timestamp,
      nonce: capsule.nonce,
      extensions: extensions as any,
      privateKeyHex: keypair.privateKey,
      publicKeyHex: keypair.publicKey,
      signer: 'initiator',
    })
    return { capsule: withExt, keypair, handshakeId: capsule.handshake_id as string }
  }

  it('establishes with an unknown NON-critical extension (preserve and ignore)', async () => {
    const db = makeDb()
    const unknownEntry = {
      ns: 'com.vendor.future-feature',
      version: 7,
      critical: false,
      payload: { anything: ['goes', 'here'], nested: { deep: true } },
    }
    const { capsule, keypair, handshakeId } = rebuildWithExtensions([unknownEntry])

    const verdict = verifyCanonicalEnvelope(capsule, keypair.publicKey)
    expect(verdict.ok).toBe(true)
    if (verdict.ok) expect(verdict.ignoredNamespaces).toContain('com.vendor.future-feature')

    const result = await ingest(JSON.stringify(capsule), db, bob)
    expect(result.success).toBe(true)
    expect(result.handshake_result?.handshakeRecord?.state).toBe(HandshakeState.PENDING_REVIEW)

    const success = auditRows(db, handshakeId).find((r) => r.action === 'handshake_pipeline_success')
    expect(success!.metadata.wire_format).toBe('canonical_v3')
  })

  it('refuses with an unknown CRITICAL extension, naming the namespace', async () => {
    const db = makeDb()
    const criticalEntry = {
      ns: 'com.vendor.mandatory-thing',
      version: 1,
      critical: true,
      payload: { must: 'understand' },
    }
    const { capsule, handshakeId } = rebuildWithExtensions([criticalEntry])

    const result = await ingest(JSON.stringify(capsule), db, bob)
    expect(result.success).toBe(false)

    const denial = auditRows(db, handshakeId).find((r) => r.action === 'handshake_pipeline_denial')
    expect(denial).toBeTruthy()
    expect(denial!.reason_code).toBe(ReasonCode.UNKNOWN_CRITICAL_EXTENSION)
    expect(denial!.metadata.refused_namespace).toBe('com.vendor.mandatory-thing')

    // The refusal must be pre-visibility: no relationship row exists.
    const row = db.prepare('SELECT 1 FROM handshakes WHERE handshake_id = ?').get(handshakeId)
    expect(row).toBeUndefined()
  })

  it('container order and unknown entries survive a full round-trip byte-identically', () => {
    const entries = [
      { ns: 'com.vendor.zzz', version: 2, critical: false, payload: { b: 2, a: 1 } },
      { ns: 'com.vendor.aaa', version: 1, critical: false, payload: [3, 1, 2] },
      { ns: 'optirando.transport.p2p', version: 1, critical: false, payload: { endpoint: 'x' }, vendor_extra: 'kept' },
    ]
    const { capsule } = rebuildWithExtensions(entries)

    // Wire round-trip (serialize → parse → serialize) — the transport path.
    const roundTripped = JSON.parse(JSON.stringify(capsule))
    expect(
      canonicalJsonString(roundTripped.wr_canonical_v3 as CanonicalJsonValue),
    ).toBe(canonicalJsonString((capsule as Record<string, any>).wr_canonical_v3 as CanonicalJsonValue))

    // Order preserved verbatim, unknown sibling field preserved.
    const ext = roundTripped.wr_canonical_v3.core.extensions
    expect(ext.map((e: any) => e.ns)).toEqual(['com.vendor.zzz', 'com.vendor.aaa', 'optirando.transport.p2p'])
    expect(ext[2].vendor_extra).toBe('kept')
  })

  // ── Acceptance 4: nonce/replay [VII.3.1] ────────────────────────────────────

  it('rejects a replayed core: seen nonce arriving with different capsule content', async () => {
    const db = makeDb()
    const { capsule: first } = buildInitiate()
    const firstResult = await ingest(JSON.stringify(first), db, bob)
    expect(firstResult.success).toBe(true)

    // Fresh capsule (new handshake_id, new content) but the SAME nonce —
    // spent freshness reused for a different object.
    const { capsule: replayed } = buildInitiate({ nonce: first.nonce })
    expect(replayed.handshake_id).not.toBe(first.handshake_id)
    expect(replayed.capsule_hash).not.toBe(first.capsule_hash)

    const replayResult = await ingest(JSON.stringify(replayed), db, bob)
    expect(replayResult.success).toBe(false)

    const denial = auditRows(db, replayed.handshake_id).find((r) => r.action === 'handshake_pipeline_denial')
    expect(denial).toBeTruthy()
    expect(denial!.reason_code).toBe(ReasonCode.NONCE_REPLAY)

    // Pre-visibility: the replayed handshake never materialized.
    const row = db.prepare('SELECT 1 FROM handshakes WHERE handshake_id = ?').get(replayed.handshake_id)
    expect(row).toBeUndefined()
  })

  it('idempotent redelivery of the SAME capsule is not a nonce replay (dedup owns it)', async () => {
    const db = makeDb()
    const { capsule } = buildInitiate()
    const first = await ingest(JSON.stringify(capsule), db, bob)
    expect(first.success).toBe(true)

    const second = await ingest(JSON.stringify(capsule), db, bob)
    // Redelivery must NOT be misclassified as a replayed core.
    const denials = auditRows(db, capsule.handshake_id).filter((r) => r.action === 'handshake_pipeline_denial')
    for (const d of denials) expect(d.reason_code).not.toBe(ReasonCode.NONCE_REPLAY)
    // Whatever the dedup verdict, the original relationship is intact.
    const row = db.prepare('SELECT state FROM handshakes WHERE handshake_id = ?').get(capsule.handshake_id)
    expect(row).toBeTruthy()
    void second
  })

  // ── Party binding (full-claim guard extended into the signed core) ──────────

  it('rejects a v3 capsule whose senderIdentity is not a signed core party', () => {
    const { capsule, keypair } = buildInitiate()
    const v2 = withoutEnvelope(capsule as unknown as Record<string, unknown>)

    const mallory: CorePartyId = {
      sub: 'mallory',
      iss: alice.iss,
      email: 'mallory@dev.test',
      wrdesk_user_id: 'mallory',
    }
    const forged = attachCanonicalEnvelope(v2, {
      initiator: mallory,
      responder: null,
      createdAt: capsule.timestamp,
      nonce: capsule.nonce,
      privateKeyHex: keypair.privateKey,
      publicKeyHex: keypair.publicKey,
      signer: 'initiator',
    })

    const verdict = verifyCanonicalEnvelope(forged, keypair.publicKey)
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.reason).toBe('sender_identity_not_bound_to_core_party')
  })
})
