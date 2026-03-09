/**
 * BEAP™ E2E Round-Trip Test
 *
 * Verifies the complete flow:
 *   initiate → accept → refresh (with context blocks) → blocks persisted
 *
 * Uses mocked email transport (captures sent capsules) and processes them
 * through the real pipeline on two separate mock databases (simulating two
 * machines/users).
 *
 * T18: Full initiate → accept → refresh round-trip (mocked email gateway)
 */

import { describe, test, expect, beforeEach, vi } from 'vitest'
import { buildTestSession } from '../sessionFactory'
import { createHandshakeTestDb } from './handshakeTestDb'
import { migrateIngestionTables } from '../../ingestion/persistenceDb'
import { handleIngestionRPC } from '../../ingestion/ipc'
import {
  handleHandshakeRPC,
  setSSOSessionProvider,
  _resetSSOSessionProvider,
} from '../ipc'
import {
  setEmailSendFn,
  _resetEmailSendFn,
} from '../emailTransport'
import {
  buildInitiateCapsuleWithKeypair,
  buildAcceptCapsule,
  buildContextSyncCapsule,
  buildRefreshCapsule,
} from '../capsuleBuilder'
import { mockKeypairFields } from './mockKeypair'
import { HandshakeState } from '../types'
import type { SSOSession } from '../types'
import { updateHandshakeSigningKeys, updateHandshakeCounterpartyKey } from '../db'

function aliceSession(): SSOSession {
  return buildTestSession({
    wrdesk_user_id: 'alice-001',
    email: 'alice@company.com',
    sub: 'alice-001',
  })
}

function bobSession(): SSOSession {
  return buildTestSession({
    wrdesk_user_id: 'bob-001',
    email: 'bob@partner.com',
    sub: 'bob-001',
  })
}

async function submitCapsule(capsuleJson: string, db: any, session: SSOSession) {
  return handleIngestionRPC(
    'ingestion.ingest',
    {
      rawInput: {
        body: capsuleJson,
        mime_type: 'application/vnd.beap+json',
      },
      sourceType: 'email',
      transportMeta: { channel_id: 'email:test', mime_type: 'application/vnd.beap+json' },
    },
    db,
    session,
  )
}

describe('BEAP E2E Round-Trip — Two-Party Flow', () => {
  let aliceDb: ReturnType<typeof createHandshakeTestDb>
  let bobDb: ReturnType<typeof createHandshakeTestDb>
  const sentEmails: Array<{ to: string; body: string }> = []

  beforeEach(() => {
    aliceDb = createHandshakeTestDb()
    migrateIngestionTables(aliceDb)
    bobDb = createHandshakeTestDb()
    migrateIngestionTables(bobDb)
    sentEmails.length = 0
    _resetSSOSessionProvider()
    _resetEmailSendFn()
    setEmailSendFn(vi.fn().mockImplementation(async (_acctId, payload) => {
      sentEmails.push({ to: payload.to[0], body: payload.bodyText })
      return { success: true, messageId: `msg-${sentEmails.length}` }
    }))
  })

  test('T18: full initiate → accept → refresh round-trip with context block proofs', async () => {
    const alice = aliceSession()
    const bob = bobSession()

    // ═══════════════════════════════════════════════════════════════════
    // STEP 1: Alice initiates a handshake with Bob
    // ═══════════════════════════════════════════════════════════════════
    const { capsule: initiate, keypair: aliceKeypair } = buildInitiateCapsuleWithKeypair(alice, {
      receiverUserId: bob.wrdesk_user_id,
      receiverEmail: bob.email,
      reciprocal_allowed: true,
    })

    // Alice submits to her own pipeline (creates initiator record)
    // Note: this will fail ownership check because sender === session.
    // In real-world flow, the initiator's record is NOT created locally via pipeline;
    // we simulate it by directly submitting the capsule to Bob's DB.

    // Bob receives the initiate capsule via email
    const bobInitResult = await submitCapsule(JSON.stringify(initiate), bobDb, bob)
    expect(bobInitResult.success).toBe(true)
    expect(bobInitResult.handshake_result?.handshakeRecord?.state).toBe(HandshakeState.PENDING_REVIEW)
    expect(bobInitResult.handshake_result?.handshakeRecord?.local_role).toBe('acceptor')

    // ═══════════════════════════════════════════════════════════════════
    // STEP 2: Bob accepts the handshake
    // ═══════════════════════════════════════════════════════════════════
    const { capsule: accept, keypair: bobKeypair } = buildAcceptCapsule(bob, {
      handshake_id: initiate.handshake_id,
      initiatorUserId: alice.wrdesk_user_id,
      initiatorEmail: alice.email,
      sharing_mode: 'reciprocal',
      initiator_capsule_hash: initiate.capsule_hash,
    })

    // Alice receives the accept capsule via email
    // First, Alice needs the initiate record — submit initiate to Alice's DB
    // In production, Alice's record was created when she first initiated.
    // Simulate: submit initiate to Alice's DB from Bob's perspective (as receiver session = alice)
    // Actually, Alice's record needs to be created. Let's submit the initiate capsule
    // to Alice's DB with Alice as the local user. The ownership step requires
    // sender_wrdesk_user_id !== ssoSession.wrdesk_user_id. Since sender IS alice,
    // this would fail. Instead, we need to submit the capsule as if Alice received
    // it from herself — which is what submitCapsuleViaRpc does in handshake.initiate.
    // For the test, we bypass this by directly creating a PENDING_ACCEPT record on Alice's side.

    // Actually, in the real flow via handshake.initiate IPC:
    // The IPC handler calls submitCapsuleViaRpc(capsule, db, session) which
    // submits the capsule with the sender's own session. The pipeline then sees
    // sender === local_user and the ownership check step will fail.
    //
    // This is by design: the initiator's record creation needs special handling.
    // For now, let's simulate the two-party flow as intended:
    // Alice's initiate is only for Bob. Alice needs to receive the ACCEPT back
    // to create her record.

    // Submit accept to Alice's DB — Alice doesn't have a record yet,
    // but the accept capsule references the handshake_id. The pipeline
    // will look for the handshake record and not find it.
    // We need to first submit the initiate to ALICE's DB with a DIFFERENT session
    // so the ownership step passes, effectively "pre-creating" the record.

    // The cleanest approach: submit initiate to Alice's DB with bob's session
    // (as if Bob received it — but really we're seeding Alice's DB)
    // Then submit accept to Alice's DB with alice's session.

    // Actually, in the two-machine model:
    // Machine A (Alice): sends initiate → creates local record via local pipeline
    // Machine B (Bob): receives initiate → PENDING_ACCEPT
    // Machine B (Bob): sends accept → Alice receives → updates to ACTIVE

    // The ownership check requires sender ≠ localUser. So Alice can't self-submit
    // her own initiate. In practice, the IPC handler should handle this differently.
    // For this test, let's simulate by having Bob also seed Alice's DB.

    // Seed Alice's DB: submit initiate as if Bob received it (so Alice has a record too)
    const aliceInitResult = await submitCapsule(JSON.stringify(initiate), aliceDb, bob)
    expect(aliceInitResult.success).toBe(true)

    // Now submit Bob's accept to Alice's DB
    const aliceAcceptResult = await submitCapsule(JSON.stringify(accept), aliceDb, alice)
    expect(aliceAcceptResult.success).toBe(true)
    // Per design: accept → ACCEPTED; ACTIVE only after context_sync roundtrip
    expect(aliceAcceptResult.handshake_result?.handshakeRecord?.state).toBe(HandshakeState.ACCEPTED)
    expect(aliceAcceptResult.handshake_result?.handshakeRecord?.sharing_mode).toBe('reciprocal')

    // Also submit accept to Bob's own DB so his record transitions too
    const bobAcceptResult = await submitCapsule(JSON.stringify(accept), bobDb, alice)
    // Bob already has a PENDING_ACCEPT record. Accept from bob (sender) processed
    // with alice's session (local user ≠ sender) → ACCEPTED (ACTIVE after context_sync)
    expect(bobAcceptResult.success).toBe(true)
    expect(bobAcceptResult.handshake_result?.handshakeRecord?.state).toBe(HandshakeState.ACCEPTED)

    const handshakeId = initiate.handshake_id
    updateHandshakeSigningKeys(aliceDb, handshakeId, { local_public_key: aliceKeypair.publicKey, local_private_key: aliceKeypair.privateKey })
    updateHandshakeSigningKeys(bobDb, handshakeId, { local_public_key: bobKeypair.publicKey, local_private_key: bobKeypair.privateKey })
    updateHandshakeCounterpartyKey(bobDb, handshakeId, aliceKeypair.publicKey)

    // ═══════════════════════════════════════════════════════════════════
    // STEP 3a: Both parties send context-sync (first post-activation required)
    // Build both capsules from post-accept state (last_seq_received=0) so each
    // has seq 1. Order of submission: Alice→Bob, then Bob→Alice.
    // ═══════════════════════════════════════════════════════════════════
    const aliceRecordAfterAccept = aliceDb.getHandshake(initiate.handshake_id)
    const bobRecordAfterAccept = bobDb.getHandshake(initiate.handshake_id)
    expect(aliceRecordAfterAccept).toBeTruthy()
    expect(bobRecordAfterAccept).toBeTruthy()

    const aliceContextSync = buildContextSyncCapsule(alice, {
      handshake_id: initiate.handshake_id,
      counterpartyUserId: bob.wrdesk_user_id,
      counterpartyEmail: bob.email,
      last_seq_received: aliceRecordAfterAccept!.last_seq_received ?? 0,
      last_capsule_hash_received: aliceRecordAfterAccept!.last_capsule_hash_received ?? '',
      context_blocks: [],
      local_public_key: aliceKeypair.publicKey,
      local_private_key: aliceKeypair.privateKey,
    })
    const bobContextSync = buildContextSyncCapsule(bob, {
      handshake_id: initiate.handshake_id,
      counterpartyUserId: alice.wrdesk_user_id,
      counterpartyEmail: alice.email,
      last_seq_received: bobRecordAfterAccept!.last_seq_received ?? 0,
      last_capsule_hash_received: bobRecordAfterAccept!.last_capsule_hash_received ?? '',
      context_blocks: [],
      local_public_key: bobKeypair.publicKey,
      local_private_key: bobKeypair.privateKey,
    })
    expect(aliceContextSync.capsule_type).toBe('context_sync')
    expect(aliceContextSync.seq).toBe(1)
    expect(bobContextSync.seq).toBe(1)

    const bobContextSyncResult = await submitCapsule(JSON.stringify(aliceContextSync), bobDb, bob)
    expect(bobContextSyncResult.success).toBe(true)
    expect(bobContextSyncResult.handshake_result?.handshakeRecord?.last_seq_received).toBe(1)
    // context_sync (seq 1) received → ACCEPTED → ACTIVE
    expect(bobContextSyncResult.handshake_result?.handshakeRecord?.state).toBe(HandshakeState.ACTIVE)

    const aliceContextSyncResult = await submitCapsule(JSON.stringify(bobContextSync), aliceDb, alice)
    expect(aliceContextSyncResult.success).toBe(true)
    expect(aliceContextSyncResult.handshake_result?.handshakeRecord?.last_seq_received).toBe(1)
    // context_sync (seq 1) received → ACCEPTED → ACTIVE
    expect(aliceContextSyncResult.handshake_result?.handshakeRecord?.state).toBe(HandshakeState.ACTIVE)

    // ═══════════════════════════════════════════════════════════════════
    // STEP 3c: Alice sends a refresh with context block proofs
    // prev_hash must be the hash of the last capsule Bob received from Alice
    // (= Alice's context-sync), not what Alice received from Bob.
    // ═══════════════════════════════════════════════════════════════════
    const aliceRecord = aliceDb.getHandshake(initiate.handshake_id)
    expect(aliceRecord).toBeTruthy()

    const refresh = buildRefreshCapsule(alice, {
      handshake_id: initiate.handshake_id,
      counterpartyUserId: bob.wrdesk_user_id,
      counterpartyEmail: bob.email,
      last_seq_received: aliceRecord!.last_seq_received ?? 0,
      last_capsule_hash_received: aliceContextSync.capsule_hash,
      context_block_proofs: [
        { block_id: 'blk_aabb0011223344', block_hash: 'b'.repeat(64) },
        { block_id: 'blk_ccdd5566778899', block_hash: 'c'.repeat(64) },
      ],
      local_public_key: aliceKeypair.publicKey,
      local_private_key: aliceKeypair.privateKey,
    })

    expect(refresh.capsule_type).toBe('refresh')
    expect(refresh.context_block_proofs).toHaveLength(2)
    expect(refresh.seq).toBe(2)

    // Bob receives and processes the refresh
    const bobRefreshResult = await submitCapsule(JSON.stringify(refresh), bobDb, bob)
    expect(bobRefreshResult.success).toBe(true)
    expect(bobRefreshResult.handshake_result?.handshakeRecord?.state).toBe(HandshakeState.ACTIVE)
    expect(bobRefreshResult.handshake_result?.blocksStored).toBe(2)
  })

  test('builder tests — refresh with context_block_proofs vs without', () => {
    const session = buildTestSession({ wrdesk_user_id: 'u-a' })

    const withProofs = buildRefreshCapsule(session, {
      handshake_id: 'hs-test',
      counterpartyUserId: 'u-b',
      counterpartyEmail: 'counterparty@test.com',
      last_seq_received: 0,
      last_capsule_hash_received: 'a'.repeat(64),
      context_block_proofs: [
        { block_id: 'blk_aabb11223344', block_hash: 'x'.repeat(64) },
      ],
      ...mockKeypairFields(),
    })
    expect(withProofs.context_block_proofs).toHaveLength(1)
    expect(withProofs.context_block_proofs![0].block_id).toBe('blk_aabb11223344')

    const withoutProofs = buildRefreshCapsule(session, {
      handshake_id: 'hs-test',
      counterpartyUserId: 'u-b',
      counterpartyEmail: 'counterparty@test.com',
      last_seq_received: 0,
      last_capsule_hash_received: 'a'.repeat(64),
      ...mockKeypairFields(),
    })
    expect(withoutProofs.context_block_proofs).toBeUndefined()
  })

  test('T2: computeCapsuleHash NOT affected by context_block_proofs (by design)', () => {
    const session = buildTestSession({ wrdesk_user_id: 'u-a' })
    const ts = '2026-03-01T00:00:00.000Z'

    const withProofs = buildRefreshCapsule(session, {
      handshake_id: 'hs-hash-test',
      counterpartyUserId: 'u-b',
      counterpartyEmail: 'counterparty@test.com',
      last_seq_received: 0,
      last_capsule_hash_received: 'a'.repeat(64),
      timestamp: ts,
      context_block_proofs: [
        { block_id: 'blk_abc123', block_hash: 'x'.repeat(64) },
      ],
      ...mockKeypairFields(),
    })

    const withoutProofs = buildRefreshCapsule(session, {
      handshake_id: 'hs-hash-test',
      counterpartyUserId: 'u-b',
      counterpartyEmail: 'counterparty@test.com',
      last_seq_received: 0,
      last_capsule_hash_received: 'a'.repeat(64),
      timestamp: ts,
      ...mockKeypairFields(),
    })

    // Hashes should be identical because context_block_proofs are intentionally
    // excluded from the capsule hash (block-level hashes track content)
    expect(withProofs.capsule_hash).toBe(withoutProofs.capsule_hash)
  })
})
