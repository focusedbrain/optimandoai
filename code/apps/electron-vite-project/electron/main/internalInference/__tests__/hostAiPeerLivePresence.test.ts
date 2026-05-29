const getCurrentSessionMock = vi.hoisted(() => vi.fn())

vi.mock('../../handshake/ipc', () => ({
  getCurrentSession: () => getCurrentSessionMock(),
}))

vi.mock('../../handshake/db', () => ({
  getHandshakeRecord: vi.fn(),
}))

vi.mock('../dbAccess', () => ({
  getHandshakeDbForInternalInference: vi.fn(async () => null),
}))

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { HandshakeState, type HandshakeRecord } from '../../handshake/types'
import {
  hasHostPeerIdentityBoundLivePresence,
  hostPartyIdentityFromRecord,
  resetHostPeerLivePresenceForTests,
  tryRecordHostPeerLivePresenceFromPolicyResponse,
} from '../hostAiPeerLivePresence'

function internalRecord(overrides: Partial<HandshakeRecord> = {}): HandshakeRecord {
  return {
    handshake_id: 'hs-live-1',
    handshake_type: 'internal',
    state: HandshakeState.ACTIVE,
    initiator_device_role: 'host',
    acceptor_device_role: 'sandbox',
    initiator: {
      email: 'user-a@wrdesk.com',
      wrdesk_user_id: 'user-a-id',
      iss: 'iss-a',
      sub: 'sub-a',
    },
    acceptor: {
      email: 'user-a@wrdesk.com',
      wrdesk_user_id: 'user-a-id',
      iss: 'iss-a',
      sub: 'sub-a',
    },
    initiator_coordination_device_id: 'host-dev',
    acceptor_coordination_device_id: 'sand-dev',
    internal_coordination_identity_complete: true,
    ...overrides,
  } as HandshakeRecord
}

describe('hostAiPeerLivePresence', () => {
  beforeEach(() => {
    resetHostPeerLivePresenceForTests()
    getCurrentSessionMock.mockReset()
  })

  it('hostPartyIdentityFromRecord picks host-side party', () => {
    const r = internalRecord()
    expect(hostPartyIdentityFromRecord(r)?.wrdesk_user_id).toBe('user-a-id')
  })

  it('records and validates fresh policy attestation', () => {
    const r = internalRecord()
    const ok = tryRecordHostPeerLivePresenceFromPolicyResponse(
      r.handshake_id,
      r,
      {
        hostPublisherWrdeskUserId: 'user-a-id',
        hostPublisherIss: 'iss-a',
        hostPublisherSub: 'sub-a',
      },
      true,
    )
    expect(ok).toBe(true)
    expect(hasHostPeerIdentityBoundLivePresence(r.handshake_id, r)).toBe(true)
  })

  it('rejects attestation when publisher identity mismatches handshake host party', () => {
    const r = internalRecord()
    const ok = tryRecordHostPeerLivePresenceFromPolicyResponse(
      r.handshake_id,
      r,
      {
        hostPublisherWrdeskUserId: 'other-user-id',
        hostPublisherIss: 'iss-b',
        hostPublisherSub: 'sub-b',
      },
      true,
    )
    expect(ok).toBe(false)
    expect(hasHostPeerIdentityBoundLivePresence(r.handshake_id, r)).toBe(false)
  })

  it('does not record when allowSandboxInference is false', () => {
    const r = internalRecord()
    tryRecordHostPeerLivePresenceFromPolicyResponse(
      r.handshake_id,
      r,
      { hostPublisherWrdeskUserId: 'user-a-id' },
      false,
    )
    expect(hasHostPeerIdentityBoundLivePresence(r.handshake_id, r)).toBe(false)
  })
})
