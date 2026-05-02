/**
 * Inbound p2p_signal frames from the coordination WebSocket (not BEAP capsules, not inbox).
 * Phase 3: validate + log + route to session stub; no ingestion pipeline.
 * Host AI: `p2p_host_ai_direct_beap_ad` is handled here (bootstrap endpoint), not in WebRTC session code.
 */

import { applyHostAiDirectBeapAdFromRelayPayload } from './p2pEndpointRepair'
import { redactIdForLog } from './internalInferenceLogRedact'
import { maybeHandleP2pInferenceRelaySignal } from './p2pSessionManagerStub'
import { getInstanceId } from '../orchestrator/orchestratorModeStore'
import { getHandshakeRecord } from '../handshake/db'
import {
  assertLedgerRolesSandboxToHost,
  assertRecordForServiceRpc,
  coordinationDeviceIdForHandshakeDeviceRole,
} from './policy'

const FORBIDDEN_KEYS = new Set(['prompt', 'messages', 'completion', 'document', 'capsule'])

const WEBRTC_SIGNAL_TYPES = new Set([
  'p2p_inference_offer',
  'p2p_inference_answer',
  'p2p_inference_ice',
  'p2p_inference_close',
  'p2p_inference_error',
])

const BEAP_AD_TYPE = 'p2p_host_ai_direct_beap_ad'
const BEAP_AD_REQUEST_TYPE = 'p2p_host_ai_direct_beap_ad_request'

const ALL_P2P_SIGNAL_TYPES = new Set([...WEBRTC_SIGNAL_TYPES, BEAP_AD_TYPE, BEAP_AD_REQUEST_TYPE])

type P2pSignalDrop = 'forbidden_key' | 'schema' | 'type' | 'field' | 'expired' | 'ttl' | 'parse' | 'stale'

/** Queued 202 + offline recipient can delay beap-ads; still bound defense-in-depth. */
const MAX_HOST_AI_BEAP_AD_AGE_MS = 600_000

/** WebRTC Host-AI signals: accept until slightly after `expires_at` (relay delay / clock skew vs sender). */
const WEBRTC_EXPIRY_CLOCK_SKEW_GRACE_MS = 60_000
/** Reject `created_at` implausibly far in the future vs local clock. */
const WEBRTC_MAX_CREATED_AT_FUTURE_MS = 300_000

/**
 * Match coordination-service `coerceSchemaVersion` (see `packages/coordination-service/src/p2pSignal.ts`).
 * Keep in sync when loosening/tightening — duplicated here because Electron does not depend on that package.
 */
function isWireSchemaVersionOne(v: unknown): boolean {
  if (typeof v === 'number' && Number.isFinite(v) && v === 1) return true
  if (typeof v !== 'string') return false
  const t = v.trim()
  if (!t) return false
  if (/^[0-9]+$/.test(t)) return Number(t) === 1
  return /^1(?:\.0+)?$/.test(t)
}

function parseIso(s: unknown): number | null {
  if (typeof s !== 'string' || !s.trim()) return null
  const t = Date.parse(s)
  return Number.isNaN(t) ? null : t
}

function logHostAiSignalTtl(payload: Record<string, unknown>, args: {
  c0: number
  c1: number
  now: number
  decision: 'allow' | 'drop'
  reason: string
}): void {
  const signal_type = typeof payload.signal_type === 'string' ? payload.signal_type : ''
  const handshake_id = typeof payload.handshake_id === 'string' ? payload.handshake_id : ''
  const session_id = typeof payload.session_id === 'string' ? payload.session_id : ''
  const sender_device_id = typeof payload.sender_device_id === 'string' ? payload.sender_device_id : ''
  const receiver_device_id = typeof payload.receiver_device_id === 'string' ? payload.receiver_device_id : ''
  const created_at = typeof payload.created_at === 'string' ? payload.created_at : ''
  const expires_at = typeof payload.expires_at === 'string' ? payload.expires_at : ''
  const { c0, c1, now, decision, reason } = args
  console.log(
    `[HOST_AI_SIGNAL_TTL] ${JSON.stringify({
      signal_type,
      handshake_id,
      session_id,
      sender_device_id,
      receiver_device_id,
      now_iso: new Date(now).toISOString(),
      created_at,
      expires_at,
      now_minus_created_ms: Math.round(now - c0),
      expires_minus_now_ms: Math.round(c1 - now),
      decision,
      reason,
    })}`,
  )
}

/**
 * Host AI WebRTC signals (`p2p_inference_*`): trust `expires_at` + grace; do not cap `expires_at - created_at`
 * below what `p2pSignalRelayPost` sends (120s for offer/answer/ICE).
 */
function evaluateWebRtcInferenceSignalLifetime(
  p: Record<string, unknown>,
  c0: number,
  c1: number,
  now: number,
): { ok: true } | { ok: false; drop: 'expired' | 'ttl'; reasonCode: string } {
  const ttl = c1 - c0
  if (!Number.isFinite(c0) || !Number.isFinite(c1) || !Number.isFinite(now)) {
    logHostAiSignalTtl(p, { c0, c1, now, decision: 'drop', reason: 'non_finite_timestamps' })
    return { ok: false, drop: 'ttl', reasonCode: 'non_finite_timestamps' }
  }
  if (ttl <= 0) {
    logHostAiSignalTtl(p, { c0, c1, now, decision: 'drop', reason: 'expires_at_not_after_created_at' })
    return { ok: false, drop: 'expired', reasonCode: 'expires_at_not_after_created_at' }
  }
  if (c0 > now + WEBRTC_MAX_CREATED_AT_FUTURE_MS) {
    logHostAiSignalTtl(p, { c0, c1, now, decision: 'drop', reason: 'created_at_too_far_in_future' })
    return { ok: false, drop: 'ttl', reasonCode: 'created_at_too_far_in_future' }
  }
  if (now > c1 + WEBRTC_EXPIRY_CLOCK_SKEW_GRACE_MS) {
    logHostAiSignalTtl(p, { c0, c1, now, decision: 'drop', reason: 'past_expires_at_with_grace' })
    return { ok: false, drop: 'expired', reasonCode: 'past_expires_at_with_grace' }
  }
  logHostAiSignalTtl(p, { c0, c1, now, decision: 'allow', reason: 'ok' })
  return { ok: true }
}

async function handleHostAiDirectBeapAdRequestFromRelay(
  db: any,
  p: Record<string, unknown>,
  relayMessageId: string,
): Promise<void> {
  const hid = typeof p.handshake_id === 'string' ? p.handshake_id.trim() : ''
  const sender = typeof p.sender_device_id === 'string' ? p.sender_device_id.trim() : ''
  const receiver = typeof p.receiver_device_id === 'string' ? p.receiver_device_id.trim() : ''
  const localId = getInstanceId().trim()
  console.log(
    `[HOST_AI_BEAP_AD_REQUEST_RECV] ${JSON.stringify({
      handshakeId: hid,
      senderDeviceId: sender,
      receiverDeviceId: receiver,
      localDeviceId: localId,
      relayMessageId,
    })}`,
  )
  if (!hid || localId !== receiver) {
    return
  }
  const r0 = getHandshakeRecord(db, hid)
  const ar = assertRecordForServiceRpc(r0)
  if (!ar.ok) {
    console.log(
      `[HOST_AI_BEAP_AD_REQUEST_REJECTED] ${JSON.stringify({
        handshakeId: hid,
        reason: 'not_active_internal',
        relayMessageId,
      })}`,
    )
    return
  }
  if (!assertLedgerRolesSandboxToHost(ar.record).ok) {
    console.log(
      `[HOST_AI_BEAP_AD_REQUEST_REJECTED] ${JSON.stringify({
        handshakeId: hid,
        reason: 'not_sandbox_to_host_ledger',
        relayMessageId,
      })}`,
    )
    return
  }
  const expectSandbox = (coordinationDeviceIdForHandshakeDeviceRole(ar.record, 'sandbox') ?? '').trim()
  const expectHost = (coordinationDeviceIdForHandshakeDeviceRole(ar.record, 'host') ?? '').trim()
  if (!expectSandbox || sender !== expectSandbox || localId !== expectHost) {
    console.log(
      `[HOST_AI_BEAP_AD_REQUEST_REJECTED] ${JSON.stringify({
        handshakeId: hid,
        reason: 'wrong_parties',
        expectedSandboxDeviceId: expectSandbox,
        expectedHostDeviceId: expectHost,
        relayMessageId,
      })}`,
    )
    return
  }
  const { publishHostAiDirectBeapAdvertisementsForEligibleHost } = await import('./hostAiDirectBeapAdPublish')
  await publishHostAiDirectBeapAdvertisementsForEligibleHost(db, {
    context: 'sandbox_peer_republish_request_ws',
  })
}

/**
 * @returns true if the message was a p2p_signal and handled (consumed) — do not process as capsule
 */
export function tryHandleCoordinationP2pSignal(
  msg: Record<string, unknown>,
  relayMessageId: string,
  getDb?: () => any,
): boolean {
  if (msg.type !== 'p2p_signal') {
    return false
  }
  if (typeof msg.id !== 'string' || !msg.id.trim() || !msg.payload || typeof msg.payload !== 'object' || Array.isArray(msg.payload)) {
    const hid = extractHandshakeId(msg)
    logDropped(hid, 'parse', relayMessageId)
    return true
  }
  const p = msg.payload as Record<string, unknown>
  for (const k of Object.keys(p)) {
    if (FORBIDDEN_KEYS.has(k)) {
      logDropped(p.handshake_id, 'forbidden_key', relayMessageId)
      return true
    }
  }
  if (!isWireSchemaVersionOne(p.schema_version)) {
    logDropped(p.handshake_id, 'schema', relayMessageId)
    return true
  }
  p.schema_version = 1
  const st = p.signal_type
  if (typeof st !== 'string' || !ALL_P2P_SIGNAL_TYPES.has(st)) {
    logDropped(p.handshake_id, 'type', relayMessageId)
    return true
  }
  for (const k of ['correlation_id', 'session_id', 'handshake_id', 'sender_device_id', 'receiver_device_id', 'created_at', 'expires_at'] as const) {
    if (typeof p[k] !== 'string' || !p[k]!.toString().trim()) {
      logDropped(p.handshake_id, 'field', relayMessageId)
      return true
    }
  }
  const c0 = parseIso(p.created_at)
  const c1 = parseIso(p.expires_at)
  if (c0 == null || c1 == null) {
    logDropped(p.handshake_id, 'field', relayMessageId)
    return true
  }
  const now = Date.now()
  const isBeapAd = st === BEAP_AD_TYPE
  const isBeapAdRequest = st === BEAP_AD_REQUEST_TYPE

  if (isBeapAd) {
    const ttl = c1 - c0
    if (ttl <= 0) {
      logHostAiSignalTtl(p, { c0, c1, now, decision: 'drop', reason: 'expires_at_not_after_created_at' })
      logDropped(p.handshake_id, 'expired', relayMessageId)
      return true
    }
    if (ttl < 60_000 || ttl > 600_000) {
      logHostAiSignalTtl(p, { c0, c1, now, decision: 'drop', reason: 'beap_ad_ttl_out_of_bounds' })
      logDropped(p.handshake_id, 'ttl', relayMessageId)
      return true
    }
    if (now - c0 > MAX_HOST_AI_BEAP_AD_AGE_MS) {
      logHostAiSignalTtl(p, { c0, c1, now, decision: 'drop', reason: 'beap_ad_created_at_stale' })
      logDropped(p.handshake_id, 'stale', relayMessageId)
      return true
    }
    logHostAiSignalTtl(p, { c0, c1, now, decision: 'allow', reason: 'ok_beap_ad' })
  } else if (isBeapAdRequest) {
    const ttl = c1 - c0
    if (ttl > 120_000) {
      logHostAiSignalTtl(p, { c0, c1, now, decision: 'drop', reason: 'beap_ad_request_ttl_too_long' })
      logDropped(p.handshake_id, 'ttl', relayMessageId)
      return true
    }
    const life = evaluateWebRtcInferenceSignalLifetime(p, c0, c1, now)
    if (!life.ok) {
      logDropped(p.handshake_id, life.drop, relayMessageId)
      return true
    }
    if (p.owner_role != null && p.owner_role !== 'sandbox') {
      logDropped(p.handshake_id, 'field', relayMessageId)
      return true
    }
  } else {
    const life = evaluateWebRtcInferenceSignalLifetime(p, c0, c1, now)
    if (!life.ok) {
      logDropped(p.handshake_id, life.drop, relayMessageId)
      return true
    }
  }
  if (isBeapAd) {
    const ep = typeof p.endpoint_url === 'string' ? p.endpoint_url.trim() : ''
    const seq = p.ad_seq
    if (!ep) {
      logDropped(p.handshake_id, 'field', relayMessageId)
      return true
    }
    if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 0) {
      logDropped(p.handshake_id, 'field', relayMessageId)
      return true
    }
  }

  const hid = typeof p.handshake_id === 'string' ? p.handshake_id : ''
  const session = typeof p.session_id === 'string' ? p.session_id : ''

  if (isBeapAd) {
    const db = getDb?.()
    if (!db) {
      console.log(
        `[P2P_SIGNAL_RECV] type=host_ai_beap_ad handshake=${hid} reason=no_db relay_message_id=${relayMessageId}`,
      )
      return true
    }
    applyHostAiDirectBeapAdFromRelayPayload(db, p, relayMessageId)
    return true
  }

  if (isBeapAdRequest) {
    const db = getDb?.()
    if (!db) {
      console.log(
        `[P2P_SIGNAL_RECV] type=host_ai_beap_ad_request handshake=${hid} reason=no_db relay_message_id=${relayMessageId}`,
      )
      return true
    }
    void handleHostAiDirectBeapAdRequestFromRelay(db, p, relayMessageId).catch(() => {})
    return true
  }

  if (typeof p.signal_type !== 'string' || !WEBRTC_SIGNAL_TYPES.has(p.signal_type)) {
    logDropped(p.handshake_id, 'type', relayMessageId)
    return true
  }
  const recvType =
    p.signal_type === 'p2p_inference_offer'
      ? 'offer'
      : p.signal_type === 'p2p_inference_answer'
        ? 'answer'
        : p.signal_type === 'p2p_inference_ice'
          ? 'ice'
          : p.signal_type.replace(/^p2p_inference_/, '')
  const extraBytes =
    (p.signal_type === 'p2p_inference_answer' || p.signal_type === 'p2p_inference_offer') &&
    typeof p.sdp === 'string'
      ? ` bytes=${p.sdp.length}`
      : ''
  console.log(
    `[P2P_SIGNAL_RECV] type=${recvType} handshake=${hid} session=${redactIdForLog(session)}${extraBytes}`,
  )
  void maybeHandleP2pInferenceRelaySignal({
    relayMessageId,
    raw: p,
  })
  return true
}

function extractHandshakeId(msg: Record<string, unknown>): string {
  const pl = msg.payload
  if (pl && typeof pl === 'object' && !Array.isArray(pl) && typeof (pl as any).handshake_id === 'string') {
    return (pl as any).handshake_id
  }
  return ''
}

function logDropped(
  handshake: unknown,
  reason: P2pSignalDrop,
  relayMessageId: string,
): void {
  const h = typeof handshake === 'string' && handshake ? handshake : '(unknown)'
  console.log(`[P2P_SIGNAL] dropped handshake=${h} reason=${reason} relay_message_id=${relayMessageId}`)
}
