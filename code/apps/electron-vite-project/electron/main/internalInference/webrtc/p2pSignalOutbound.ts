/**
 * When local WebRTC produces offer/answer/ICE, the coordination path reuses the same
 * p2p_signal / relay envelope (POST + WS) as remote peers. Bodies are not logged in production.
 */
import { getP2pInferenceFlags } from '../p2pInferenceFlags'
import { redactIdForLog } from '../internalInferenceLogRedact'
import { markP2pOfferSentForSession } from '../p2pSession/p2pInferenceSessionManager'

export type OutboundP2pSignalKind = 'offer' | 'answer' | 'ice'

export function recordOutboundP2pSignal(
  kind: OutboundP2pSignalKind,
  meta: { handshakeId: string; p2pSessionId: string; byteLength: number; iceEos?: boolean },
): void {
  if (!getP2pInferenceFlags().p2pInferenceEnabled) {
    return
  }
  if (kind === 'offer') {
    markP2pOfferSentForSession(meta.handshakeId, meta.p2pSessionId)
    console.log(
      `[P2P_SIGNAL] outbound type=offer handshake=${meta.handshakeId} session=${redactIdForLog(meta.p2pSessionId)} bytes=${meta.byteLength}`,
    )
    return
  }
  const eos = meta.iceEos ? ' ice_end' : ''
  console.log(
    `[P2P_SIGNAL] outbound type=${kind} handshake=${meta.handshakeId} session=${redactIdForLog(meta.p2pSessionId)} bytes=${meta.byteLength}${eos}`,
  )
}
