/**
 * Binds a new P2P session to the hidden WebRTC transport: ensure window, dispatch
 * `create` to the offerer PC, and wait for create_ack from the transport page.
 */
import { InternalInferenceErrorCode, type InternalInferenceErrorCodeType } from './errors'
import { getP2pInferenceFlags } from './p2pInferenceFlags'
import { redactIdForLog } from './internalInferenceLogRedact'

const CREATE_ACK_TIMEOUT_MS = 2_000

/** Return when IPC path completed and the transport will create the offerer PC. */
export type WebrtcOfferStartResult = 'OFFER_DISPATCHED'

export class HostAiWebrtcStartError extends Error {
  constructor(
    public readonly errorCode: InternalInferenceErrorCodeType,
    message: string,
  ) {
    super(message)
    this.name = 'HostAiWebrtcStartError'
  }
}

/**
 * Idempotent, awaited path: logs `offer_start_requested`, dispatches `create` to the pod, logs
 * `offer_create_dispatched`, waits for create_ack.
 *
 * @returns `OFFER_DISPATCHED` on success
 * @throws {@link HostAiWebrtcStartError} with `WEBRTC_TRANSPORT_NOT_READY` or `OFFER_DISPATCH_FAILED`
 */
export async function startWebrtcOfferForHostAiSession(
  handshakeId: string,
  p2pSessionId: string,
  _reason: string,
): Promise<WebrtcOfferStartResult> {
  const hid = handshakeId.trim()
  const sid = p2pSessionId.trim()
  if (!hid || !sid) {
    throw new HostAiWebrtcStartError(InternalInferenceErrorCode.MALFORMED_SERVICE_MESSAGE, 'handshake or session id')
  }
  if (!getP2pInferenceFlags().p2pInferenceWebrtcEnabled) {
    throw new HostAiWebrtcStartError(InternalInferenceErrorCode.WEBRTC_TRANSPORT_NOT_READY, 'webrtc flag off')
  }
  console.log(`[P2P_SIGNAL] offer_start_requested handshake=${hid} session=${redactIdForLog(sid)}`)
  const { waitForWebrtcPodCreateAck, webrtcCreatePeerConnection } = await import('./webrtc/webrtcTransportIpc')
  const { ensureWebrtcTransportWindow } = await import('./webrtc/webrtcTransportWindow')
  try {
    await ensureWebrtcTransportWindow()
  } catch (e) {
    throw new HostAiWebrtcStartError(
      InternalInferenceErrorCode.WEBRTC_TRANSPORT_NOT_READY,
      e instanceof Error ? e.message : 'ensure_webrtc_window_failed',
    )
  }
  const ackPromise = waitForWebrtcPodCreateAck(sid, CREATE_ACK_TIMEOUT_MS)
  try {
    await webrtcCreatePeerConnection(sid, hid, 'offerer')
  } catch (e) {
    throw new HostAiWebrtcStartError(
      InternalInferenceErrorCode.OFFER_DISPATCH_FAILED,
      e instanceof Error ? e.message : 'webrtcCreatePeerConnection_failed',
    )
  }
  console.log(
    `[P2P_SIGNAL] offer_create_dispatched handshake=${hid} session=${redactIdForLog(sid)} target=internal-inference-p2p-transport`,
  )
  try {
    await ackPromise
  } catch {
    throw new HostAiWebrtcStartError(InternalInferenceErrorCode.WEBRTC_TRANSPORT_NOT_READY, 'create_ack_timeout')
  }
  return 'OFFER_DISPATCHED'
}

/**
 * Acceptor side: `RTCPeerConnection` with role `answerer` (inbound offer will be applied; no local createOffer).
 * Same IPC contract as the offerer path (create_ack).
 */
export async function startWebrtcAnswererForHostAiSession(
  handshakeId: string,
  p2pSessionId: string,
  _reason: string,
): Promise<WebrtcOfferStartResult> {
  const hid = handshakeId.trim()
  const sid = p2pSessionId.trim()
  if (!hid || !sid) {
    throw new HostAiWebrtcStartError(InternalInferenceErrorCode.MALFORMED_SERVICE_MESSAGE, 'handshake or session id')
  }
  if (!getP2pInferenceFlags().p2pInferenceWebrtcEnabled) {
    throw new HostAiWebrtcStartError(InternalInferenceErrorCode.WEBRTC_TRANSPORT_NOT_READY, 'webrtc flag off')
  }
  console.log(`[P2P_SIGNAL] webrtc_answerer_start handshake=${hid} session=${redactIdForLog(sid)}`)
  const { waitForWebrtcPodCreateAck, webrtcCreatePeerConnection } = await import('./webrtc/webrtcTransportIpc')
  const { ensureWebrtcTransportWindow } = await import('./webrtc/webrtcTransportWindow')
  try {
    await ensureWebrtcTransportWindow()
  } catch (e) {
    throw new HostAiWebrtcStartError(
      InternalInferenceErrorCode.WEBRTC_TRANSPORT_NOT_READY,
      e instanceof Error ? e.message : 'ensure_webrtc_window_failed',
    )
  }
  const ackPromise = waitForWebrtcPodCreateAck(sid, CREATE_ACK_TIMEOUT_MS)
  try {
    await webrtcCreatePeerConnection(sid, hid, 'answerer')
  } catch (e) {
    throw new HostAiWebrtcStartError(
      InternalInferenceErrorCode.OFFER_DISPATCH_FAILED,
      e instanceof Error ? e.message : 'webrtcCreatePeerConnection_answerer_failed',
    )
  }
  console.log(
    `[P2P_SIGNAL] webrtc_answerer_dispatched handshake=${hid} session=${redactIdForLog(sid)} target=internal-inference-p2p-transport`,
  )
  try {
    await ackPromise
  } catch {
    throw new HostAiWebrtcStartError(InternalInferenceErrorCode.WEBRTC_TRANSPORT_NOT_READY, 'create_ack_timeout')
  }
  return 'OFFER_DISPATCHED'
}

/** @deprecated Use {@link startWebrtcOfferForHostAiSession} */
export const startHostAiP2pWebrtcSessionOffer = startWebrtcOfferForHostAiSession
