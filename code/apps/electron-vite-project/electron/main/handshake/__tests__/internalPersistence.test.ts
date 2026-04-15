import { describe, test, expect } from 'vitest'
import {
  computeInternalRoutingKey,
  finalizeInternalHandshakePersistence,
  isInternalCoordinationIdentityComplete,
} from '../internalPersistence'
import type { HandshakeRecord } from '../types'

function baseRecord(partial: Partial<HandshakeRecord>): HandshakeRecord {
  return {
    handshake_id: 'hs-1',
    relationship_id: 'rel-1',
    state: 'PENDING_ACCEPT',
    initiator: { email: 'a@b.com', wrdesk_user_id: 'owner-1', iss: 'i', sub: 's' },
    acceptor: null,
    local_role: 'initiator',
    sharing_mode: null,
    reciprocal_allowed: false,
    tier_snapshot: { plan: 'free' },
    current_tier_signals: { plan: 'free', hardwareAttestation: null, dnsVerification: null, wrStampStatus: null },
    last_seq_sent: 0,
    last_seq_received: 0,
    last_capsule_hash_sent: '',
    last_capsule_hash_received: '',
    effective_policy: {} as HandshakeRecord['effective_policy'],
    external_processing: 'none',
    created_at: new Date().toISOString(),
    activated_at: null,
    expires_at: null,
    revoked_at: null,
    revocation_source: null,
    initiator_wrdesk_policy_hash: '',
    initiator_wrdesk_policy_version: '',
    acceptor_wrdesk_policy_hash: null,
    acceptor_wrdesk_policy_version: null,
    initiator_context_commitment: null,
    acceptor_context_commitment: null,
    p2p_endpoint: null,
    counterparty_p2p_token: null,
    ...partial,
  } as HandshakeRecord
}

describe('internalPersistence', () => {
  test('computeInternalRoutingKey orders device ids lexicographically', () => {
    expect(computeInternalRoutingKey('owner', 'zebra', 'alpha')).toBe('internal:owner:alpha:zebra')
    expect(computeInternalRoutingKey('owner', 'b', 'b')).toBeNull()
  })

  test('finalizeInternalHandshakePersistence marks complete only with full symmetry', () => {
    const incomplete = finalizeInternalHandshakePersistence(
      baseRecord({
        handshake_type: 'internal',
        initiator_coordination_device_id: 'a',
        acceptor_coordination_device_id: 'b',
        initiator_device_role: 'host',
        acceptor_device_role: 'sandbox',
        initiator_device_name: 'H',
        acceptor_device_name: null,
      }),
    )
    expect(incomplete.internal_coordination_identity_complete).toBe(false)
    expect(incomplete.internal_routing_key).toBe('internal:owner-1:a:b')

    const complete = finalizeInternalHandshakePersistence(
      baseRecord({
        handshake_type: 'internal',
        initiator_coordination_device_id: 'a',
        acceptor_coordination_device_id: 'b',
        initiator_device_role: 'host',
        acceptor_device_role: 'sandbox',
        initiator_device_name: 'H',
        acceptor_device_name: 'S',
      }),
    )
    expect(complete.internal_coordination_identity_complete).toBe(true)
    expect(complete.internal_routing_key).toBe('internal:owner-1:a:b')
  })

  test('standard handshake clears internal routing fields', () => {
    const r = finalizeInternalHandshakePersistence(baseRecord({ handshake_type: 'standard' }))
    expect(r.internal_routing_key).toBeNull()
    expect(r.internal_coordination_identity_complete).toBe(false)
    expect(r.internal_coordination_repair_needed).toBe(false)
  })

  test('finalizeInternalHandshakePersistence sets repair_needed for incomplete internal ACTIVE', () => {
    const r = finalizeInternalHandshakePersistence(
      baseRecord({
        handshake_type: 'internal',
        state: 'ACTIVE',
        initiator_coordination_device_id: 'a',
        acceptor_coordination_device_id: 'b',
        initiator_device_role: 'host',
        acceptor_device_role: 'sandbox',
        initiator_device_name: 'H',
        acceptor_device_name: null,
      }),
    )
    expect(r.internal_coordination_identity_complete).toBe(false)
    expect(r.internal_coordination_repair_needed).toBe(true)
  })

  test('finalizeInternalHandshakePersistence clears repair_needed when identity becomes complete', () => {
    const r = finalizeInternalHandshakePersistence(
      baseRecord({
        handshake_type: 'internal',
        state: 'ACTIVE',
        internal_coordination_repair_needed: true,
        initiator_coordination_device_id: 'a',
        acceptor_coordination_device_id: 'b',
        initiator_device_role: 'host',
        acceptor_device_role: 'sandbox',
        initiator_device_name: 'H',
        acceptor_device_name: 'S',
      }),
    )
    expect(r.internal_coordination_identity_complete).toBe(true)
    expect(r.internal_coordination_repair_needed).toBe(false)
  })

  test('isInternalCoordinationIdentityComplete', () => {
    expect(
      isInternalCoordinationIdentityComplete(
        baseRecord({
          handshake_type: 'internal',
          initiator_coordination_device_id: 'x',
          acceptor_coordination_device_id: 'y',
          initiator_device_role: 'host',
          acceptor_device_role: 'sandbox',
          initiator_device_name: 'a',
          acceptor_device_name: 'b',
        }),
      ),
    ).toBe(true)
  })
})
