/**
 * When local WebRTC produces offer/answer/ICE, POST JSON to coordination /beap/p2p-signal (when enabled).
 * Bodies are not logged in production beyond byte counts.
 */
import { getHandshakeDbForInternalInference } from '../dbAccess'
import { getP2pInferenceFlags } from '../p2pInferenceFlags'
import { redactIdForLog } from '../internalInferenceLogRedact'
import { markP2pOfferSentForSession } from '../p2pSession/p2pInferenceSessionManager'
import { sendHostAiP2pSignalOutbound } from '../p2pSignalRelayPost'

export type OutboundP2pSignalKind = 'offer' | 'answer' | 'ice'

export function recordOutboundP2pSignal(
  kind: OutboundP2pSignalKind,
  meta: {
    handshakeId: string
    p2pSessionId: string
    byteLength: number
    iceEos?: boolean
    sdp?: string
    iceInit?: unknown
  },
): void {
  if (!getP2pInferenceFlags().p2pInferenceEnabled) {
    return
  }
  if (kind === 'offer') {
    markP2pOfferSentForSession(meta.handshakeId, meta.p2pSessionId)
    console.log(
      `[P2P_SIGNAL] outbound type=offer handshake=${meta.handshakeId} session=${redactIdForLog(meta.p2pSessionId)} bytes=${meta.byteLength}`,
    )
  } else {
    const eos = meta.iceEos ? ' ice_end' : ''
    console.log(
      `[P2P_SIGNAL] outbound type=${kind} handshake=${meta.handshakeId} session=${redactIdForLog(meta.p2pSessionId)} bytes=${meta.byteLength}${eos}`,
    )
  }

  const hid = meta.handshakeId.trim()
  const sid = meta.p2pSessionId.trim()
  if (!hid || !sid) return

  void (async () => {
    const db = await getHandshakeDbForInternalInference()
    if (!db) return
    const iceJson =
      kind === 'ice' && meta.iceInit && typeof meta.iceInit === 'object'
        ? JSON.stringify(meta.iceInit)
        : kind === 'ice' && meta.iceEos
          ? JSON.stringify({ candidate: '', sdpMid: null, sdpMLineIndex: null })
          : kind === 'ice'
            ? ''
            : undefined
    await sendHostAiP2pSignalOutbound({
      db,
      handshakeId: hid,
      p2pSessionId: sid,
      kind,
      sdp: kind !== 'ice' ? meta.sdp : undefined,
      iceCandidateJson: kind === 'ice' ? iceJson : undefined,
      iceEnd: kind === 'ice' ? meta.iceEos === true : undefined,
    })
  })()
}
