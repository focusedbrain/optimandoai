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
import { HandshakeState, type HandshakeRecord, type SSOSession } from '../../handshake/types'
import { InternalInferenceErrorCode } from '../errors'
import {
  assertHostMachineSessionMatchesHandshakeHostParty,
  hasHostPeerIdentityBoundLivePresence,
  hostPartyIdentityFromRecord,
  resetHostPeerLivePresenceForTests,
  tryRecordHostPeerLivePresenceFromPolicyResponse,
} from '../hostAiPeerLivePresence'

function sessionForId(id: string): SSOSession {
  return { email: `${id}@wrdesk.com`, wrdesk_user_id: `${id}-id`, iss: `iss-${id}`, sub: `sub-${id}` } as SSOSession
}

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

describe('assertHostMachineSessionMatchesHandshakeHostParty (§2 per-handshake gate)', () => {
  beforeEach(() => {
    getCurrentSessionMock.mockReset()
  })

  it('allows when same-principal internal row and session matches a party', () => {
    getCurrentSessionMock.mockReturnValue(sessionForId('user-a'))
    expect(assertHostMachineSessionMatchesHandshakeHostParty(internalRecord()).ok).toBe(true)
  })

  it('allows even when the host-party identity differs only in completeness (either-party match)', () => {
    // Same principal on both ends; session matches via the acceptor party. Host-role party JSON being
    // incomplete on one ledger copy must not deny (the post-split robustness this change adds).
    getCurrentSessionMock.mockReturnValue(sessionForId('user-a'))
    const r = internalRecord({ initiator: { email: '', wrdesk_user_id: 'user-a-id', iss: '', sub: '' } as any })
    expect(assertHostMachineSessionMatchesHandshakeHostParty(r).ok).toBe(true)
  })

  it('denies a different SSO identity (HOST_AI_PEER_IDENTITY_OFFLINE) — §2', () => {
    getCurrentSessionMock.mockReturnValue(sessionForId('user-b'))
    const res = assertHostMachineSessionMatchesHandshakeHostParty(internalRecord())
    expect(res.ok).toBe(false)
    expect((res as { code: string }).code).toBe(InternalInferenceErrorCode.HOST_AI_PEER_IDENTITY_OFFLINE)
  })

  it('denies a non-internal handshake (HOST_AI_IDENTITY_INCOMPLETE) — §2', () => {
    getCurrentSessionMock.mockReturnValue(sessionForId('user-a'))
    const res = assertHostMachineSessionMatchesHandshakeHostParty(
      internalRecord({ handshake_type: 'standard' as any }),
    )
    expect(res.ok).toBe(false)
    expect((res as { code: string }).code).toBe(InternalInferenceErrorCode.HOST_AI_IDENTITY_INCOMPLETE)
  })

  it('denies a cross-principal internal row even if roles parse (HOST_AI_IDENTITY_INCOMPLETE) — §2', () => {
    getCurrentSessionMock.mockReturnValue(sessionForId('user-a'))
    const res = assertHostMachineSessionMatchesHandshakeHostParty(
      internalRecord({ acceptor: { email: 'b@wrdesk.com', wrdesk_user_id: 'user-b-id', iss: 'iss-b', sub: 'sub-b' } }),
    )
    expect(res.ok).toBe(false)
    expect((res as { code: string }).code).toBe(InternalInferenceErrorCode.HOST_AI_IDENTITY_INCOMPLETE)
  })

  it('denies when no SSO session (HOST_AI_PEER_IDENTITY_OFFLINE)', () => {
    getCurrentSessionMock.mockReturnValue(undefined)
    const res = assertHostMachineSessionMatchesHandshakeHostParty(internalRecord())
    expect(res.ok).toBe(false)
    expect((res as { code: string }).code).toBe(InternalInferenceErrorCode.HOST_AI_PEER_IDENTITY_OFFLINE)
  })
})
