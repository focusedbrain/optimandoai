import { describe, expect, it } from 'vitest'
import { InternalInferenceErrorCode } from '../errors'
import {
  hostAiDcCapabilityResultBlocksHttpFallback,
  hostAiRouteCandidateBelongsToLocalDevice,
  hostAiRouteCandidateBelongsToPeerHost,
  hostAiRouteCandidateIsDirectHttp,
  hostAiRouteCandidateIsTerminalIdentityProvenanceFailure,
  hostAiRouteCandidateMayBeDialed,
  hostAiRouteFailureCodeIsTerminalIdentityProvenance,
  isHostAiProbeTerminalNoPolicyFallback,
  type HostAiRouteCandidate,
} from '../transport/hostAiRouteCandidate'

function baseCandidate(over: Partial<HostAiRouteCandidate> = {}): HostAiRouteCandidate {
  return {
    handshakeId: 'hs-1',
    ownerDeviceId: 'host-coord',
    ownerRole: 'host',
    requesterDeviceId: 'sand-coord',
    requesterRole: 'sandbox',
    transport: 'direct_http',
    endpoint: 'http://peer.example/beap/ingest',
    source: 'host_advertisement',
    isVerifiedPeerHost: true,
    ...over,
  }
}

describe('hostAiRouteCandidate predicates', () => {
  it('hostAiRouteCandidateBelongsToPeerHost matches owner host id', () => {
    const c = baseCandidate()
    expect(hostAiRouteCandidateBelongsToPeerHost(c, 'host-coord')).toBe(true)
    expect(hostAiRouteCandidateBelongsToPeerHost(c, 'other')).toBe(false)
    expect(hostAiRouteCandidateBelongsToPeerHost(c, '')).toBe(false)
    expect(hostAiRouteCandidateBelongsToPeerHost(c, '  host-coord  ')).toBe(true)
  })

  it('hostAiRouteCandidateBelongsToLocalDevice matches owner or requester', () => {
    const c = baseCandidate()
    expect(hostAiRouteCandidateBelongsToLocalDevice(c, 'host-coord')).toBe(true)
    expect(hostAiRouteCandidateBelongsToLocalDevice(c, 'sand-coord')).toBe(true)
    expect(hostAiRouteCandidateBelongsToLocalDevice(c, 'nope')).toBe(false)
    expect(hostAiRouteCandidateBelongsToLocalDevice(c, '')).toBe(false)
  })

  it('hostAiRouteCandidateIsDirectHttp', () => {
    expect(hostAiRouteCandidateIsDirectHttp(baseCandidate({ transport: 'direct_http' }))).toBe(true)
    expect(hostAiRouteCandidateIsDirectHttp(baseCandidate({ transport: 'webrtc_dc' }))).toBe(false)
    expect(hostAiRouteCandidateIsDirectHttp(baseCandidate({ transport: 'relay_tunnel' }))).toBe(false)
  })

  it('hostAiRouteCandidateIsTerminalIdentityProvenanceFailure for unverified HTTP/relay only', () => {
    expect(
      hostAiRouteCandidateIsTerminalIdentityProvenanceFailure(
        baseCandidate({ isVerifiedPeerHost: false, transport: 'direct_http' }),
      ),
    ).toBe(true)
    expect(
      hostAiRouteCandidateIsTerminalIdentityProvenanceFailure(
        baseCandidate({ isVerifiedPeerHost: false, transport: 'relay_tunnel' }),
      ),
    ).toBe(true)
    expect(
      hostAiRouteCandidateIsTerminalIdentityProvenanceFailure(
        baseCandidate({ isVerifiedPeerHost: false, transport: 'webrtc_dc' }),
      ),
    ).toBe(false)
    expect(
      hostAiRouteCandidateIsTerminalIdentityProvenanceFailure(
        baseCandidate({ isVerifiedPeerHost: true, transport: 'direct_http' }),
      ),
    ).toBe(false)
  })

  it('hostAiRouteCandidateMayBeDialed requires verification, peer match, endpoint for HTTP, freshness', () => {
    const ok = baseCandidate()
    expect(hostAiRouteCandidateMayBeDialed(ok, 'host-coord')).toBe(true)

    expect(hostAiRouteCandidateMayBeDialed(baseCandidate({ isVerifiedPeerHost: false }), 'host-coord')).toBe(
      false,
    )
    expect(hostAiRouteCandidateMayBeDialed(ok, 'wrong-peer')).toBe(false)
    expect(hostAiRouteCandidateMayBeDialed(baseCandidate({ endpoint: '  ' }), 'host-coord')).toBe(false)
    expect(hostAiRouteCandidateMayBeDialed(baseCandidate({ endpoint: undefined }), 'host-coord')).toBe(false)

    const t0 = 1_000_000
    expect(
      hostAiRouteCandidateMayBeDialed(baseCandidate({ expiresAt: t0 + 60_000 }), 'host-coord', t0),
    ).toBe(true)
    expect(hostAiRouteCandidateMayBeDialed(baseCandidate({ expiresAt: t0 }), 'host-coord', t0)).toBe(false)

    expect(
      hostAiRouteCandidateMayBeDialed(
        baseCandidate({ transport: 'webrtc_dc', endpoint: undefined }),
        'host-coord',
      ),
    ).toBe(true)
  })

  it('hostAiRouteFailureCodeIsTerminalIdentityProvenance covers new and existing Host AI codes', () => {
    expect(hostAiRouteFailureCodeIsTerminalIdentityProvenance(InternalInferenceErrorCode.HOST_AI_NO_VERIFIED_PEER_ROUTE)).toBe(
      true,
    )
    expect(
      hostAiRouteFailureCodeIsTerminalIdentityProvenance(InternalInferenceErrorCode.HOST_AI_LOCAL_BEAP_IS_NOT_PEER_HOST),
    ).toBe(true)
    expect(
      hostAiRouteFailureCodeIsTerminalIdentityProvenance(InternalInferenceErrorCode.HOST_AI_ROUTE_OWNER_MISMATCH),
    ).toBe(true)
    expect(
      hostAiRouteFailureCodeIsTerminalIdentityProvenance(InternalInferenceErrorCode.HOST_AI_CAPABILITY_ROLE_REJECTED),
    ).toBe(true)
    expect(hostAiRouteFailureCodeIsTerminalIdentityProvenance(InternalInferenceErrorCode.PROBE_TRANSPORT_NOT_READY)).toBe(
      false,
    )
  })

  it('hostAiRouteFailureCodeIsTerminalIdentityProvenance treats POLICY_FORBIDDEN as terminal', () => {
    expect(hostAiRouteFailureCodeIsTerminalIdentityProvenance(InternalInferenceErrorCode.POLICY_FORBIDDEN)).toBe(true)
  })

  it('hostAiDcCapabilityResultBlocksHttpFallback covers inference_error + terminal code and local role gate', () => {
    expect(hostAiDcCapabilityResultBlocksHttpFallback('role', InternalInferenceErrorCode.HOST_AI_CAPABILITY_ROLE_REJECTED)).toBe(
      true,
    )
    expect(
      hostAiDcCapabilityResultBlocksHttpFallback('inference_error', InternalInferenceErrorCode.HOST_AI_DIRECT_PEER_BEAP_MISSING),
    ).toBe(true)
    expect(hostAiDcCapabilityResultBlocksHttpFallback('timeout', undefined)).toBe(false)
  })

  it('isHostAiProbeTerminalNoPolicyFallback: deny details and forbidden_host_role message', () => {
    expect(
      isHostAiProbeTerminalNoPolicyFallback({
        ok: false,
        reason: InternalInferenceErrorCode.HOST_AI_PEER_ENDPOINT_MISSING,
      }),
    ).toBe(true)
    expect(
      isHostAiProbeTerminalNoPolicyFallback({
        ok: false,
        reason: 'http_500',
        hostAiEndpointDenyDetail: 'peer_host_beap_not_advertised',
      }),
    ).toBe(true)
    expect(
      isHostAiProbeTerminalNoPolicyFallback({
        ok: false,
        reason: 'forbidden',
        message: 'forbidden_host_role',
      }),
    ).toBe(true)
  })
})
