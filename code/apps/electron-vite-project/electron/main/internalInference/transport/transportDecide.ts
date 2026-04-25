/**
 * Transport selection for internal Host AI (no I/O, no `crypto` — unit-testable in Node/Vitest).
 */

import { getP2pInferenceFlags } from '../p2pInferenceFlags'
import { isP2pDataChannelUpForHandshake } from '../p2pSession/p2pSessionWait'
import type { HostAiTransport, HostAiTransportIntent, HostAiTransportLogReason, HostAiTransportPreference } from './hostAiTransportTypes'

export type HostAiTransportChoice = {
  preferred: HostAiTransportPreference
  selected: HostAiTransport
  reason: HostAiTransportLogReason
}

/**
 * True when the hidden WebRTC pod reports a live DataChannel for the P2P session
 * (see `p2pInferenceSessionManager` phase `datachannel_open` / `ready`).
 */
export function isWebrtcP2pDataPlaneAvailable(handshakeId: string): boolean {
  return isP2pDataChannelUpForHandshake(handshakeId)
}

function preferP2pForIntent(
  intent: HostAiTransportIntent,
  flags: ReturnType<typeof getP2pInferenceFlags>,
): boolean {
  if (intent === 'capabilities') {
    return flags.p2pInferenceCapsOverP2p
  }
  return flags.p2pInferenceRequestOverP2p
}

function p2pPrerequisitesSatisfied(
  _handshakeId: string,
  p2pTransportEndpointOpen: boolean,
  flags: ReturnType<typeof getP2pInferenceFlags>,
): boolean {
  if (!flags.p2pInferenceEnabled) {
    return false
  }
  if (!flags.p2pInferenceWebrtcEnabled) {
    return false
  }
  if (!flags.p2pInferenceSignalingEnabled) {
    return false
  }
  if (!p2pTransportEndpointOpen) {
    return false
  }
  if (!isWebrtcP2pDataPlaneAvailable(_handshakeId)) {
    return false
  }
  return true
}

/**
 * Intent-level P2P vs HTTP selection after `decideInternalInferenceTransport` (policy) has opened the endpoint.
 * The only place that picks transport for a given operation (caps / request / result to peer).
 * Does not log; callers emit [HOST_AI_TRANSPORT] from the result.
 */
export function decideHostAiIntentRoute(
  handshakeId: string,
  intent: HostAiTransportIntent,
  p2pTransportEndpointOpen: boolean,
): { choice: HostAiTransportChoice; shouldEmitFallbackLog: boolean } {
  const flags = getP2pInferenceFlags()
  const wantP2p = preferP2pForIntent(intent, flags)
  const p2pReady = p2pPrerequisitesSatisfied(handshakeId, p2pTransportEndpointOpen, flags)

  if (!p2pTransportEndpointOpen) {
    return {
      choice: { preferred: 'http', selected: 'unavailable', reason: 'non_direct_endpoint' },
      shouldEmitFallbackLog: false,
    }
  }

  if (wantP2p && p2pReady) {
    return {
      choice: { preferred: 'p2p', selected: 'webrtc_p2p', reason: 'p2p_chosen' },
      shouldEmitFallbackLog: false,
    }
  }

  if (wantP2p && !p2pReady) {
    if (flags.p2pInferenceHttpFallback) {
      return {
        choice: { preferred: 'p2p', selected: 'http_direct', reason: 'p2p_not_ready_fallback_http' },
        shouldEmitFallbackLog: true,
      }
    }
    return {
      choice: { preferred: 'p2p', selected: 'unavailable', reason: 'p2p_not_ready_no_fallback' },
      shouldEmitFallbackLog: false,
    }
  }

  return {
    choice: { preferred: 'http', selected: 'http_direct', reason: 'http_default' },
    shouldEmitFallbackLog: false,
  }
}
