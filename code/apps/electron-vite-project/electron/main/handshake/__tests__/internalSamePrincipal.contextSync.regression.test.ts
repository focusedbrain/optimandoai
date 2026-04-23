/**
 * Internal same-principal, post-accept: defer/repair, ACTIVE gate, acceptor state.
 * Keeps imports minimal (no `contextSyncEnqueue` / Vite CJS shims) — production wiring is
 * `tryEnqueueContextSync` (INTERNAL_RELAY defers) + `retryDeferredInitialContextSyncForInternalHandshake`.
 */
import { describe, test, expect } from 'vitest'
import { getNextStateAfterInboundContextSync } from '../contextSyncActiveGate'
import { isInternalCoordinationIdentityComplete } from '../internalPersistence'
import { internalRelayCapsuleWireOptsFromRecord } from '../internalCoordinationWire'
import { HandshakeState, type HandshakeRecord } from '../types'

const ownerId = 'user-same'

function internalInitiatorRow(
  overrides: Partial<HandshakeRecord> & { handshake_id: string },
): HandshakeRecord {
  return {
    handshake_id: overrides.handshake_id,
    relationship_id: 'rel-int',
    state: HandshakeState.ACCEPTED,
    initiator: {
      email: 'u@t.com',
      wrdesk_user_id: ownerId,
      iss: 'i',
      sub: 'i1',
    },
    acceptor: { email: 'u@t.com', wrdesk_user_id: ownerId, iss: 'i', sub: 'a1' },
    local_role: 'initiator',
    sharing_mode: 'reciprocal',
    reciprocal_allowed: true,
    handshake_type: 'internal',
    initiator_device_name: 'A',
    acceptor_device_name: 'B',
    initiator_device_role: 'host',
    acceptor_device_role: 'sandbox',
    initiator_coordination_device_id: 'dev-init-1',
    acceptor_coordination_device_id: 'dev-acc-1',
    last_seq_sent: 0,
    last_seq_received: 0,
    p2p_endpoint: 'https://c.test/capsule',
    ...overrides,
  } as HandshakeRecord
}

describe('internal same-principal: post-accept context_sync (regressions)', () => {
  /**
   * When routing identity is incomplete, `tryEnqueueContextSync` hits INTERNAL_RELAY
   * and sets `context_sync_pending` (not asserted here to avoid the enqueue graph).
   * After the acceptor’s coordination id and symmetric fields are known, `isInternal…`
   * and `internalRelayCapsuleWireOptsFromRecord` succeed — a subsequent
   * `retryDeferredInitialContextSyncForInternalHandshake` can en-queue (last_seq_sent set).
   */
  test('internal_reg_1_routing_incomplete_then_repair_allows_relay_wire_for_retry', () => {
    const recBefore = internalInitiatorRow({
      handshake_id: 'hs-r1',
      acceptor_coordination_device_id: null,
    })
    expect(isInternalCoordinationIdentityComplete(recBefore)).toBe(false)
    expect(internalRelayCapsuleWireOptsFromRecord(recBefore, 'dev-init-1')).toBeNull()

    const after: HandshakeRecord = {
      ...recBefore,
      acceptor_coordination_device_id: 'dev-acc-1',
      acceptor_device_name: 'B',
      acceptor_device_role: 'sandbox',
      internal_coordination_identity_complete: true,
    } as HandshakeRecord
    expect(isInternalCoordinationIdentityComplete(after)).toBe(true)
    const wire = internalRelayCapsuleWireOptsFromRecord(after, 'dev-init-1')
    expect(wire).not.toBeNull()
    expect(wire?.coordinationReceiverDeviceId).toBe('dev-acc-1')
  })

  /**
   * Durable `last_seq_sent >= 1` (own `context_sync` enqueued) does not mean ACTIVE:
   * the acceptor is still `ACCEPTED` until the **initiator’s** first `context_sync` is
   * **ingested** (row still shows `last_seq_received` before that chain advance).
   */
  test('internal_reg_2_acceptor_stays_accepted_until_initiator_context_sync_ingested', () => {
    const acceptor: HandshakeRecord = {
      ...internalInitiatorRow({ handshake_id: 'hs-r2' }),
      local_role: 'acceptor',
      initiator_coordination_device_id: 'dev-init-1',
      acceptor_coordination_device_id: 'dev-acc-1',
      last_seq_sent: 1,
      last_capsule_hash_sent: 'x'.repeat(64),
      last_seq_received: 0,
      state: HandshakeState.ACCEPTED,
    } as HandshakeRecord

    expect(acceptor.state).toBe(HandshakeState.ACCEPTED)
    expect(acceptor.last_seq_received).toBe(0)
    expect(acceptor.last_seq_sent).toBeGreaterThanOrEqual(1)
    // Before initiator’s first context_sync is ingested, we are not ACTIVE; after a peer seq-1
    // ingest (same snapshot would transition in `buildContextSyncRecord` once DB advances).
    expect(getNextStateAfterInboundContextSync(acceptor, 1)).toBe(HandshakeState.ACTIVE)
  })

  /**
   * Inbound `context_sync` (seq 1) from the peer is **not** enough to go ACTIVE
   * if we never durably enqueued our own initial (`last_seq_sent` still 0), even
   * when `context_sync_pending` is falsely cleared.
   */
  test('internal_reg_3_initiator_not_active_from_peer_context_sync_if_own_never_enqueued', () => {
    const init: HandshakeRecord = {
      ...internalInitiatorRow({ handshake_id: 'hs-r3' }),
      last_seq_sent: 0,
      last_capsule_hash_sent: '',
      context_sync_pending: false,
    } as HandshakeRecord

    expect(getNextStateAfterInboundContextSync(init, 1)).toBe(HandshakeState.ACCEPTED)
  })
})
