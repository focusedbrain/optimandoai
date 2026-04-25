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

const base: Omit<HostAiTransportDeciderInput, 'featureFlags' | 'legacyEndpointInfo'> = {
  operationContext: 'list_targets',
  handshakeRecord: hr,
  handshakeDerivedRoles: rolesOk(),
  sessionState: { handshakeId: 'h1', p2pSession: null, dataChannelUp: false },
  hostPolicyState: null,
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

  it('WRDESK P2P+WebRTC on but stack incomplete (no signaling), direct — P2P_STACK_INCOMPLETE', () => {
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
      // Even if direct BEAP would validate, WebRTC path is the architecture — not legacy MVP.
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
    expect(r.failureCode).not.toBe('MVP_P2P_ENDPOINT_INVALID')
    expect(r.mayUseLegacyHttpFallback).toBe(true)
    expect(r.legacyHttpFallbackViable).toBe(true)
  })

  it('WebRTC enabled + full stack + relay + session signaling: preferred=webrtc_p2p, selector_phase=connecting (relay only blocks legacy HTTP)', () => {
    const r = decideInternalInferenceTransport({
      ...base,
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
})
