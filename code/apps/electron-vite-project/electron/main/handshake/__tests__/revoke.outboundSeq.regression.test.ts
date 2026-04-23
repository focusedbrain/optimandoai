/**
 * When context_sync (seq 1) is enqueued, `last_seq_sent` is 1 but `last_seq_received`
 * may still be 0 until the round-trip completes. Revoke must not reuse seq 1; the
 * counterparty’s pipeline expects the next from us to be 2 and otherwise returns SEQ_REPLAY.
 */

import { describe, test, expect } from 'vitest'
import { buildRevokeCapsule } from '../capsuleBuilder'
import { generateSigningKeypair } from '../signatureKeys'
import { buildTestSession } from '../sessionFactory'
import { verifyChainIntegrity } from '../steps/chainIntegrity'
import { buildCtx, buildVerifiedCapsuleInput, buildActiveHandshakeRecord } from './helpers'
describe('Revoke outbound sequence', () => {
  test('regression: after local context_sync (last_seq_sent=1), built revoke is seq=2 and passes chain integrity for the peer', () => {
    const session = buildTestSession({ wrdesk_user_id: 'u-a' })
    const keypair = generateSigningKeypair()
    const lastHash = 'a'.repeat(64)

    const revoke = buildRevokeCapsule(session, {
      handshake_id: 'hs-rv-001',
      counterpartyUserId: 'u-b',
      counterpartyEmail: 'b@example.com',
      last_seq_sent: 1,
      last_seq_received: 0,
      last_capsule_hash_received: lastHash,
      local_public_key: keypair.publicKey,
      local_private_key: keypair.privateKey,
    })

    expect(revoke.seq).toBe(2)

    // Receiver state: they already ingested our context_sync at seq 1.
    const ctx = buildCtx({
      input: buildVerifiedCapsuleInput({
        capsuleType: 'handshake-revoke',
        seq: revoke.seq,
        sender_wrdesk_user_id: 'sender-user-001',
        prev_hash: undefined,
      }),
      handshakeRecord: buildActiveHandshakeRecord({
        last_seq_received: 1,
        last_capsule_hash_received: lastHash,
      }),
    })
    const r = verifyChainIntegrity.execute(ctx)
    expect(r.passed).toBe(true)
  })
})
