/**
 * Binds a new P2P session to the hidden WebRTC transport: ensure window, dispatch
 * `create` to the offerer PC, and wait for create_ack from the transport page.
 */
import { getHandshakeRecord } from '../handshake/db'
import { getCoordinationWsClient } from '../p2p/coordinationWsHolder'
import { InternalInferenceErrorCode, type InternalInferenceErrorCodeType } from './errors'
import { getP2pInferenceFlags } from './p2pInferenceFlags'
import { redactIdForLog } from './internalInferenceLogRedact'
import { getHandshakeDbForInternalInference } from './dbAccess'
import { shouldSendHostAiP2pSignalViaCoordination } from './p2pSignalRelayPost'

const CREATE_ACK_TIMEOUT_MS = 2_000
const RELAY_WS_READINESS_TIMEOUT_MS = 15_000
const RELAY_WS_POLL_MS = 200

/** @internal vitest: skip relay WebSocket wait (treat as ready). */
export const hostAiWebrtcOfferStartTestHooks: { skipRelayWebsocketReadiness: boolean } = {
  skipRelayWebsocketReadiness: false,
}

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
 * Inbound answer/ICE is delivered on the coordination WebSocket. Do not start the
 * WebRTC pod (and thus do not emit an offer) until the relay client is connected.
 */
async function waitForCoordinationWebsocketForRelayIfNeeded(
  hid: string,
  sid: string,
  signalingLogRole: 'offer' | 'answerer',
): Promise<void> {
  const db = await getHandshakeDbForInternalInference()
  if (!db) {
    return
  }
  const rec = getHandshakeRecord(db, hid)
  if (!shouldSendHostAiP2pSignalViaCoordination(db, rec?.p2p_endpoint)) {
    return
  }
  if (hostAiWebrtcOfferStartTestHooks.skipRelayWebsocketReadiness) {
    console.log(
      `[P2P_SIGNALING_STARTED] handshake=${hid} session=${redactIdForLog(sid)} relay_ws=connected test_skip=1`,
    )
    return
  }
  const t0 = Date.now()
  while (Date.now() - t0 < RELAY_WS_READINESS_TIMEOUT_MS) {
    if (getCoordinationWsClient()?.isConnected()) {
      console.log(
        `[P2P_SIGNALING_STARTED] handshake=${hid} session=${redactIdForLog(sid)} relay_ws=connected waited_ms=${Date.now() - t0}`,
      )
      return
    }
    await new Promise((r) => setTimeout(r, RELAY_WS_POLL_MS))
  }
  console.log(
    `[P2P_SIGNAL] failed type=${signalingLogRole} handshake=${hid} session=${redactIdForLog(sid)} code=${InternalInferenceErrorCode.SIGNALING_NOT_STARTED} reason=coordination_ws_not_ready`,
  )
  throw new HostAiWebrtcStartError(InternalInferenceErrorCode.SIGNALING_NOT_STARTED, 'coordination_ws_not_ready')
}

/**
 * Idempotent, awaited path: logs `offer_start_requested`, dispatches `create` to the pod, logs
 * `offer_create_dispatched`, waits for create_ack.
 *
 * @returns `OFFER_DISPATCHED` on success
 * @throws {@link HostAiWebrtcStartError} with `SIGNALING_NOT_STARTED`, `WEBRTC_TRANSPORT_NOT_READY`, or `OFFER_DISPATCH_FAILED`
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
  await waitForCoordinationWebsocketForRelayIfNeeded(hid, sid, 'offer')
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
  await waitForCoordinationWebsocketForRelayIfNeeded(hid, sid, 'answerer')
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
