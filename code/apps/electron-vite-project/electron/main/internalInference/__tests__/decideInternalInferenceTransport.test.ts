import { describe, expect, it, afterEach, vi } from 'vitest'

/** Avoid loading real main graph (handshake db → ollama / email) via session manager. */
vi.mock('../p2pSession/p2pInferenceSessionManager', () => ({
  P2pSessionPhase: {
    idle: 'idle',
    signaling: 'signaling',
    connecting: 'connecting',
    datachannel_open: 'datachannel_open',
    ready: 'ready',
    failed: 'failed',
    closed: 'closed',
  },
  getSessionState: () => null,
}))

vi.mock('../p2pSession/p2pSessionWait', () => ({
  isP2pDataChannelUpForHandshake: () => false,
  waitForP2pDataChannelOrTimeout: async () => false,
}))

import { InternalInferenceErrorCode } from '../errors'
import { resetP2pInferenceFlagsForTests } from '../p2pInferenceFlags'
import {
  decideInternalInferenceTransport,
  type HandshakeDerivedRoles,
  type HostAiTransportDeciderInput,
} from '../transport/decideInternalInferenceTransport'
import { P2pSessionPhase } from '../p2pSession/p2pInferenceSessionManager'
import type { HandshakeRecord } from '../../handshake/types'

function rolesOk(): HandshakeDerivedRoles {
  return {
    ledgerSandboxToHost: true,
    samePrincipal: true,
    internalIdentityComplete: true,
    peerHostDeviceIdPresent: true,
  }
}

const hr = { handshake_id: 'h1' } as unknown as HandshakeRecord
const hrInternal = { handshake_id: 'h1', handshake_type: 'internal' } as unknown as HandshakeRecord

const base: Omit<
  HostAiTransportDeciderInput,
  'featureFlags' | 'legacyEndpointInfo' | 'relayHostAiP2pSignaling'
> = {
  operationContext: 'list_targets',
  handshakeRecord: hr,
  handshakeDerivedRoles: rolesOk(),
  sessionState: { handshakeId: 'h1', p2pSession: null, dataChannelUp: false },
  hostPolicyState: null,
  /** Non-internal rows ignore this for legacy POST gating; internal tests set explicitly. */
  hostAiVerifiedDirectHttp: false,
  hostAiVerifiedDirectIngestUrl: null,
  hostAiRouteResolveFailureCode: null,
  hostAiRouteResolveFailureReason: null,
}

afterEach(() => {
  vi.unstubAllEnvs()
  resetP2pInferenceFlagsForTests()
})

describe('decideInternalInferenceTransport (STEP 4 legacy vs WebRTC)', () => {
  it('legacy only (P2P+WebRTC off): invalid direct — MVP is failure (isolated to legacy path)', () => {
    const r = decideInternalInferenceTransport({
      ...base,
      featureFlags: {
        p2pInferenceEnabled: false,
        p2pInferenceWebrtcEnabled: false,
        p2pInferenceSignalingEnabled: false,
        p2pInferenceHttpFallback: true,
        p2pInferenceCapsOverP2p: false,
        p2pInferenceRequestOverP2p: false,
        p2pInferenceHttpInternalCompat: false,
        p2pInferenceVerboseLogs: false,
        p2pInferenceAnalysisLog: false,
        p2pInferenceDataChannelCapabilities: false,
        p2pInferenceDataChannelInference: false,
      },
      legacyEndpointInfo: {
        p2pEndpointKind: 'direct',
        mayPostInternalInferenceHttpToIngest: false,
        mvpClassForLog: 'invalid',
        p2pEndpointGateOpen: false,
      },
    })
    expect(r.selectorPhase).toBe('legacy_http_invalid')
    expect(r.failureCode).toBe('MVP_P2P_ENDPOINT_INVALID')
    expect(r.legacyHttpFallbackViable).toBe(false)
  })

  it('WRDESK P2P+WebRTC on, no signaling, relay — connecting; relay is not legacy MVP (legacy HTTP invalid only)', () => {
    const r = decideInternalInferenceTransport({
      ...base,
      featureFlags: {
        p2pInferenceEnabled: true,
        p2pInferenceWebrtcEnabled: true,
        p2pInferenceSignalingEnabled: false,
        p2pInferenceHttpFallback: true,
        p2pInferenceCapsOverP2p: false,
        p2pInferenceRequestOverP2p: false,
        p2pInferenceHttpInternalCompat: false,
        p2pInferenceVerboseLogs: false,
        p2pInferenceAnalysisLog: false,
        p2pInferenceDataChannelCapabilities: false,
        p2pInferenceDataChannelInference: false,
      },
      legacyEndpointInfo: {
        p2pEndpointKind: 'relay',
        mayPostInternalInferenceHttpToIngest: false,
        mvpClassForLog: 'relay',
        p2pEndpointGateOpen: false,
      },
    })
    expect(r.selectorPhase).toBe('connecting')
    expect(r.preferredTransport).toBe('webrtc_p2p')
    expect(r.p2pTransportEndpointOpen).toBe(true)
    expect(r.failureCode).toBeNull()
    expect(r.legacyHttpFallbackViable).toBe(false)
  })

  it('internal Sandbox→Host + direct ingest: prefer direct_http even when P2P stack is incomplete', () => {
    const r = decideInternalInferenceTransport({
      ...base,
      handshakeRecord: hrInternal,
      hostAiVerifiedDirectHttp: true,
      hostAiVerifiedDirectIngestUrl: 'http://192.168.0.2:51249/beap/ingest',
      hostAiRouteResolveFailureCode: null,
      hostAiRouteResolveFailureReason: null,
      featureFlags: {
        p2pInferenceEnabled: true,
        p2pInferenceWebrtcEnabled: true,
        p2pInferenceSignalingEnabled: false,
        p2pInferenceHttpFallback: true,
        p2pInferenceCapsOverP2p: false,
        p2pInferenceRequestOverP2p: false,
        p2pInferenceHttpInternalCompat: false,
        p2pInferenceVerboseLogs: false,
        p2pInferenceAnalysisLog: false,
        p2pInferenceDataChannelCapabilities: false,
        p2pInferenceDataChannelInference: false,
      },
      legacyEndpointInfo: {
        p2pEndpointKind: 'direct',
        mayPostInternalInferenceHttpToIngest: true,
        mvpClassForLog: 'direct_lan',
        p2pEndpointGateOpen: true,
      },
    })
    expect(r.selectorPhase).toBe('legacy_http_available')
    expect(r.preferredTransport).toBe('legacy_http')
    expect(r.failureCode).toBeNull()
    expect(r.mayUseLegacyHttpFallback).toBe(true)
    expect(r.legacyHttpFallbackViable).toBe(true)
  })

  it('internal: syntactically valid LAN direct URL without verified peer-Host ad — no legacy_http (P2P stack off)', () => {
    const r = decideInternalInferenceTransport({
      ...base,
      handshakeRecord: {
        ...hrInternal,
        p2p_endpoint: 'http://192.168.1.10:51249/beap/ingest',
      } as HandshakeRecord,
      hostAiVerifiedDirectHttp: false,
      hostAiVerifiedDirectIngestUrl: null,
      hostAiRouteResolveFailureCode: InternalInferenceErrorCode.HOST_AI_DIRECT_PEER_BEAP_MISSING,
      hostAiRouteResolveFailureReason: 'no_peer_host_direct_or_relay',
      featureFlags: {
        p2pInferenceEnabled: false,
        p2pInferenceWebrtcEnabled: false,
        p2pInferenceSignalingEnabled: false,
        p2pInferenceHttpFallback: true,
        p2pInferenceCapsOverP2p: false,
        p2pInferenceRequestOverP2p: false,
        p2pInferenceHttpInternalCompat: false,
        p2pInferenceVerboseLogs: false,
        p2pInferenceAnalysisLog: false,
        p2pInferenceDataChannelCapabilities: false,
        p2pInferenceDataChannelInference: false,
      },
      legacyEndpointInfo: {
        p2pEndpointKind: 'direct',
        mayPostInternalInferenceHttpToIngest: true,
        mvpClassForLog: 'direct_lan',
        p2pEndpointGateOpen: true,
      },
    })
    expect(r.preferredTransport).not.toBe('legacy_http')
    expect(r.selectorPhase).toBe('legacy_http_invalid')
    expect(r.legacyHttpFallbackViable).toBe(false)
    expect(r.hostAiVerifiedDirectHttp).toBe(false)
    expect(r.p2pTransportEndpointOpen).toBe(true)
  })

  it('non-internal + direct + incomplete P2P stack — still P2P_STACK_INCOMPLETE (WebRTC architecture)', () => {
    const r = decideInternalInferenceTransport({
      ...base,
      handshakeRecord: hr,
      featureFlags: {
        p2pInferenceEnabled: true,
        p2pInferenceWebrtcEnabled: true,
        p2pInferenceSignalingEnabled: false,
        p2pInferenceHttpFallback: true,
        p2pInferenceCapsOverP2p: false,
        p2pInferenceRequestOverP2p: false,
        p2pInferenceHttpInternalCompat: false,
        p2pInferenceVerboseLogs: false,
        p2pInferenceAnalysisLog: false,
        p2pInferenceDataChannelCapabilities: false,
        p2pInferenceDataChannelInference: false,
      },
      legacyEndpointInfo: {
        p2pEndpointKind: 'direct',
        mayPostInternalInferenceHttpToIngest: true,
        mvpClassForLog: 'direct_lan',
        p2pEndpointGateOpen: true,
      },
    })
    expect(r.selectorPhase).toBe('p2p_unavailable')
    expect(r.failureCode).toBe('P2P_STACK_INCOMPLETE')
    expect(r.preferredTransport).toBe('webrtc_p2p')
  })

  it('WebRTC enabled + full stack + relay + session signaling: preferred=webrtc_p2p, selector_phase=connecting (relay only blocks legacy HTTP)', () => {
    const r = decideInternalInferenceTransport({
      ...base,
      relayHostAiP2pSignaling: 'supported',
      featureFlags: {
        p2pInferenceEnabled: true,
        p2pInferenceWebrtcEnabled: true,
        p2pInferenceSignalingEnabled: true,
        p2pInferenceHttpFallback: true,
        p2pInferenceCapsOverP2p: false,
        p2pInferenceRequestOverP2p: false,
        p2pInferenceHttpInternalCompat: false,
        p2pInferenceVerboseLogs: false,
        p2pInferenceAnalysisLog: false,
        p2pInferenceDataChannelCapabilities: false,
        p2pInferenceDataChannelInference: false,
      },
      legacyEndpointInfo: {
        p2pEndpointKind: 'relay',
        mayPostInternalInferenceHttpToIngest: false,
        mvpClassForLog: 'relay',
        p2pEndpointGateOpen: true,
      },
      sessionState: {
        handshakeId: 'h1',
        p2pSession: { phase: P2pSessionPhase.signaling } as any,
        dataChannelUp: false,
      },
    })
    expect(r.preferredTransport).toBe('webrtc_p2p')
    expect(r.selectorPhase).toBe('connecting')
    expect(r.targetDetected).toBe(true)
    expect(r.legacyHttpFallbackViable).toBe(false)
  })

  it('relay + stale p2pEndpointGateOpen false + full stack: WebRTC not blocked; connecting when signaling (gate repair for relay only)', () => {
    const r = decideInternalInferenceTransport({
      ...base,
      relayHostAiP2pSignaling: 'supported',
      featureFlags: {
        p2pInferenceEnabled: true,
        p2pInferenceWebrtcEnabled: true,
        p2pInferenceSignalingEnabled: true,
        p2pInferenceHttpFallback: true,
        p2pInferenceCapsOverP2p: false,
        p2pInferenceRequestOverP2p: false,
        p2pInferenceHttpInternalCompat: false,
        p2pInferenceVerboseLogs: false,
        p2pInferenceAnalysisLog: false,
        p2pInferenceDataChannelCapabilities: false,
        p2pInferenceDataChannelInference: false,
      },
      legacyEndpointInfo: {
        p2pEndpointKind: 'relay',
        mayPostInternalInferenceHttpToIngest: false,
        mvpClassForLog: 'relay',
        p2pEndpointGateOpen: false,
      },
      sessionState: {
        handshakeId: 'h1',
        p2pSession: { phase: P2pSessionPhase.signaling } as any,
        dataChannelUp: false,
      },
    })
    expect(r.preferredTransport).toBe('webrtc_p2p')
    expect(r.selectorPhase).toBe('connecting')
    expect(r.failureCode).toBeNull()
  })

  it('full stack: transport open, DataChannel up — ready, MVP never applies', () => {
    const r = decideInternalInferenceTransport({
      ...base,
      relayHostAiP2pSignaling: 'supported',
      featureFlags: {
        p2pInferenceEnabled: true,
        p2pInferenceWebrtcEnabled: true,
        p2pInferenceSignalingEnabled: true,
        p2pInferenceHttpFallback: false,
        p2pInferenceCapsOverP2p: false,
        p2pInferenceRequestOverP2p: false,
        p2pInferenceHttpInternalCompat: false,
        p2pInferenceVerboseLogs: false,
        p2pInferenceAnalysisLog: false,
        p2pInferenceDataChannelCapabilities: false,
        p2pInferenceDataChannelInference: false,
      },
      legacyEndpointInfo: {
        p2pEndpointKind: 'relay',
        mayPostInternalInferenceHttpToIngest: false,
        mvpClassForLog: 'relay',
        p2pEndpointGateOpen: true,
      },
      sessionState: {
        handshakeId: 'h1',
        p2pSession: { phase: P2pSessionPhase.datachannel_open } as any,
        dataChannelUp: true,
      },
    })
    expect(r.selectorPhase).toBe('ready')
    expect(r.failureCode).toBeNull()
  })

  it('relay + full P2P stack + missing host_ai_p2p_signaling capability → p2p_unavailable, no webrtc_p2p', () => {
    const r = decideInternalInferenceTransport({
      ...base,
      relayHostAiP2pSignaling: 'missing',
      featureFlags: {
        p2pInferenceEnabled: true,
        p2pInferenceWebrtcEnabled: true,
        p2pInferenceSignalingEnabled: true,
        p2pInferenceHttpFallback: true,
        p2pInferenceCapsOverP2p: false,
        p2pInferenceRequestOverP2p: false,
        p2pInferenceHttpInternalCompat: false,
        p2pInferenceVerboseLogs: false,
        p2pInferenceAnalysisLog: false,
        p2pInferenceDataChannelCapabilities: false,
        p2pInferenceDataChannelInference: false,
      },
      legacyEndpointInfo: {
        p2pEndpointKind: 'relay',
        mayPostInternalInferenceHttpToIngest: false,
        mvpClassForLog: 'relay',
        p2pEndpointGateOpen: true,
      },
    })
    expect(r.selectorPhase).toBe('p2p_unavailable')
    expect(r.preferredTransport).toBe('none')
    expect(r.failureCode).toBe('RELAY_HOST_AI_P2P_SIGNALING_UNAVAILABLE')
    expect(r.p2pTransportEndpointOpen).toBe(false)
  })
})
