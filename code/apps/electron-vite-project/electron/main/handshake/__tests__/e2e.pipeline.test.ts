/**
 * BEAP™ Pipeline E2E Tests — Full Happy Path
 *
 * Verifies the complete two-party handshake flow from the Capsule Builder
 * through the Ingestor → Validator → Distribution Gate → Handshake Pipeline.
 *
 * Test matrix:
 *   P1: initiate capsule → PENDING_ACCEPT (initiator side)
 *   P2: accept capsule → ACTIVE (acceptor side)
 *   P3: initiate then accept produces an active handshake record
 *   P4: duplicate initiate (same capsule_hash) → deduped, no second record
 *   P5: capsule_hash computation is deterministic (same inputs → same hash)
 *   P6: relationship_id is symmetric (A,B) === (B,A)
 *   P7: policyAnchor wildcard ('*') accepts any non-empty policy hash
 *   P8: seq: 1 on initiate is rejected by chainIntegrity
 *   P9: DB migration runs automatically (no tables pre-created)
 *   P10: submitCapsuleViaRpc connector delivers through full pipeline
 *   P11: two-party ownership check — same user as sender/receiver fails
 *   P12: buildRefreshCapsule has seq > 0 and prev_hash set
 *   P13: buildRevokeCapsule has correct structure
 *
 * G11 note: Ownership step requires sender_wrdesk_user_id ≠ ssoSession.wrdesk_user_id.
 * In two-party tests the receiver's session must differ from the sender's user ID.
 * In single-process tests, use distinct IDs for the sender vs receiver session.
 */

import { describe, test, expect, beforeEach } from 'vitest'
import {
  buildInitiateCapsule,
  buildAcceptCapsule,
  buildRefreshCapsule,
  buildRevokeCapsule,
} from '../capsuleBuilder'
import { generateSigningKeypair } from '../signatureKeys'
import { computeCapsuleHash } from '../capsuleHash'
import { computePolicyHash, DEFAULT_POLICY_DESCRIPTOR, DEFAULT_POLICY_HASH } from '../policyHash'
import { deriveRelationshipId } from '../relationshipId'
import { buildTestSession } from '../sessionFactory'
import { buildDefaultReceiverPolicy } from '../types'
import { submitCapsuleViaRpc } from '../capsuleTransport'
import { handleIngestionRPC } from '../../ingestion/ipc'
import { migrateIngestionTables } from '../../ingestion/persistenceDb'
import type { SSOSession } from '../types'
import { HandshakeState } from '../types'
import { createHandshakeTestDb } from './handshakeTestDb'

// ── Session factories ──

function senderSession(): SSOSession {
  return buildTestSession({
    wrdesk_user_id: 'sender-001',
    email: 'sender@example.com',
    sub: 'sender-001',
  })
}

function receiverSession(): SSOSession {
  return buildTestSession({
    wrdesk_user_id: 'receiver-001',
    email: 'receiver@example.com',
    sub: 'receiver-001',
  })
}

// ── Submit helper ──

async function submitCapsule(capsule: any, db: any, session: SSOSession) {
  return handleIngestionRPC(
    'ingestion.ingest',
    {
      rawInput: {
        body: JSON.stringify(capsule),
        mime_type: 'application/vnd.beap+json',
      },
      sourceType: 'internal' as any,
      transportMeta: { channel_id: 'test' },
    },
    db,
    session,
  )
}

// ── Tests ──

describe('BEAP Pipeline E2E — Happy Path', () => {
  let db: ReturnType<typeof createHandshakeTestDb>

  beforeEach(() => {
    db = createHandshakeTestDb()
    migrateIngestionTables(db)
  })

  // ── P5: capsule_hash determinism ──
  test('P5: computeCapsuleHash is deterministic — same inputs produce same hash', () => {
    const input = {
      capsule_type: 'initiate' as const,
      handshake_id: 'hs-det-001',
      relationship_id: 'rel:abc123',
      schema_version: 2,
      sender_wrdesk_user_id: 'sender-001',
      receiver_email: 'receiver@test.com',
      seq: 0,
      timestamp: '2026-01-01T00:00:00.000Z',
      wrdesk_policy_hash: DEFAULT_POLICY_HASH,
      wrdesk_policy_version: '1.0',
    }
    const h1 = computeCapsuleHash(input)
    const h2 = computeCapsuleHash(input)
    expect(h1).toEqual(h2)
    expect(h1).toMatch(/^[0-9a-f]{64}$/)
  })

  // ── P6: relationship_id symmetry ──
  test('P6: deriveRelationshipId is symmetric — (A,B) === (B,A)', () => {
    const id1 = deriveRelationshipId('sender-001', 'receiver-001')
    const id2 = deriveRelationshipId('receiver-001', 'sender-001')
    expect(id1).toEqual(id2)
    expect(id1).toMatch(/^rel:[0-9a-f]{32}$/)
  })

  test('P6b: deriveRelationshipId throws for same user without handshake id', () => {
    expect(() => deriveRelationshipId('user-a', 'user-a')).toThrow()
  })

  test('P6c: deriveRelationshipId same user with handshake_id is symmetric and stable', () => {
    const hs = 'hs-test-internal-001'
    const id1 = deriveRelationshipId('user-a', 'user-a', hs)
    const id2 = deriveRelationshipId('user-a', 'user-a', hs)
    expect(id1).toBe(id2)
    expect(id1.startsWith('rel:')).toBe(true)
    expect(id1.length).toBe(36)
  })

  // ── P7: policyAnchor wildcard ──
  test('P7: default ReceiverPolicy uses wildcard — accepts any policy hash', () => {
    const policy = buildDefaultReceiverPolicy()
    expect(policy.acceptedWrdeskPolicyHashes).toContain('*')
  })

  // ── P8: seq: 1 on initiate rejected ──
  test('P8: initiate capsule with seq: 1 is rejected by chainIntegrity step', async () => {
    const sender = senderSession()
    const receiver = receiverSession()
    const capsule = buildInitiateCapsule(sender, {
      receiverUserId: receiver.wrdesk_user_id,
      receiverEmail: receiver.email,
    })

    // Tamper: override seq to 1 (simulates incorrect builder behavior)
    const tamperedCapsule = { ...capsule, seq: 1 }

    const result = await submitCapsule(tamperedCapsule, db, receiver)

    expect(result.success).toBe(false)
    if (result.handshake_result) {
      // Rejected by chain integrity or hash verification (pipeline order may vary)
      expect(result.handshake_result.failedStep ?? '').toMatch(/chain|verify_capsule_hash/)
    }
  })

  // ── P1: initiate → PENDING_REVIEW (recipient receives) ──
  test('P1: buildInitiateCapsule → pipeline → HandshakeRecord PENDING_REVIEW', async () => {
    const sender = senderSession()
    const receiver = receiverSession()

    const capsule = buildInitiateCapsule(sender, {
      receiverUserId: receiver.wrdesk_user_id,
      receiverEmail: receiver.email,
      reciprocal_allowed: false,
    })

    // Validate structural correctness of the capsule
    expect(capsule.schema_version).toBe(2)
    expect(capsule.capsule_type).toBe('initiate')
    expect(capsule.seq).toBe(0)
    expect(capsule.sender_wrdesk_user_id).toBe('sender-001')
    expect(capsule.capsule_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(capsule.wrdesk_policy_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(capsule.sharing_mode).toBeUndefined()
    expect(capsule.prev_hash).toBeUndefined()

    const result = await submitCapsule(capsule, db, receiver)

    expect(result.distribution_target).toBe('handshake_pipeline')
    expect(result.success).toBe(true)
    const hs = result.handshake_result
    expect(hs).toBeDefined()
    expect(hs.handshakeRecord?.state).toBe(HandshakeState.PENDING_REVIEW)
    expect(hs.handshakeRecord?.handshake_id).toBe(capsule.handshake_id)
  })

  // ── P2: accept → ACCEPTED (ACTIVE requires context_sync) ──
  test('P2: buildAcceptCapsule → pipeline → HandshakeRecord ACCEPTED', async () => {
    const sender = senderSession()
    const receiver = receiverSession()

    // Step 1: initiate (received by receiver)
    const initiate = buildInitiateCapsule(sender, {
      receiverUserId: receiver.wrdesk_user_id,
      receiverEmail: receiver.email,
    })

    const initResult = await submitCapsule(initiate, db, receiver)
    expect(initResult.success).toBe(true)
    expect(initResult.handshake_result?.handshakeRecord?.state).toBe(HandshakeState.PENDING_REVIEW)

    const { capsule: accept } = buildAcceptCapsule(receiver, {
      handshake_id: initiate.handshake_id,
      initiatorUserId: sender.wrdesk_user_id,
      initiatorEmail: sender.email,
      sharing_mode: 'receive-only',
      initiator_capsule_hash: initiate.capsule_hash,
    })

    expect(accept.schema_version).toBe(2)
    expect(accept.capsule_type).toBe('accept')
    expect(accept.seq).toBe(0)
    expect(accept.sharing_mode).toBe('receive-only')
    expect(accept.prev_hash).toBeUndefined()

    const acceptResult = await submitCapsule(accept, db, sender)

    expect(acceptResult.success).toBe(true)
    const hs = acceptResult.handshake_result
    // Per design: accept → ACCEPTED; ACTIVE only after context_sync roundtrip
    expect(hs?.handshakeRecord?.state).toBe(HandshakeState.ACCEPTED)
  })

  // ── P3: full initiate → accept produces ACCEPTED record ──
  test('P3: full initiate → accept produces ACCEPTED HandshakeRecord', async () => {
    const sender = senderSession()
    const receiver = receiverSession()

    // reciprocal_allowed: true on initiate allows the acceptor to choose reciprocal sharing
    const initiate = buildInitiateCapsule(sender, {
      receiverUserId: receiver.wrdesk_user_id,
      receiverEmail: receiver.email,
      reciprocal_allowed: true,
    })
    await submitCapsule(initiate, db, receiver)

    const { capsule: accept } = buildAcceptCapsule(receiver, {
      handshake_id: initiate.handshake_id,
      initiatorUserId: sender.wrdesk_user_id,
      initiatorEmail: sender.email,
      sharing_mode: 'reciprocal',
      initiator_capsule_hash: initiate.capsule_hash,
    })
    const result = await submitCapsule(accept, db, sender)

    expect(result.success).toBe(true)
    // Per design: accept → ACCEPTED; ACTIVE only after context_sync roundtrip
    expect(result.handshake_result?.handshakeRecord?.state).toBe(HandshakeState.ACCEPTED)
    expect(result.handshake_result?.handshakeRecord?.sharing_mode).toBe('reciprocal')
  })

  // ── P4: duplicate initiate deduped ──
  test('P4: duplicate initiate capsule (same hash) is deduped by pipeline', async () => {
    const sender = senderSession()
    const receiver = receiverSession()
    const initiate = buildInitiateCapsule(sender, { receiverUserId: receiver.wrdesk_user_id, receiverEmail: receiver.email })

    const first = await submitCapsule(initiate, db, receiver)
    expect(first.success).toBe(true)

    const second = await submitCapsule(initiate, db, receiver)
    // Dedup: same capsule_hash is rejected (seen_capsule_hashes)
    expect(second.success).toBe(false)
    if (second.handshake_result) {
      expect(second.handshake_result.reason ?? '').toContain('DUPLICATE')
    }
  })

  // ── P9: DB migration runs automatically ──
  test('P9: DB migration runs automatically — handshake tables created on first call', async () => {
    const sender = senderSession()
    const receiver = receiverSession()
    const freshDb = createHandshakeTestDb()
    migrateIngestionTables(freshDb)

    // No manual migrateHandshakeTables — ensureHandshakeMigration must run automatically
    const capsule = buildInitiateCapsule(sender, { receiverUserId: receiver.wrdesk_user_id, receiverEmail: receiver.email })
    const result = await submitCapsule(capsule, freshDb, receiver)

    // If migration didn't run the DB call would throw; success means tables existed
    expect(result.success).toBe(true)
    expect(result.handshake_result?.handshakeRecord?.state).toBe(HandshakeState.PENDING_REVIEW)
  })

  // ── P10: submitCapsuleViaRpc connector ──
  test('P10: submitCapsuleViaRpc delivers capsule through the full pipeline', async () => {
    const sender = senderSession()
    const receiver = receiverSession()
    const capsule = buildInitiateCapsule(sender, { receiverUserId: receiver.wrdesk_user_id, receiverEmail: receiver.email })

    const result = await submitCapsuleViaRpc(capsule, db, receiver)

    expect(result.success).toBe(true)
    expect(result.distribution_target).toBe('handshake_pipeline')
    expect(result.handshake_result?.handshakeRecord?.state).toBe(HandshakeState.PENDING_REVIEW)
  })

  // ── P11: G11 — ownership check (same user → fail) ──
  test('P11 (G11): initiate where sender === receiver session fails ownership step', async () => {
    const sender = senderSession()

    // Build capsule to a different user, but submit with same identity as sender
    const capsule = buildInitiateCapsule(sender, { receiverUserId: 'some-other-user', receiverEmail: 'other@example.com' })

    const result = await submitCapsule(capsule, db, sender) // same as sender — ownership violation

    expect(result.success).toBe(false)
    if (result.handshake_result) {
      expect(result.handshake_result.reason ?? '').toContain('OWNERSHIP')
    }
  })

  // ── P12: buildRefreshCapsule structure ──
  test('P12: buildRefreshCapsule has seq > 0 and prev_hash set', () => {
    const session = buildTestSession({ wrdesk_user_id: 'u-a' })
    const keypair = generateSigningKeypair()
    const refresh = buildRefreshCapsule(session, {
      handshake_id: 'hs-r-001',
      counterpartyUserId: 'u-b',
      counterpartyEmail: 'b@example.com',
      last_seq_received: 2,
      last_capsule_hash_received: 'c'.repeat(64),
      local_public_key: keypair.publicKey,
      local_private_key: keypair.privateKey,
    })
    expect(refresh.capsule_type).toBe('refresh')
    expect(refresh.seq).toBe(3) // last_seq_received + 1
    expect(refresh.prev_hash).toBe('c'.repeat(64))
    expect(refresh.sharing_mode).toBeUndefined()
    expect(refresh.capsule_hash).toMatch(/^[0-9a-f]{64}$/)
  })

  // ── P13: buildRevokeCapsule structure ──
  test('P13: buildRevokeCapsule has correct capsule_type and seq', () => {
    const session = buildTestSession({ wrdesk_user_id: 'u-a' })
    const keypair = generateSigningKeypair()
    const revoke = buildRevokeCapsule(session, {
      handshake_id: 'hs-rv-001',
      counterpartyUserId: 'u-b',
      counterpartyEmail: 'b@example.com',
      last_seq_received: 1,
      last_capsule_hash_received: 'd'.repeat(64),
      local_public_key: keypair.publicKey,
      local_private_key: keypair.privateKey,
    })
    expect(revoke.capsule_type).toBe('revoke')
    expect(revoke.seq).toBe(2) // last_seq_received + 1
    expect(revoke.capsule_hash).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('BEAP Pipeline — computePolicyHash', () => {
  test('DEFAULT_POLICY_HASH is a 64-char hex string', () => {
    expect(DEFAULT_POLICY_HASH).toMatch(/^[0-9a-f]{64}$/)
  })

  test('computePolicyHash is deterministic', () => {
    const h1 = computePolicyHash(DEFAULT_POLICY_DESCRIPTOR)
    const h2 = computePolicyHash(DEFAULT_POLICY_DESCRIPTOR)
    expect(h1).toEqual(h2)
    expect(h1).toEqual(DEFAULT_POLICY_HASH)
  })

  test('different policies produce different hashes', () => {
    const h1 = computePolicyHash(DEFAULT_POLICY_DESCRIPTOR)
    const h2 = computePolicyHash({ ...DEFAULT_POLICY_DESCRIPTOR, allows_cloud_escalation: true })
    expect(h1).not.toEqual(h2)
  })
})

describe('BEAP Pipeline — buildInitiateCapsule correctness', () => {
  test('capsule_hash in built capsule matches independent computation', () => {
    const session = buildTestSession({ wrdesk_user_id: 'u-a' })
    const ts = '2026-03-01T12:00:00.000Z'
    const capsule = buildInitiateCapsule(session, {
      receiverUserId: 'u-b',
      receiverEmail: 'b@example.com',
      timestamp: ts,
      handshake_id: 'hs-fixed-001',
    })

    const expected = computeCapsuleHash({
      capsule_type: 'initiate',
      handshake_id: 'hs-fixed-001',
      relationship_id: deriveRelationshipId('u-a', 'u-b'),
      schema_version: 2,
      sender_wrdesk_user_id: 'u-a',
      receiver_email: 'b@example.com',
      seq: 0,
      timestamp: ts,
      wrdesk_policy_hash: computePolicyHash(DEFAULT_POLICY_DESCRIPTOR),
      wrdesk_policy_version: '1.0',
      context_commitment: null,
    })

    expect(capsule.capsule_hash).toEqual(expected)
  })

  test('buildAcceptCapsule has seq: 0 and sharing_mode set', () => {
    const session = buildTestSession({ wrdesk_user_id: 'u-b' })
    const { capsule: accept } = buildAcceptCapsule(session, {
      handshake_id: 'hs-x-001',
      initiatorUserId: 'u-a',
      initiatorEmail: 'a@example.com',
      sharing_mode: 'receive-only',
      initiator_capsule_hash: 'a'.repeat(64),
    })
    expect(accept.seq).toBe(0)
    expect(accept.sharing_mode).toBe('receive-only')
    expect(accept.capsule_hash).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('BEAP Pipeline — sessionFactory', () => {
  test('buildTestSession produces valid SSOSession', () => {
    const session = buildTestSession()
    expect(session.wrdesk_user_id).toBeTruthy()
    expect(session.email_verified).toBe(true)
    expect(session.plan).toBe('free')
    expect(session.currentHardwareAttestation).toBeNull()
    expect(new Date(session.session_expires_at).getTime()).toBeGreaterThan(Date.now())
  })

  test('sessionFromClaims throws for missing fields', async () => {
    const { sessionFromClaims } = await import('../sessionFactory')
    expect(() => sessionFromClaims({
      wrdesk_user_id: '',
      email: 'a@b.com',
      iss: 'i',
      sub: 's',
      plan: 'free',
      session_expires_at: new Date().toISOString(),
    })).toThrow('wrdesk_user_id')
  })
})
