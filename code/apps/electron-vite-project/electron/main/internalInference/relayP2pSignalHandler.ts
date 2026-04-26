/**
 * Inbound p2p_signal frames from the coordination WebSocket (not BEAP capsules, not inbox).
 * Phase 3: validate + log + route to session stub; no ingestion pipeline.
 * Host AI: `p2p_host_ai_direct_beap_ad` is handled here (bootstrap endpoint), not in WebRTC session code.
 */

import { applyHostAiDirectBeapAdFromRelayPayload } from './p2pEndpointRepair'
import { redactIdForLog } from './internalInferenceLogRedact'
import { maybeHandleP2pInferenceRelaySignal } from './p2pSessionManagerStub'

const FORBIDDEN_KEYS = new Set(['prompt', 'messages', 'completion', 'document', 'capsule'])

const WEBRTC_SIGNAL_TYPES = new Set([
  'p2p_inference_offer',
  'p2p_inference_answer',
  'p2p_inference_ice',
  'p2p_inference_close',
  'p2p_inference_error',
])

const BEAP_AD_TYPE = 'p2p_host_ai_direct_beap_ad'

const ALL_P2P_SIGNAL_TYPES = new Set([...WEBRTC_SIGNAL_TYPES, BEAP_AD_TYPE])

type P2pSignalDrop = 'forbidden_key' | 'schema' | 'type' | 'field' | 'expired' | 'ttl' | 'parse' | 'stale'

/** Reject `created_at` too far in the past (defense in depth vs relay `expires_at`). WebRTC only. */
const MAX_P2P_SIGNAL_AGE_MS = 120_000
/** Queued 202 + offline recipient can delay beap-ads; still bound defense-in-depth. */
const MAX_HOST_AI_BEAP_AD_AGE_MS = 600_000

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
  if (c1 < now) {
    logDropped(p.handshake_id, 'expired', relayMessageId)
    return true
  }
  const ttl = c1 - c0
  if (ttl <= 0) {
    logDropped(p.handshake_id, 'expired', relayMessageId)
    return true
  }
  const isBeapAd = st === BEAP_AD_TYPE
  if (isBeapAd) {
    if (ttl < 60_000 || ttl > 600_000) {
      logDropped(p.handshake_id, 'ttl', relayMessageId)
      return true
    }
    if (now - c0 > MAX_HOST_AI_BEAP_AD_AGE_MS) {
      logDropped(p.handshake_id, 'stale', relayMessageId)
      return true
    }
  } else {
    if (now - c0 > MAX_P2P_SIGNAL_AGE_MS) {
      logDropped(p.handshake_id, 'stale', relayMessageId)
      return true
    }
  }
  if (!isBeapAd) {
    if (p.signal_type === 'p2p_inference_ice') {
      if (ttl > 30_000) {
        logDropped(p.handshake_id, 'ttl', relayMessageId)
        return true
      }
    } else if (ttl > 60_000) {
      logDropped(p.handshake_id, 'ttl', relayMessageId)
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
