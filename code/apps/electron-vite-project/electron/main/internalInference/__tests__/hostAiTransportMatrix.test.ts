import { describe, expect, it, vi, beforeEach } from 'vitest'
import { isHostAiListTransportProven } from '../hostAiTransportMatrix'
import type { HostAiTransportDeciderResult } from '../transport/decideInternalInferenceTransport'

vi.mock('../p2pSession/p2pSessionWait', () => ({
  isP2pDataChannelUpForHandshake: vi.fn(),
}))

import { isP2pDataChannelUpForHandshake } from '../p2pSession/p2pSessionWait'

const base: HostAiTransportDeciderResult = {
  targetDetected: true,
  selectorPhase: 'connecting',
  preferredTransport: 'webrtc_p2p',
  mayUseLegacyHttpFallback: true,
  legacyHttpFallbackViable: true,
  p2pTransportEndpointOpen: true,
  failureCode: null,
  userSafeReason: null,
  hostAiVerifiedDirectHttp: false,
  hostAiRouteResolveFailureCode: null,
  hostAiRouteResolveFailureReason: null,
  inferenceHandshakeTrusted: false,
  inferenceTrustedUrl: null,
  inferenceHandshakeTrustReason: null,
}

describe('isHostAiListTransportProven', () => {
  beforeEach(() => {
    vi.mocked(isP2pDataChannelUpForHandshake).mockReturnValue(false)
  })

  it('is true for selector ready (DC path)', () => {
    const d: HostAiTransportDeciderResult = { ...base, selectorPhase: 'ready' }
    expect(isHostAiListTransportProven(d, 'h1')).toBe(true)
  })

  it('is true for legacy HTTP available (direct internal preference)', () => {
    const d: HostAiTransportDeciderResult = {
      ...base,
      preferredTransport: 'legacy_http',
      selectorPhase: 'legacy_http_available',
    }
    expect(isHostAiListTransportProven(d, 'h1')).toBe(true)
  })

  it('is true when webrtc+stale selector connecting but data channel is up', () => {
    vi.mocked(isP2pDataChannelUpForHandshake).mockReturnValue(true)
    const d: HostAiTransportDeciderResult = { ...base, selectorPhase: 'connecting' }
    expect(isHostAiListTransportProven(d, 'h1')).toBe(true)
  })

  it('is false when webrtc+connecting and data channel is not up', () => {
    const d: HostAiTransportDeciderResult = { ...base, selectorPhase: 'connecting' }
    expect(isHostAiListTransportProven(d, 'h1')).toBe(false)
  })
})
