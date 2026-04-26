/**
 * Outbound Host AI WebRTC signaling: POST /beap/p2p-signal to coordination-service.
 * Matches packages/coordination-service/src/p2pSignal.ts schema_version 1.
 */

import { randomUUID } from 'crypto'
import { getAccessToken } from '../../../src/auth/session'
import { getHandshakeRecord } from '../handshake/db'
import { getP2PConfig } from '../p2p/p2pConfig'
import { InternalInferenceErrorCode, type InternalInferenceErrorCodeType } from './errors'
import { redactIdForLog } from './internalInferenceLogRedact'
import { p2pEndpointKind } from './policy'
import { failHostAiP2pSessionForTerminalSignalingError, getSessionState } from './p2pSession/p2pInferenceSessionManager'

export const P2P_SIGNAL_WIRE_SCHEMA_VERSION = 1

const OFFER_ANSWER_TTL_MS = 55_000
const ICE_TTL_MS = 25_000

export type OutboundRelayP2pKind = 'offer' | 'answer' | 'ice'

function coordinationBaseUrl(db: any): string | null {
  const u = getP2PConfig(db).coordination_url?.trim()
  return u || null
}

export function shouldSendHostAiP2pSignalViaCoordination(
  db: any,
  p2pEndpoint: string | null | undefined,
): boolean {
  const cfg = getP2PConfig(db)
  if (cfg.use_coordination && cfg.coordination_url?.trim()) return true
  return p2pEndpointKind(db, p2pEndpoint) === 'relay'
}

function signalTypeForKind(kind: OutboundRelayP2pKind): string {
  if (kind === 'offer') return 'p2p_inference_offer'
  if (kind === 'answer') return 'p2p_inference_answer'
  return 'p2p_inference_ice'
}

function buildP2pSignalBody(params: {
  signalType: string
  handshakeId: string
  sessionId: string
  senderDeviceId: string
  receiverDeviceId: string
  sdp?: string
  candidate?: string
}): string {
  const correlationId = randomUUID()
  const t0 = Date.now()
  const ttl = params.signalType === 'p2p_inference_ice' ? ICE_TTL_MS : OFFER_ANSWER_TTL_MS
  const createdAt = new Date(t0).toISOString()
  const expiresAt = new Date(t0 + ttl).toISOString()
  const o: Record<string, unknown> = {
    schema_version: P2P_SIGNAL_WIRE_SCHEMA_VERSION,
    signal_type: params.signalType,
    handshake_id: params.handshakeId,
    correlation_id: correlationId,
    session_id: params.sessionId,
    sender_device_id: params.senderDeviceId,
    receiver_device_id: params.receiverDeviceId,
    created_at: createdAt,
    expires_at: expiresAt,
  }
  if (params.sdp != null && params.sdp.length > 0) o.sdp = params.sdp
  if (params.candidate != null && params.candidate.length > 0) o.candidate = params.candidate
  return JSON.stringify(o)
}

function mapStatusToTerminalError(
  status: number,
  bodySnippet: string,
): InternalInferenceErrorCodeType | null {
  if (status === 202) return null
  if (status === 401 || status === 403) return InternalInferenceErrorCode.P2P_SIGNAL_AUTH_OR_ROUTE_FAILED
  if (status === 404 || status === 405) return InternalInferenceErrorCode.RELAY_MISSING_P2P_SIGNAL_ROUTE
  if (status === 400) {
    if (/P2P_SIGNAL_REJECTED|schema|field_required|forbidden_field/i.test(bodySnippet)) {
      return InternalInferenceErrorCode.P2P_SIGNAL_SCHEMA_REJECTED
    }
    return InternalInferenceErrorCode.P2P_SIGNAL_SCHEMA_REJECTED
  }
  if (status >= 500) return InternalInferenceErrorCode.OFFER_SIGNAL_SEND_FAILED
  return InternalInferenceErrorCode.OFFER_SIGNAL_SEND_FAILED
}

/** @internal Vitest: substitute HTTP POST (mutable object; not a live binding export). */
export const p2pSignalRelayPostTestHooks: {
  post:
    | ((
        coordinationUrl: string,
        bearer: string,
        body: string,
      ) => Promise<{ status: number; bodyText: string }>)
    | null
} = { post: null }

async function postP2pSignalToCoordination(
  coordinationUrl: string,
  bearer: string,
  body: string,
): Promise<{ status: number; bodyText: string }> {
  const url = `${coordinationUrl.replace(/\/$/, '')}/beap/p2p-signal`
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${bearer}`,
    },
    body,
  })
  const bodyText = await r.text().catch(() => '')
  return { status: r.status, bodyText }
}

/**
 * Sends offer / answer / ICE to coordination. ICE end-of-candidates is not sent (no wire candidate).
 * On terminal HTTP errors, fails the P2P session with cooldown.
 */
export async function sendHostAiP2pSignalOutbound(params: {
  db: any
  handshakeId: string
  p2pSessionId: string
  kind: OutboundRelayP2pKind
  sdp?: string
  iceCandidateJson?: string
  iceEnd?: boolean
}): Promise<void> {
  const hid = params.handshakeId.trim()
  const sid = params.p2pSessionId.trim()
  if (!hid || !sid) return

  if (params.kind === 'ice' && params.iceEnd) {
    return
  }
  if (params.kind === 'ice' && (!params.iceCandidateJson || !params.iceCandidateJson.trim())) {
    return
  }
  if ((params.kind === 'offer' || params.kind === 'answer') && (!params.sdp || !params.sdp.trim())) {
    return
  }

  const record = getHandshakeRecord(params.db, hid)
  const p2pEp = record?.p2p_endpoint
  if (!shouldSendHostAiP2pSignalViaCoordination(params.db, p2pEp)) {
    return
  }

  const base = coordinationBaseUrl(params.db)
  if (!base) {
    console.log(`[P2P_SIGNAL_OUT] failed status=0 type=${params.kind} code=no_coordination_url handshake=${hid}`)
    failHostAiP2pSessionForTerminalSignalingError(hid, InternalInferenceErrorCode.RELAY_UNREACHABLE)
    return
  }

  const st = getSessionState(hid)
  const sender = st?.boundLocalDeviceId?.trim() ?? ''
  const receiver = st?.boundPeerDeviceId?.trim() ?? ''
  if (!sender || !receiver) {
    console.log(
      `[P2P_SIGNAL_OUT] failed status=0 type=${params.kind} code=no_bound_device_ids handshake=${hid} session=${redactIdForLog(sid)}`,
    )
    failHostAiP2pSessionForTerminalSignalingError(hid, InternalInferenceErrorCode.MALFORMED_SERVICE_MESSAGE)
    return
  }

  const signalType = signalTypeForKind(params.kind)
  const body = buildP2pSignalBody({
    signalType,
    handshakeId: hid,
    sessionId: sid,
    senderDeviceId: sender,
    receiverDeviceId: receiver,
    sdp: params.kind !== 'ice' ? params.sdp : undefined,
    candidate: params.kind === 'ice' ? params.iceCandidateJson : undefined,
  })

  const token = getAccessToken()
  if (!token?.trim()) {
    console.log(
      `[P2P_SIGNAL_OUT] failed status=401 type=${params.kind} code=no_bearer handshake=${hid} session=${redactIdForLog(sid)}`,
    )
    failHostAiP2pSessionForTerminalSignalingError(hid, InternalInferenceErrorCode.P2P_SIGNAL_AUTH_OR_ROUTE_FAILED)
    return
  }

  console.log(
    `[P2P_SIGNAL_OUT] sending type=${params.kind} handshake=${hid} session=${redactIdForLog(sid)} target_device=${receiver} bytes=${Buffer.byteLength(body, 'utf8')}`,
  )

  let status: number
  let bodyText: string
  try {
    const postFn = p2pSignalRelayPostTestHooks.post ?? postP2pSignalToCoordination
    const res = await postFn(base, token.trim(), body)
    status = res.status
    bodyText = res.bodyText
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.log(
      `[P2P_SIGNAL_OUT] failed status=0 type=${params.kind} code=relay_unreachable handshake=${hid} session=${redactIdForLog(sid)} err=${JSON.stringify(msg.slice(0, 200))}`,
    )
    failHostAiP2pSessionForTerminalSignalingError(hid, InternalInferenceErrorCode.RELAY_UNREACHABLE)
    return
  }

  if (status === 200) {
    console.log(
      `[P2P_SIGNAL_OUT] accepted status=200 type=${params.kind} handshake=${hid} session=${redactIdForLog(sid)}`,
    )
    return
  }
  if (status === 202) {
    console.log(
      `[P2P_SIGNAL_OUT] recipient_offline status=202 type=${params.kind} handshake=${hid} session=${redactIdForLog(sid)}`,
    )
    return
  }

  const terminal = mapStatusToTerminalError(status, bodyText)
  const codeLog = terminal ?? 'unknown'
  console.log(
    `[P2P_SIGNAL_OUT] failed status=${status} type=${params.kind} code=${codeLog} handshake=${hid} session=${redactIdForLog(sid)}`,
  )
  if (terminal) {
    failHostAiP2pSessionForTerminalSignalingError(hid, terminal)
  }
}
