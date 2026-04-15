/**
 * Internal device identity: pipeline, ownership duplicate key, repair guards, IPC edge cases.
 */

import { describe, test, expect } from 'vitest'
import { internalRelayCapsuleWireOptsFromRecord } from '../internalCoordinationWire'
import { verifyInternalCapsuleRouting } from '../steps/internalRoutingCapsule'
import { verifyHandshakeOwnership } from '../steps/ownership'
import {
  buildCtx,
  buildVerifiedCapsuleInput,
  buildHandshakeRecord,
} from './helpers'
import { HandshakeState, ReasonCode } from '../types'

describe('verifyInternalCapsuleRouting', () => {
  test('internal context_sync without device ids → POLICY_VIOLATION', () => {
    const ctx = buildCtx({
      input: buildVerifiedCapsuleInput({
        capsuleType: 'handshake-context-sync',
        handshake_type: 'internal',
        seq: 1,
        prev_hash: 'a'.repeat(64),
        sender_device_id: null,
        receiver_device_id: null,
      }),
      handshakeRecord: buildHandshakeRecord({
        handshake_type: 'internal',
        state: HandshakeState.ACCEPTED,
      }),
    })
    const r = verifyInternalCapsuleRouting.execute(ctx)
    expect(r.passed).toBe(false)
    if (!r.passed) expect(r.reason).toBe(ReasonCode.POLICY_VIOLATION)
  })

  test('internal context_sync with distinct device ids → passes', () => {
    const ctx = buildCtx({
      input: buildVerifiedCapsuleInput({
        capsuleType: 'handshake-context-sync',
        handshake_type: 'internal',
        seq: 1,
        prev_hash: 'a'.repeat(64),
        sender_device_id: 'dev-a',
        receiver_device_id: 'dev-b',
      }),
      handshakeRecord: buildHandshakeRecord({ handshake_type: 'internal', state: HandshakeState.ACCEPTED }),
    })
    expect(verifyInternalCapsuleRouting.execute(ctx).passed).toBe(true)
  })
})

describe('verifyHandshakeOwnership internal routing duplicate', () => {
  test('second internal initiate same device pair + owner → DUPLICATE even when relationship_id differs', () => {
    const existing = buildHandshakeRecord({
      handshake_id: 'hs-old',
      relationship_id: 'rel:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      state: HandshakeState.PENDING_ACCEPT,
      handshake_type: 'internal',
      internal_routing_key: 'internal:owner-1:alpha:zebra',
      initiator: { email: 'm@e.com', wrdesk_user_id: 'owner-1', iss: 'i', sub: 's' },
    })
    const ctx = buildCtx({
      input: buildVerifiedCapsuleInput({
        capsuleType: 'handshake-initiate',
        handshake_type: 'internal',
        relationship_id: 'rel:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        sender_wrdesk_user_id: 'owner-1',
        sender_email: 'owner@same.com',
        receiver_email: 'owner@same.com',
        senderIdentity: {
          email: 'owner@same.com',
          iss: 'https://auth',
          sub: 'sub-owner',
          email_verified: true,
          wrdesk_user_id: 'owner-1',
        },
        sender_device_id: 'alpha',
        receiver_device_id: 'zebra',
        sender_device_role: 'host',
        receiver_device_role: 'sandbox',
        sender_computer_name: 'H',
        receiver_computer_name: 'S',
      }),
      handshakeRecord: null,
      existingHandshakes: [existing],
      localUserId: 'owner-1',
    })
    const r = verifyHandshakeOwnership.execute(ctx)
    expect(r.passed).toBe(false)
    if (!r.passed) expect(r.reason).toBe(ReasonCode.DUPLICATE_ACTIVE_HANDSHAKE)
  })
})

describe('context_sync wire opts', () => {
  test('internalRelayCapsuleWireOptsFromRecord yields distinct sender and receiver coordination ids', () => {
    const record = {
      handshake_type: 'internal' as const,
      local_role: 'initiator' as const,
      internal_coordination_identity_complete: true as const,
      initiator_coordination_device_id: 'local-orch-99',
      acceptor_coordination_device_id: 'peer-orch-1',
      initiator_device_role: 'host' as const,
      acceptor_device_role: 'sandbox' as const,
      initiator_device_name: 'InitName',
      acceptor_device_name: 'AccName',
    }
    const opts = internalRelayCapsuleWireOptsFromRecord(record as any, 'local-orch-99')
    expect(opts?.coordinationSenderDeviceId).toBe('local-orch-99')
    expect(opts?.coordinationReceiverDeviceId).toBe('peer-orch-1')
  })
})
