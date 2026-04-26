/**
 * Main-process control plane for the hidden WebRTC pod: strict sender checks, no SDP/ICE logging.
 */
import { ipcMain } from 'electron'
import { getP2pInferenceFlags } from '../p2pInferenceFlags'
import { markDataChannelOpenForP2pSession } from '../p2pSession/p2pInferenceSessionManager'
import { tryRouteP2pDataChannelJsonMessage } from '../p2pDc/p2pDcCapabilities'
import { redactIdForLog } from '../internalInferenceLogRedact'
import { recordOutboundP2pSignal } from './p2pSignalOutbound'
import { ensureWebrtcTransportWindow, getWebrtcTransportPreloadPath, getWebrtcTransportWindowOrNull } from './webrtcTransportWindow'

const TO_MAIN = 'p2p-webrtc:to-main'
const FROM_MAIN = 'p2p-webrtc:from-main'

const MAX_DC_FRAME_BYTES = 2_000_000

let registered = false

const createAckBySessionId = new Map<string, { resolve: () => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>()

/**
 * Resolves when the transport page acknowledges `op: 'create'` (before `RTCPeerConnection` work).
 */
export function waitForWebrtcPodCreateAck(p2pSessionId: string, timeoutMs: number): Promise<void> {
  const sid = typeof p2pSessionId === 'string' ? p2pSessionId.trim() : ''
  return new Promise((resolve, reject) => {
    if (!sid) {
      reject(new Error('no_session_id'))
      return
    }
    const prev = createAckBySessionId.get(sid)
    if (prev) {
      clearTimeout(prev.timer)
      createAckBySessionId.delete(sid)
    }
    const timer = setTimeout(() => {
      createAckBySessionId.delete(sid)
      reject(new Error('create_ack_timeout'))
    }, timeoutMs)
    createAckBySessionId.set(sid, { resolve, reject, timer })
  })
}

function assertFromTransportPod(sender: Electron.WebContents): boolean {
  const w = getWebrtcTransportWindowOrNull()
  if (!w || w.isDestroyed()) {
    return false
  }
  return sender.id === w.webContents.id
}

function sendToPod(msg: unknown) {
  const w = getWebrtcTransportWindowOrNull()
  if (!w || w.isDestroyed()) {
    return
  }
  w.webContents.send(FROM_MAIN, msg)
}

type Role = 'offerer' | 'answerer'

export async function webrtcCreatePeerConnection(
  p2pSessionId: string,
  handshakeId: string,
  role: Role,
): Promise<void> {
  const w = await ensureWebrtcTransportWindow()
  w.webContents.send(FROM_MAIN, { op: 'create', sessionId: p2pSessionId, handshakeId, role })
}

export async function webrtcApplyRemoteOffer(
  p2pSessionId: string,
  handshakeId: string,
  sdp: string,
): Promise<void> {
  const w = await ensureWebrtcTransportWindow()
  w.webContents.send(FROM_MAIN, { op: 'applyRemoteOffer', sessionId: p2pSessionId, handshakeId, sdp })
}

export async function webrtcApplyRemoteAnswer(
  p2pSessionId: string,
  handshakeId: string,
  sdp: string,
): Promise<void> {
  const w = await ensureWebrtcTransportWindow()
  w.webContents.send(FROM_MAIN, { op: 'applyRemoteAnswer', sessionId: p2pSessionId, handshakeId, sdp })
}

export async function webrtcAddIceCandidate(
  p2pSessionId: string,
  handshakeId: string,
  init: unknown,
): Promise<void> {
  if (!init || typeof init !== 'object') {
    return
  }
  const w = await ensureWebrtcTransportWindow()
  w.webContents.send(FROM_MAIN, { op: 'addIceCandidate', sessionId: p2pSessionId, handshakeId, candidate: init })
}

export async function webrtcCloseSession(p2pSessionId: string, handshakeId: string): Promise<void> {
  const w = getWebrtcTransportWindowOrNull()
  if (!w) {
    return
  }
  w.webContents.send(FROM_MAIN, { op: 'close', sessionId: p2pSessionId, handshakeId })
}

export async function webrtcSendData(
  p2pSessionId: string,
  handshakeId: string,
  bytes: ArrayBuffer,
): Promise<void> {
  if (bytes.byteLength > MAX_DC_FRAME_BYTES) {
    return
  }
  const w = await ensureWebrtcTransportWindow()
  w.webContents.send(FROM_MAIN, { op: 'sendData', sessionId: p2pSessionId, handshakeId, bytes })
}

function onRendererToMain(_sender: Electron.WebContents, msg: unknown) {
  if (!getP2pInferenceFlags().p2pInferenceWebrtcEnabled) {
    return
  }
  if (!msg || typeof msg !== 'object' || (msg as { v?: unknown }).v !== 1) {
    return
  }
  const m = msg as Record<string, unknown>
  const t = m.type
  if (typeof t !== 'string' || t === '') {
    return
  }
  const sessionId = typeof m.sessionId === 'string' ? m.sessionId : ''
  const handshakeId = typeof m.handshakeId === 'string' ? m.handshakeId : ''
  switch (t) {
    case 'create_ack': {
      if (sessionId) {
        const w = createAckBySessionId.get(sessionId)
        if (w) {
          clearTimeout(w.timer)
          createAckBySessionId.delete(sessionId)
          w.resolve()
        }
      }
      break
    }
    case 'create_offer_begin': {
      if (handshakeId && sessionId) {
        console.log(
          `[P2P_WEBRTC] create_offer_begin handshake=${handshakeId} session=${redactIdForLog(sessionId)}`,
        )
      }
      break
    }
    case 'create_offer_ok': {
      const n = m.sdpBytes
      if (handshakeId && sessionId && typeof n === 'number') {
        console.log(
          `[P2P_WEBRTC] create_offer_ok handshake=${handshakeId} session=${redactIdForLog(sessionId)} sdp_bytes=${n}`,
        )
      }
      break
    }
    case 'offer': {
      const sdp = m.sdp
      if (typeof sdp === 'string' && sessionId && handshakeId) {
        recordOutboundP2pSignal('offer', {
          p2pSessionId: sessionId,
          handshakeId,
          byteLength: sdp.length,
        })
      }
      break
    }
    case 'answer': {
      const sdp = m.sdp
      if (typeof sdp === 'string' && sessionId && handshakeId) {
        recordOutboundP2pSignal('answer', { p2pSessionId: sessionId, handshakeId, byteLength: sdp.length })
      }
      break
    }
    case 'ice': {
      const end = m.end === true
      if (end) {
        recordOutboundP2pSignal('ice', { p2pSessionId: sessionId, handshakeId, byteLength: 0, iceEos: true })
        break
      }
      const init = m.init
      const s = init && typeof init === 'object' ? JSON.stringify(init) : ''
      if (sessionId && handshakeId) {
        recordOutboundP2pSignal('ice', { p2pSessionId: sessionId, handshakeId, byteLength: s.length })
      }
      break
    }
    case 'message': {
      const bl = m.byteLength
      if (typeof bl !== 'number' || bl < 0 || bl > MAX_DC_FRAME_BYTES) {
        return
      }
      const b = m.bytes
      if (!(b instanceof Uint8Array) || b.length !== bl) {
        return
      }
      if (sessionId && handshakeId) {
        try {
          const s = new TextDecoder('utf-8', { fatal: false }).decode(b)
          if (tryRouteP2pDataChannelJsonMessage(sessionId, handshakeId, s)) {
            return
          }
        } catch {
          /* non-JSON */
        }
      }
      break
    }
    case 'datachannel_open': {
      if (handshakeId && sessionId) {
        if (handshakeId !== '__local_test__') {
          markDataChannelOpenForP2pSession(handshakeId, sessionId)
        }
        console.log(
          `[P2P_WEBRTC] datachannel_open handshake=${handshakeId} session=${redactIdForLog(sessionId)}`,
        )
      }
      break
    }
    case 'datachannel_close': {
      if (handshakeId && sessionId) {
        console.log(
          `[P2P_WEBRTC] datachannel_close session=${redactIdForLog(sessionId)} handshake=${handshakeId}`,
        )
      }
      break
    }
    case 'error': {
      const code = typeof m.code === 'string' ? m.code : 'unknown'
      const msg0 = m.message
      const safe =
        typeof msg0 === 'string' && msg0.length
          ? msg0.length > 200
            ? `${msg0.slice(0, 200)}…`
            : msg0
          : ''
      if (handshakeId && sessionId) {
        if (code === 'create_offer') {
          console.log(
            `[P2P_WEBRTC] create_offer_failed handshake=${handshakeId} session=${redactIdForLog(sessionId)} code=create_offer message=${JSON.stringify(safe || '(empty)')}`,
          )
        } else {
          console.log(`[P2P_WEBRTC] error session=${redactIdForLog(sessionId)} code=${code}`)
        }
      }
      break
    }
    case 'state': {
      break
    }
    default: {
      break
    }
  }
}

/**
 * @internal  Used by the coordination relay path after session manager validation.
 * Expects the relay payload; optional `sdp` and `ice` (JSON) when peers exchange WebRTC.
 */
export function tryApplyRelayPayloadToWebrtcPod(p: Record<string, unknown>): void {
  if (!getP2pInferenceFlags().p2pInferenceWebrtcEnabled) {
    return
  }
  const sessionId = typeof p.session_id === 'string' ? p.session_id.trim() : ''
  const handshakeId = typeof p.handshake_id === 'string' ? p.handshake_id.trim() : ''
  if (!sessionId || !handshakeId) {
    return
  }
  const st = p.signal_type
  if (st === 'p2p_inference_offer' && typeof p.sdp === 'string' && p.sdp.length) {
    void webrtcApplyRemoteOffer(sessionId, handshakeId, p.sdp)
    return
  }
  if (st === 'p2p_inference_answer' && typeof p.sdp === 'string' && p.sdp.length) {
    void webrtcApplyRemoteAnswer(sessionId, handshakeId, p.sdp)
    return
  }
  if (st === 'p2p_inference_ice') {
    if (p.ice) {
      try {
        const init = JSON.parse(String(p.ice))
        void webrtcAddIceCandidate(sessionId, handshakeId, init)
      } catch {
        return
      }
    } else if (p.candidate) {
      try {
        const init = JSON.parse(String(p.candidate))
        void webrtcAddIceCandidate(sessionId, handshakeId, init)
      } catch {
        return
      }
    }
  }
}

export function registerWebrtcTransportIpc(): void {
  if (registered) {
    return
  }
  registered = true
  ipcMain.on(TO_MAIN, (e, msg) => {
    if (!assertFromTransportPod(e.sender)) {
      return
    }
    onRendererToMain(e.sender, msg)
  })
  ipcMain.handle('internal-inference:webrtc:runLocalPairTest', async () => {
    if (!getP2pInferenceFlags().p2pInferenceWebrtcEnabled) {
      return { ok: false as const, error: 'WRDESK_P2P_INFERENCE_WEBRTC_ENABLED=0' }
    }
    const win = await ensureWebrtcTransportWindow()
    win.webContents.send(FROM_MAIN, { op: 'localPairTest' } as const)
    return { ok: true as const, preload: getWebrtcTransportPreloadPath() }
  })
}

export { TO_MAIN, FROM_MAIN }
