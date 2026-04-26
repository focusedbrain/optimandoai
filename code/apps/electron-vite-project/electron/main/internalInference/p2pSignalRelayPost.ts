/**
 * Outbound Host AI WebRTC signaling: POST /beap/p2p-signal to coordination-service.
 * Wire JSON must stay in sync with `packages/coordination-service/src/p2pSignal.ts`
 * (`tryParseP2pSignalRequest`): same schema_version, required string keys, TTL behavior,
 * and candidate as string (including empty for end-of-trickle) or relay-coerced object.
 */

import { randomUUID } from 'crypto'
import { getAccessToken } from '../../../src/auth/session'
import { getHandshakeRecord } from '../handshake/db'
import { getP2PConfig } from '../p2p/p2pConfig'
import { InternalInferenceErrorCode, type InternalInferenceErrorCodeType } from './errors'
import { getP2pInferenceFlags } from './p2pInferenceFlags'
import { redactIdForLog } from './internalInferenceLogRedact'
import { p2pEndpointKind } from './policy'
import { recordP2pRelaySignaling429Storm, resetP2pRelaySignalingCircuitForTests } from './p2pSignalRelayCircuit'
import { failHostAiP2pSessionForTerminalSignalingError, getSessionState } from './p2pSession/p2pInferenceSessionManager'
import { P2P_SIGNAL_WIRE_SCHEMA_VERSION } from './p2pSignalWireSchemaVersion'

export { P2P_SIGNAL_WIRE_SCHEMA_VERSION }

const OFFER_ANSWER_TTL_MS = 55_000
const ICE_TTL_MS = 25_000

/** Max 429 retries per signaling message (same body); then offer/answer fatal, ICE non-fatal counter. */
const MAX_429_RETRIES_PER_MESSAGE = 12

const ICE_SEND_FAIL_CONSECUTIVE_FATAL = 10
/** With no successful ICE POST for this long and enough transport failures, escalate (burst alone uses consecutive count). */
const ICE_SEND_FAIL_STREAK_MS = 30_000
const ICE_SEND_FAIL_STREAK_MIN_COUNT = 6

export type OutboundRelayP2pKind = 'offer' | 'answer' | 'ice'

type RelayOutboundSoftState = {
  p2pSessionId: string
  iceConsecutiveFailures: number
  iceFailureStreakStartMs: number | null
  /** Next 429 backoff uses this slot index (0 → 500ms base before cap). */
  signaling429Slot: number
}

const relayOutboundSoftByHandshake = new Map<string, RelayOutboundSoftState>()

const relaySendChainByHandshake = new Map<string, Promise<void>>()

function getRelayOutboundSoft(hid: string, sid: string): RelayOutboundSoftState {
  let s = relayOutboundSoftByHandshake.get(hid)
  if (!s || s.p2pSessionId !== sid) {
    s = {
      p2pSessionId: sid,
      iceConsecutiveFailures: 0,
      iceFailureStreakStartMs: null,
      signaling429Slot: 0,
    }
    relayOutboundSoftByHandshake.set(hid, s)
  }
  return s
}

function reset429SlotOnSuccess(hid: string, sid: string): void {
  const s = relayOutboundSoftByHandshake.get(hid)
  if (s && s.p2pSessionId === sid) {
    s.signaling429Slot = 0
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** Exponential backoff for 429: 500ms × 2^n capped at 8s, plus jitter 0–249ms. */
function jittered429BackoffMs(slot: number): number {
  const exp = Math.min(4, Math.max(0, slot))
  const base = Math.min(8000, 500 * 2 ** exp)
  return base + Math.floor(Math.random() * 250)
}

function consume429BackoffDelayMs(hid: string, sid: string): number {
  const s = getRelayOutboundSoft(hid, sid)
  const delay = jittered429BackoffMs(s.signaling429Slot)
  s.signaling429Slot = Math.min(s.signaling429Slot + 1, 8)
  return delay
}

function handleIceSendFailureAfterRetries(hid: string, sid: string, status: number): void {
  const soft = getRelayOutboundSoft(hid, sid)
  soft.iceConsecutiveFailures += 1
  if (soft.iceFailureStreakStartMs == null) {
    soft.iceFailureStreakStartMs = Date.now()
  }
  const n = soft.iceConsecutiveFailures
  const streakAge = Date.now() - soft.iceFailureStreakStartMs
  const timeFatal = n >= ICE_SEND_FAIL_STREAK_MIN_COUNT && streakAge >= ICE_SEND_FAIL_STREAK_MS
  const countFatal = n >= ICE_SEND_FAIL_CONSECUTIVE_FATAL
  console.log(
    `[P2P_SIGNAL_OUT] ice_send_failed_non_fatal status=${status} handshake=${hid} session=${redactIdForLog(sid)} count=${n} streak_ms=${streakAge}`,
  )
  if (countFatal || timeFatal) {
    console.log(
      `[P2P_SIGNAL_OUT] ice_send_failures_escalate handshake=${hid} session=${redactIdForLog(sid)} count=${n} streak_ms=${streakAge}`,
    )
    failHostAiP2pSessionForTerminalSignalingError(hid, InternalInferenceErrorCode.OFFER_SIGNAL_SEND_FAILED)
  }
}

/**
 * Drop per-handshake relay signaling soft state (ICE failure counters, 429 slot) when the ledger
 * session fails or is superseded — avoids attributing retries to a new session id.
 */
export function discardP2pRelayOutboundSoftStateForHandshake(handshakeId: string): void {
  const hid = handshakeId.trim()
  if (!hid) return
  relayOutboundSoftByHandshake.delete(hid)
}

/** @internal Vitest — module state would otherwise leak across cases. */
export function resetP2pSignalRelayOutboundStateForTests(): void {
  relayOutboundSoftByHandshake.clear()
  relaySendChainByHandshake.clear()
  resetP2pRelaySignalingCircuitForTests()
}

async function withRelayOutboundQueue(handshakeId: string, fn: () => Promise<void>): Promise<void> {
  const hid = handshakeId.trim()
  const prev = relaySendChainByHandshake.get(hid) ?? Promise.resolve()
  const next = prev.then(fn, fn)
  relaySendChainByHandshake.set(hid, next)
  try {
    await next
  } finally {
    if (relaySendChainByHandshake.get(hid) === next) {
      relaySendChainByHandshake.delete(hid)
    }
  }
}

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
  if (params.candidate != null && typeof params.candidate === 'string') {
    o.candidate = params.candidate
  }
  return JSON.stringify(o)
}

/**
 * Full wire + relay body when schema is rejected (400). **Only** when
 * `WRDESK_P2P_INFERENCE_VERBOSE_LOGS=1` — dumps may include SDP/ICE-shaped fields; use `console.debug`.
 */
function logP2pSignalSchemaDebug(payloadJson: string, responseBody: string, kind: OutboundRelayP2pKind): void {
  const f = getP2pInferenceFlags()
  if (!f.p2pInferenceVerboseLogs) {
    return
  }
  let candidateExtra = ''
  if (kind === 'ice') {
    try {
      const o = JSON.parse(payloadJson) as Record<string, unknown>
      const c = o.candidate
      if (typeof c === 'string') {
        try {
          const parsed = JSON.parse(c) as Record<string, unknown>
          candidateExtra = ` candidate_object=${JSON.stringify({
            candidate: parsed.candidate ?? parsed.candidateString,
            sdpMid: parsed.sdpMid,
            sdpMLineIndex: parsed.sdpMLineIndex,
            usernameFragment: parsed.usernameFragment,
          })}`
        } catch {
          candidateExtra = ` candidate_raw=${JSON.stringify(c)}`
        }
      } else if (c && typeof c === 'object') {
        const p = c as Record<string, unknown>
        candidateExtra = ` candidate_object=${JSON.stringify({
          candidate: p.candidate ?? p.candidateString,
          sdpMid: p.sdpMid,
          sdpMLineIndex: p.sdpMLineIndex,
          usernameFragment: p.usernameFragment,
        })}`
      }
    } catch {
      /* keep candidateExtra empty */
    }
  }
  const line = `[P2P_SIGNAL_SCHEMA_DEBUG] payload_sent=${JSON.stringify(payloadJson)}${candidateExtra} response_body=${JSON.stringify(responseBody)}`
  console.debug(line)
}

/**
 * Session-fatal errors for offer/answer on any non-success, and for ICE only on auth/route/schema.
 * ICE transport errors (429/5xx/etc.) return null → non-fatal counter path.
 */
function mapSignalingHttpToTerminalCode(
  kind: OutboundRelayP2pKind,
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
  if (kind === 'ice') {
    return null
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
  max429Retries: number | null
} = { post: null, max429Retries: null }

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
 * Sends offer / answer / ICE to coordination.
 * ICE: `iceEnd` skips POST; `iceCandidateJson === ''` sends `candidate: ""` (end-of-trickle envelope).
 * ICE transport errors are non-fatal until streak thresholds; offer/answer remain session-fatal.
 * HTTP 429: exponential backoff and retry same message before failing (offer/answer) or counting ICE failure.
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
  if (params.kind === 'ice') {
    const j = params.iceCandidateJson
    if (j === undefined || j === null) return
    if (j.length > 0 && j.trim() === '') return
  }
  if ((params.kind === 'offer' || params.kind === 'answer') && (!params.sdp || !params.sdp.trim())) {
    return
  }

  const stEarly = getSessionState(hid)
  if (
    !stEarly ||
    stEarly.phase === 'failed' ||
    !stEarly.sessionId ||
    stEarly.sessionId.trim() !== sid
  ) {
    const cur = stEarly?.sessionId ? redactIdForLog(stEarly.sessionId.trim()) : 'none'
    console.log(
      `[P2P_SIGNAL_OUT] dropped_stale_send session=${redactIdForLog(sid)} current_session=${cur} handshake=${hid} kind=${params.kind} phase=${stEarly?.phase ?? 'no_ledger'}`,
    )
    return
  }

  const record = getHandshakeRecord(params.db, hid)
  const p2pEp = record?.p2p_endpoint
  if (!shouldSendHostAiP2pSignalViaCoordination(params.db, p2pEp)) {
    return
  }

  await withRelayOutboundQueue(hid, async () => {
    const stQ = getSessionState(hid)
    if (
      !stQ ||
      stQ.phase === 'failed' ||
      !stQ.sessionId ||
      stQ.sessionId.trim() !== sid
    ) {
      const cur = stQ?.sessionId ? redactIdForLog(stQ.sessionId.trim()) : 'none'
      console.log(
        `[P2P_SIGNAL_OUT] dropped_stale_send session=${redactIdForLog(sid)} current_session=${cur} handshake=${hid} kind=${params.kind} phase=${stQ?.phase ?? 'no_ledger'} reason=queue_race`,
      )
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

    const postFn = p2pSignalRelayPostTestHooks.post ?? postP2pSignalToCoordination
    const max429 = p2pSignalRelayPostTestHooks.max429Retries ?? MAX_429_RETRIES_PER_MESSAGE

    let lastStatus = 0
    let lastBody = ''
    let attempt429 = 0

    try {
      while (true) {
        const res = await postFn(base, token.trim(), body)
        lastStatus = res.status
        lastBody = res.bodyText

        if (res.status === 200) {
          reset429SlotOnSuccess(hid, sid)
          if (params.kind === 'ice') {
            const soft = getRelayOutboundSoft(hid, sid)
            soft.iceConsecutiveFailures = 0
            soft.iceFailureStreakStartMs = null
          }
          console.log(
            `[P2P_SIGNAL_OUT] accepted status=200 type=${params.kind} handshake=${hid} session=${redactIdForLog(sid)}`,
          )
          return
        }
        if (res.status === 202) {
          reset429SlotOnSuccess(hid, sid)
          console.log(
            `[P2P_SIGNAL_OUT] recipient_offline status=202 type=${params.kind} handshake=${hid} session=${redactIdForLog(sid)}`,
          )
          return
        }
        if (res.status === 429) {
          attempt429 += 1
          if (attempt429 > max429) {
            break
          }
          const delayMs = consume429BackoffDelayMs(hid, sid)
          console.log(
            `[P2P_SIGNAL_OUT] rate_limit_backoff type=${params.kind} handshake=${hid} session=${redactIdForLog(sid)} attempt=${attempt429} sleep_ms=${delayMs}`,
          )
          await sleep(delayMs)
          continue
        }

        const terminalEarly = mapSignalingHttpToTerminalCode(params.kind, res.status, res.bodyText)
        const codeLog = terminalEarly ?? 'non_fatal_ice_transport'
        if (res.status === 400 && terminalEarly === InternalInferenceErrorCode.P2P_SIGNAL_SCHEMA_REJECTED) {
          logP2pSignalSchemaDebug(body, res.bodyText, params.kind)
        }
        console.log(
          `[P2P_SIGNAL_OUT] failed status=${res.status} type=${params.kind} code=${codeLog} handshake=${hid} session=${redactIdForLog(sid)}`,
        )
        if (terminalEarly) {
          failHostAiP2pSessionForTerminalSignalingError(hid, terminalEarly)
          return
        }
        if (params.kind === 'ice') {
          handleIceSendFailureAfterRetries(hid, sid, res.status)
        } else {
          failHostAiP2pSessionForTerminalSignalingError(hid, InternalInferenceErrorCode.OFFER_SIGNAL_SEND_FAILED)
        }
        return
      }

      const offerOrAnswer = params.kind === 'offer' || params.kind === 'answer'
      if (offerOrAnswer && lastStatus === 429 && attempt429 > max429) {
        recordP2pRelaySignaling429Storm()
      }

      const terminalAfter429 = mapSignalingHttpToTerminalCode(params.kind, lastStatus, lastBody)
      const code429 = terminalAfter429 ?? 'non_fatal_ice_transport'
      console.log(
        `[P2P_SIGNAL_OUT] failed status=${lastStatus} type=${params.kind} code=${code429} handshake=${hid} session=${redactIdForLog(sid)} after_429_retries=${attempt429}`,
      )
      if (terminalAfter429) {
        failHostAiP2pSessionForTerminalSignalingError(hid, terminalAfter429)
        return
      }
      if (params.kind === 'ice') {
        handleIceSendFailureAfterRetries(hid, sid, lastStatus)
      } else {
        failHostAiP2pSessionForTerminalSignalingError(hid, InternalInferenceErrorCode.OFFER_SIGNAL_SEND_FAILED)
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.log(
        `[P2P_SIGNAL_OUT] failed status=0 type=${params.kind} code=relay_unreachable handshake=${hid} session=${redactIdForLog(sid)} err=${JSON.stringify(msg.slice(0, 200))}`,
      )
      if (params.kind === 'ice') {
        handleIceSendFailureAfterRetries(hid, sid, 0)
      } else {
        failHostAiP2pSessionForTerminalSignalingError(hid, InternalInferenceErrorCode.RELAY_UNREACHABLE)
      }
    }
  })
}
