/**
 * Hidden WebRTC "pod" — RTCPeerConnection + RTCDataChannel only.
 * No Ollama, no prompt/completion; never log SDP/ICE bodies to console.
 */

const RTC_CFG: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
}

type Role = 'offerer' | 'answerer'

type WrdeskWebrtcP2p = {
  onFromMain: (cb: (msg: unknown) => void) => () => void
  toMain: (msg: unknown) => void
}

type Session = {
  sessionId: string
  handshakeId: string
  role: Role
  pc: RTCPeerConnection
  dc: RTCDataChannel | null
}

const sessions = new Map<string, Session>()

type FromMain =
  | { op: 'create'; sessionId: string; handshakeId: string; role: Role }
  | { op: 'applyRemoteOffer'; sessionId: string; handshakeId: string; sdp: string }
  | { op: 'applyRemoteAnswer'; sessionId: string; handshakeId: string; sdp: string }
  | { op: 'addIceCandidate'; sessionId: string; handshakeId: string; candidate: RTCIceCandidateInit }
  | { op: 'close'; sessionId: string; handshakeId: string }
  | { op: 'sendData'; sessionId: string; handshakeId: string; bytes: ArrayBuffer }
  | { op: 'localPairTest' }

function getPod(): WrdeskWebrtcP2p {
  const p = (window as unknown as { wrdeskWebrtcP2p?: WrdeskWebrtcP2p }).wrdeskWebrtcP2p
  if (!p) {
    throw new Error('wrdeskWebrtcP2p missing')
  }
  return p
}

function out(ev: Record<string, unknown>) {
  getPod().toMain(ev)
}

function emitState(sessionId: string, handshakeId: string, s: { ice: string; conn: string; iceGathering: string }) {
  out({ v: 1, type: 'state', sessionId, handshakeId, ...s })
}

function emitError(sessionId: string, handshakeId: string, code: string, message: string) {
  out({ v: 1, type: 'error', sessionId, handshakeId, code, message })
}

function onPcSession(session: Session) {
  const { pc, sessionId, handshakeId } = session
  pc.onicecandidate = (e) => {
    if (!e.candidate) {
      out({ v: 1, type: 'ice', sessionId, handshakeId, end: true })
      return
    }
    out({
      v: 1,
      type: 'ice',
      sessionId,
      handshakeId,
      end: false,
      init: e.candidate.toJSON() as unknown as RTCIceCandidateInit,
    })
  }
  pc.oniceconnectionstatechange = () => {
    emitState(sessionId, handshakeId, {
      ice: pc.iceConnectionState,
      conn: pc.connectionState,
      iceGathering: pc.iceGatheringState,
    })
  }
  pc.onconnectionstatechange = () => {
    emitState(sessionId, handshakeId, {
      ice: pc.iceConnectionState,
      conn: pc.connectionState,
      iceGathering: pc.iceGatheringState,
    })
  }
}

function createOne(sessionId: string, handshakeId: string, role: Role) {
  if (sessions.has(sessionId)) {
    closeOne(sessionId)
  }
  out({ v: 1, type: 'peer_connection_create_begin', sessionId, handshakeId })
  const pc = new RTCPeerConnection(RTC_CFG)
  const session: Session = { sessionId, handshakeId, role, pc, dc: null }
  onPcSession(session)
  if (role === 'offerer') {
    const dc = pc.createDataChannel('wrdesk_p2p', { ordered: true })
    session.dc = attachDc(session, dc)
  } else {
    pc.ondatachannel = (ev) => {
      session.dc = attachDc(session, ev.channel)
    }
  }
  sessions.set(sessionId, session)
  void maybeNegotiate(session)
}

function attachDc(session: Session, dc: RTCDataChannel) {
  dc.binaryType = 'arraybuffer'
  dc.onerror = () => {
    out({ v: 1, type: 'error', sessionId: session.sessionId, handshakeId: session.handshakeId, code: 'dc_error', message: 'datachannel error' })
  }
  dc.onmessage = (e) => {
    const data = e.data
    if (data instanceof ArrayBuffer) {
      out({
        v: 1,
        type: 'message',
        sessionId: session.sessionId,
        handshakeId: session.handshakeId,
        byteLength: data.byteLength,
        bytes: new Uint8Array(data),
      })
    } else {
      out({
        v: 1,
        type: 'message',
        sessionId: session.sessionId,
        handshakeId: session.handshakeId,
        textLength: String(data).length,
      })
    }
  }
  dc.onopen = () => {
    out({ v: 1, type: 'datachannel_open', sessionId: session.sessionId, handshakeId: session.handshakeId })
  }
  dc.onclose = () => {
    out({ v: 1, type: 'datachannel_close', sessionId: session.sessionId, handshakeId: session.handshakeId })
  }
  return dc
}

async function maybeNegotiate(session: Session) {
  if (session.role !== 'offerer') {
    return
  }
  try {
    out({ v: 1, type: 'create_offer_begin', sessionId: session.sessionId, handshakeId: session.handshakeId })
    const offer = await session.pc.createOffer()
    await session.pc.setLocalDescription(offer)
    const sdp = offer.sdp ?? ''
    out({
      v: 1,
      type: 'create_offer_ok',
      sessionId: session.sessionId,
      handshakeId: session.handshakeId,
      sdpBytes: sdp.length,
    })
    out({ v: 1, type: 'offer', sessionId: session.sessionId, handshakeId: session.handshakeId, sdp: sdp })
  } catch (e) {
    emitError(
      session.sessionId,
      session.handshakeId,
      'create_offer',
      e instanceof Error ? e.message : 'error',
    )
  }
}

async function applyRemoteOffer(s: string, sessionId: string, handshakeId: string) {
  const session = sessions.get(sessionId)
  if (!session || session.handshakeId !== handshakeId) {
    return
  }
  try {
    await session.pc.setRemoteDescription({ type: 'offer', sdp: s })
    const answer = await session.pc.createAnswer()
    await session.pc.setLocalDescription(answer)
    out({ v: 1, type: 'answer', sessionId, handshakeId, sdp: answer.sdp ?? '' })
  } catch (e) {
    emitError(sessionId, handshakeId, 'apply_offer', e instanceof Error ? e.message : 'error')
  }
}

async function applyRemoteAnswer(s: string, sessionId: string, handshakeId: string) {
  const session = sessions.get(sessionId)
  if (!session || session.handshakeId !== handshakeId) {
    return
  }
  try {
    await session.pc.setRemoteDescription({ type: 'answer', sdp: s })
  } catch (e) {
    emitError(sessionId, handshakeId, 'apply_answer', e instanceof Error ? e.message : 'error')
  }
}

async function addRemoteIce(
  init: RTCIceCandidateInit,
  sessionId: string,
  handshakeId: string,
) {
  const session = sessions.get(sessionId)
  if (!session || session.handshakeId !== handshakeId) {
    return
  }
  try {
    await session.pc.addIceCandidate(init)
  } catch (e) {
    emitError(sessionId, handshakeId, 'ice', e instanceof Error ? e.message : 'error')
  }
}

function closeOne(sessionId: string) {
  const s = sessions.get(sessionId)
  if (!s) {
    return
  }
  try {
    s.dc?.close()
  } catch {
    /* no-op */
  }
  try {
    s.pc.close()
  } catch {
    /* no-op */
  }
  sessions.delete(sessionId)
}

function sendDataToDc(sessionId: string, handshakeId: string, bytes: ArrayBuffer) {
  const s = sessions.get(sessionId)
  if (!s || s.handshakeId !== handshakeId) {
    return
  }
  if (!s.dc || s.dc.readyState !== 'open') {
    return
  }
  try {
    s.dc.send(bytes)
  } catch (e) {
    emitError(sessionId, handshakeId, 'send', e instanceof Error ? e.message : 'error')
  }
}

/**
 * In-process self-test: two peer connections, ICE forwarded in-page, no main relay.
 */
async function runInPageLocalPair() {
  const h = '__local_test__'
  const offerSid = 'local-offer'
  const answerSid = 'local-answer'
  const a = new RTCPeerConnection(RTC_CFG)
  const b = new RTCPeerConnection(RTC_CFG)
  const dch = a.createDataChannel('w', { ordered: true })
  dch.binaryType = 'arraybuffer'
  dch.onopen = () => {
    out({ v: 1, type: 'datachannel_open', sessionId: offerSid, handshakeId: h })
  }
  b.ondatachannel = (e) => {
    e.channel.onopen = () => {
      out({ v: 1, type: 'datachannel_open', sessionId: answerSid, handshakeId: h })
    }
  }
  a.onicecandidate = (e) => {
    if (e.candidate) {
      void b.addIceCandidate(e.candidate.toJSON())
    }
  }
  b.onicecandidate = (e) => {
    if (e.candidate) {
      void a.addIceCandidate(e.candidate.toJSON())
    }
  }
  const offer = await a.createOffer()
  await a.setLocalDescription(offer)
  await b.setRemoteDescription({ type: 'offer', sdp: offer.sdp ?? '' })
  const ans = await b.createAnswer()
  await b.setLocalDescription(ans)
  await a.setRemoteDescription({ type: 'answer', sdp: ans.sdp ?? '' })
}

function handleFromMain(msg: unknown) {
  if (!msg || typeof msg !== 'object') {
    return
  }
  const m = msg as FromMain
  switch (m.op) {
    case 'create':
      out({ v: 1, type: 'create_ack', sessionId: m.sessionId, handshakeId: m.handshakeId })
      createOne(m.sessionId, m.handshakeId, m.role)
      break
    case 'applyRemoteOffer':
      void applyRemoteOffer(m.sdp, m.sessionId, m.handshakeId)
      break
    case 'applyRemoteAnswer':
      void applyRemoteAnswer(m.sdp, m.sessionId, m.handshakeId)
      break
    case 'addIceCandidate':
      void addRemoteIce(m.candidate, m.sessionId, m.handshakeId)
      break
    case 'close':
      closeOne(m.sessionId)
      break
    case 'sendData':
      sendDataToDc(m.sessionId, m.handshakeId, m.bytes)
      break
    case 'localPairTest':
      void runInPageLocalPair()
      break
    default:
      break
  }
}

const br = (window as unknown as { wrdeskWebrtcP2p?: WrdeskWebrtcP2p }).wrdeskWebrtcP2p
if (br) {
  br.onFromMain(handleFromMain)
} else {
  /* Pod cannot work without bridge */
}
